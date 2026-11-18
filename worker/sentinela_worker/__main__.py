import argparse
import os
import signal
import sys
import time

from . import scheduler
from .log import log
from .settings import Settings

HEALTHCHECK_MAX_AGE_S = 600


def _date(value: str) -> str:
    from datetime import date
    date.fromisoformat(value)
    return value


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="sentinela_worker")
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("run", help="start the scheduler loop")
    for name in ("backfill-openmeteo", "backfill-ana"):
        sp = sub.add_parser(name, help="one-off historical backfill")
        sp.add_argument("--start", required=True, type=_date, metavar="YYYY-MM-DD")
        sp.add_argument("--end", type=_date, metavar="YYYY-MM-DD", default=None,
                        help="inclusive; defaults to yesterday (UTC)")
    sub.add_parser("detect-once", help="run the sensor-fault detector once")
    sub.add_parser("healthcheck", help="exit 0 if the scheduler ticked in the last 10 minutes")
    return p


def healthcheck(path: str | None = None, max_age_s: int = HEALTHCHECK_MAX_AGE_S) -> int:
    path = path or scheduler.TICK_FILE
    try:
        age = time.time() - os.stat(path).st_mtime
    except OSError:
        return 1
    return 0 if age < max_age_s else 1


def build_jobs(sink, pg, detector_config_path: str, *, version: str | None = None,
               started_at=None) -> tuple[list[scheduler.Job], list]:
    """Return the production jobs and the long-lived clients to close on shutdown.

    The detector config is loaded here, so an invalid detector.yaml stops the worker at startup."""
    from .collectors import ana, openmeteo
    from .detector import runner
    from .detector.config import load_detector_config
    from .status_job import STATUS_HTTP_TIMEOUT_MS, STATUS_INTERVAL_S, make_status_job

    version = version or os.environ.get("WORKER_VERSION") or "desconhecida"
    started_at = started_at or scheduler.utcnow()
    detector_cfg = load_detector_config(detector_config_path)
    # Dedicated short-timeout Influx client for the status job (the detector keeps its 60 s).
    status_sink, extra = sink, []
    if hasattr(sink, "with_timeout"):
        status_sink = sink.with_timeout(STATUS_HTTP_TIMEOUT_MS)
        extra.append(status_sink)
    om_client = openmeteo.make_client()
    ana_client = ana.make_client()
    source = ana.AnaLegacySource(ana_client)
    jobs = [
        scheduler.Job("openmeteo", 3600, lambda now: openmeteo.collect_openmeteo(om_client, sink, now)),
        scheduler.Job("ana", 900, lambda now: ana.collect_ana(source, sink, now)),
        scheduler.Job("detector", runner.DETECTOR_INTERVAL_S,
                      runner.make_detector_job(sink, pg, detector_cfg)),
        scheduler.Job("status", STATUS_INTERVAL_S, make_status_job(status_sink, pg, version, started_at)),
    ]
    return jobs, [om_client, ana_client, *extra]


def cmd_run(jobs_factory=build_jobs) -> int:
    from .pg import FanOutStatus, PgConnection, PgJobStatus
    from .sinks.influx import InfluxSink
    from .sinks.status import InfluxJobStatus

    settings = Settings.from_env()
    sink = InfluxSink(settings.influx_url, settings.influx_org, settings.influx_token)
    pg = PgConnection(settings.pg_dsn)   # lazy: connects on the first job/status that needs it
    stopping = False

    def _stop(signum, _frame):
        nonlocal stopping
        stopping = True
        log("INFO", "worker", "stop requested", signal=signal.Signals(signum).name)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    started_at = scheduler.utcnow()   # captured once, at process start
    try:
        jobs, closers = jobs_factory(sink, pg, settings.detector_config_path,
                                     started_at=started_at)
    except Exception:
        pg.close()
        sink.close()
        raise
    log("INFO", "worker", "started", jobs=len(jobs))
    status = FanOutStatus(InfluxJobStatus(sink), PgJobStatus(pg))
    try:
        scheduler.run_forever(
            jobs, status, sleep=_interruptible_sleep(lambda: stopping), stop=lambda: stopping
        )
    finally:
        for c in closers:
            c.close()
        pg.close()
        sink.close()
    log("INFO", "worker", "stopped")
    return 0


