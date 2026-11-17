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


def test_build_jobs_registers_openmeteo_and_ana():
    jobs, closers = cli.build_jobs(object())
    try:
        assert [(j.name, j.interval_s) for j in jobs] == [("openmeteo", 3600), ("ana", 900)]
        assert len(closers) == 2
    finally:
        for c in closers:
            c.close()


def test_cmd_run_uses_factory_and_closes_clients(monkeypatch):
    monkeypatch.setenv("INFLUX_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("INFLUX_ORG", "o")
    monkeypatch.setenv("INFLUX_WORKER_TOKEN", "t")
    monkeypatch.setenv("PG_WORKER_DSN", "postgresql://x")
    closed = []

    class Closer:
        def close(self):
            closed.append(1)

    seen = {}

    def fake_run_forever(jobs, status, **kw):
        seen["jobs"] = jobs

    monkeypatch.setattr(cli.scheduler, "run_forever", fake_run_forever)
    assert cli.cmd_run(lambda sink: ([], [Closer(), Closer()])) == 0
    assert seen["jobs"] == [] and len(closed) == 2
