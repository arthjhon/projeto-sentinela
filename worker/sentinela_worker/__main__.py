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


def cmd_run() -> int:
    from .sinks.influx import InfluxSink
    from .sinks.status import InfluxJobStatus

    settings = Settings.from_env()
    sink = InfluxSink(settings.influx_url, settings.influx_org, settings.influx_token)
    stopping = False

    def _stop(signum, _frame):
        nonlocal stopping
        stopping = True
        log("INFO", "worker", "stop requested", signal=signal.Signals(signum).name)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    jobs: list[scheduler.Job] = []  # later tasks register jobs here
    log("INFO", "worker", "started", jobs=len(jobs))
    try:
        scheduler.run_forever(
            jobs, InfluxJobStatus(sink), sleep=_interruptible_sleep(lambda: stopping), stop=lambda: stopping
        )
    finally:
        sink.close()
    log("INFO", "worker", "stopped")
    return 0


def _interruptible_sleep(is_stopping):
    def _sleep(seconds: float) -> None:
        end = time.monotonic() + seconds
        while not is_stopping() and time.monotonic() < end:
            time.sleep(min(0.5, max(0.0, end - time.monotonic())))
    return _sleep


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "healthcheck":
        return healthcheck()
    if args.command == "run":
        try:
            return cmd_run()
        except RuntimeError as exc:
            log("ERROR", "worker", str(exc))
            return 2
    log("ERROR", "worker", f"command {args.command} not implemented yet")
    return 2


if __name__ == "__main__":
    sys.exit(main())