def _interruptible_sleep(is_stopping):
    def _sleep(seconds: float) -> None:
        end = time.monotonic() + seconds
        while not is_stopping() and time.monotonic() < end:
            time.sleep(min(0.5, max(0.0, end - time.monotonic())))
    return _sleep


def cmd_backfill_openmeteo(start: str, end: str | None) -> int:
    from datetime import date, datetime, timedelta, timezone

    from .collectors import openmeteo
    from .sinks.influx import InfluxSink

    d_start = date.fromisoformat(start)
    d_end = date.fromisoformat(end) if end else datetime.now(timezone.utc).date() - timedelta(days=1)
    if d_end < d_start:
        log("ERROR", "backfill-openmeteo", "end before start")
        return 2
    settings = Settings.from_env()
    sink = InfluxSink(settings.influx_url, settings.influx_org, settings.influx_token)
    try:
        with openmeteo.make_client() as client:
            openmeteo.backfill_openmeteo(client, sink, d_start, d_end)
    finally:
        sink.close()
    return 0


def cmd_backfill_ana(start: str, end: str | None) -> int:
    from datetime import date, datetime, timedelta, timezone

    from .collectors import ana
    from .sinks.influx import InfluxSink

    d_start = date.fromisoformat(start)
    d_end = date.fromisoformat(end) if end else datetime.now(timezone.utc).date() - timedelta(days=1)
    if d_end < d_start:
        log("ERROR", "backfill-ana", "end before start")
        return 2
    settings = Settings.from_env()
    sink = InfluxSink(settings.influx_url, settings.influx_org, settings.influx_token)
    try:
        with ana.make_client() as client:
            ana.backfill_ana(ana.AnaLegacySource(client), sink, d_start, d_end)
    finally:
        sink.close()
    return 0


def cmd_detect_once() -> int:
    """One detector cycle, then exit: 0 on success, 1 on any failure (error text redacted)."""
    from .detector import runner
    from .detector.config import load_detector_config
    from .pg import PgConnection
    from .redact import redact_error
    from .sinks.influx import InfluxSink

    settings = Settings.from_env()
    cfg = load_detector_config(settings.detector_config_path)
    sink = InfluxSink(settings.influx_url, settings.influx_org, settings.influx_token)
    pg = PgConnection(settings.pg_dsn)
    try:
        runner.detect_cycle(scheduler.utcnow(), sink, pg, cfg)
    except Exception as exc:
        log("ERROR", "detector", "detect-once failed", error=redact_error(exc))
        return 1
    finally:
        pg.close()
        sink.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "healthcheck":
        return healthcheck()
    if args.command == "run":
        from .detector.config import ConfigError
        try:
            return cmd_run()
        except (RuntimeError, ConfigError) as exc:
            log("ERROR", "worker", str(exc))
            return 2
    if args.command == "backfill-openmeteo":
        try:
            return cmd_backfill_openmeteo(args.start, args.end)
        except RuntimeError as exc:
            log("ERROR", "worker", str(exc))
            return 2
    if args.command == "backfill-ana":
        try:
            return cmd_backfill_ana(args.start, args.end)
        except RuntimeError as exc:
            log("ERROR", "worker", str(exc))
            return 2
    if args.command == "detect-once":
        from .detector.config import ConfigError
        try:
            return cmd_detect_once()
        except (RuntimeError, ConfigError) as exc:
            log("ERROR", "worker", str(exc))
            return 2
    log("ERROR", "worker", f"command {args.command} not implemented yet")
    return 2


if __name__ == "__main__":
    sys.exit(main())
