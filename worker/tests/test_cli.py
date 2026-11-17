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
        out, _ = proc.communicate(timeout=10)
    finally:
        if proc.poll() is None:
            proc.kill()
    assert proc.returncode == 0
    lines = [json.loads(line) for line in out.splitlines()]
    assert {"ts", "level", "job", "msg"} <= set(lines[0])
    assert lines[-1]["msg"] == "stopped"
