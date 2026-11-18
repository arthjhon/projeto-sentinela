import json
import os
import signal
import subprocess
import sys
import time

from sentinela_worker import __main__ as cli


def test_healthcheck_fresh_stale_and_missing(tmp_path):
    f = tmp_path / "tick"
    assert cli.healthcheck(str(f)) == 1
    f.touch()
    assert cli.healthcheck(str(f)) == 0
    old = time.time() - 601
    os.utime(f, (old, old))
    assert cli.healthcheck(str(f)) == 1


def test_run_writes_tick_and_stops_on_sigterm(tmp_path):
    tick = tmp_path / "tick"
    env = {
        **os.environ,
        "WORKER_TICK_FILE": str(tick),
        "INFLUX_URL": "http://127.0.0.1:1",
        "INFLUX_ORG": "o",
        "INFLUX_WORKER_TOKEN": "t",
        "PG_WORKER_DSN": "postgresql://x",
        # startup jobs must fail fast and never reach the real internet
        "HTTP_PROXY": "http://127.0.0.1:1",
        "HTTPS_PROXY": "http://127.0.0.1:1",
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "sentinela_worker", "run"], env=env, stdout=subprocess.PIPE, text=True
    )
    try:
        for _ in range(100):
            if tick.exists():
                break
            time.sleep(0.1)
        assert tick.exists()
        proc.send_signal(signal.SIGTERM)
        out, _ = proc.communicate(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == 0
    lines = [json.loads(line) for line in out.splitlines()]
    assert {"ts", "level", "job", "msg"} <= set(lines[0])
    assert lines[-1]["msg"] == "stopped"


def test_backfill_openmeteo_cli_wiring(monkeypatch):
    calls = {}
    monkeypatch.setenv("INFLUX_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("INFLUX_ORG", "o")
    monkeypatch.setenv("INFLUX_WORKER_TOKEN", "t")
    monkeypatch.setenv("PG_WORKER_DSN", "postgresql://x")
    from sentinela_worker.collectors import openmeteo

    def fake(client, sink, start, end, **kw):
        calls["args"] = (start, end)

    monkeypatch.setattr(openmeteo, "backfill_openmeteo", fake)
    assert cli.main(["backfill-openmeteo", "--start", "2024-06-01", "--end", "2024-06-03"]) == 0
    import datetime as dt
    assert calls["args"] == (dt.date(2024, 6, 1), dt.date(2024, 6, 3))
    assert cli.main(["backfill-openmeteo", "--start", "2024-06-01"]) == 0
    assert calls["args"][1] == dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)


def test_build_jobs_registers_openmeteo_ana_detector_and_status():
    jobs, closers = cli.build_jobs(object(), object(), "config/detector.yaml")
    try:
        assert [(j.name, j.interval_s) for j in jobs] == [
            ("openmeteo", 3600), ("ana", 900), ("detector", 300), ("status", 60)]
        assert len(closers) == 2
    finally:
        for c in closers:
            c.close()


def test_build_jobs_fails_fast_on_invalid_detector_config(tmp_path):
    import pytest
    from sentinela_worker.detector.config import ConfigError
    bad = tmp_path / "d.yaml"
    bad.write_text("sensores: {}\n")
    with pytest.raises(ConfigError):
        cli.build_jobs(object(), object(), str(bad))


def _env(monkeypatch, dsn="postgresql://u@127.0.0.1:1/x"):
    monkeypatch.setenv("INFLUX_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("INFLUX_ORG", "o")
    monkeypatch.setenv("INFLUX_WORKER_TOKEN", "t")
    monkeypatch.setenv("PG_WORKER_DSN", dsn)
    monkeypatch.setenv("DETECTOR_CONFIG", "config/detector.yaml")


def test_detect_once_exits_nonzero_when_postgres_is_unreachable(monkeypatch, capsys):
    _env(monkeypatch, dsn="postgresql://u:s3cr3tpw@127.0.0.1:1/x")
    assert cli.main(["detect-once"]) == 1
    out = capsys.readouterr().out
    assert "detect-once failed" in out and "s3cr3tpw" not in out


def test_detect_once_with_invalid_config_exits_2(monkeypatch, tmp_path):
    _env(monkeypatch)
    bad = tmp_path / "d.yaml"
    bad.write_text("sensores: {}\n")
    monkeypatch.setenv("DETECTOR_CONFIG", str(bad))
    assert cli.main(["detect-once"]) == 2


def test_detect_once_runs_one_cycle(monkeypatch):
    _env(monkeypatch)
    from sentinela_worker.detector import runner
    calls = []
    monkeypatch.setattr(runner, "detect_cycle", lambda now, influx, pg, cfg: calls.append(now))
    assert cli.main(["detect-once"]) == 0
    assert len(calls) == 1 and calls[0].tzinfo is not None


def test_detector_job_resets_connection_on_operational_error(monkeypatch):
    import psycopg
    import pytest
    from sentinela_worker.detector import runner

    class Pg:
        resets = 0

        def reset(self):
            Pg.resets += 1

    def boom(now, influx, pg, cfg):
        raise psycopg.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(runner, "detect_cycle", boom)
    fn = runner.make_detector_job(object(), Pg(), object())
    with pytest.raises(psycopg.OperationalError):
        fn(None)
    assert Pg.resets == 1


def test_cmd_run_uses_factory_closes_clients_and_fans_out_status(monkeypatch):
    _env(monkeypatch)
    closed = []

    class Closer:
        def close(self):
            closed.append(1)

    seen = {}

    def fake_run_forever(jobs, status, **kw):
        seen["jobs"], seen["status"] = jobs, status

    def factory(sink, pg, cfg_path, **kw):
        seen["kw"] = kw
        seen["pg"], seen["cfg_path"] = pg, cfg_path
        return [], [Closer(), Closer()]

    monkeypatch.setattr(cli.scheduler, "run_forever", fake_run_forever)
    assert cli.cmd_run(factory) == 0
    assert seen["jobs"] == [] and len(closed) == 2
    assert seen["cfg_path"] == "config/detector.yaml"
    assert seen["kw"]["started_at"].tzinfo is not None   # captured once, at process start
    from sentinela_worker.pg import FanOutStatus, PgConnection, PgJobStatus
    from sentinela_worker.sinks.status import InfluxJobStatus
    assert isinstance(seen["pg"], PgConnection)
    assert isinstance(seen["status"], FanOutStatus)
    assert [type(s) for s in seen["status"]._sinks] == [InfluxJobStatus, PgJobStatus]
