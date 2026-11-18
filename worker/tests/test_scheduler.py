from datetime import datetime, timedelta, timezone

import pytest

from sentinela_worker import scheduler
from sentinela_worker.scheduler import Job, run_forever

T0 = datetime(2026, 1, 1, tzinfo=timezone.utc)


class FakeClock:
    def __init__(self):
        self.t = T0

    def now(self):
        return self.t

    def sleep(self, s):
        self.t += timedelta(seconds=s)


class FakeStatus:
    def __init__(self):
        self.calls = []

    def record(self, job, ok, started, duration_s, error):
        self.calls.append((job, ok, error))


@pytest.fixture(autouse=True)
def tick_file(tmp_path, monkeypatch):
    monkeypatch.setattr(scheduler, "TICK_FILE", str(tmp_path / "tick"))
    return tmp_path / "tick"


def run_for(jobs, status, seconds):
    clock = FakeClock()
    end = T0 + timedelta(seconds=seconds)
    run_forever(jobs, status, now=clock.now, sleep=clock.sleep, stop=lambda: clock.t >= end)


def test_jobs_run_at_their_interval():
    runs = {"quarter": 0, "hourly": 0}
    jobs = [
        Job("quarter", 900, lambda now: runs.__setitem__("quarter", runs["quarter"] + 1)),
        Job("hourly", 3600, lambda now: runs.__setitem__("hourly", runs["hourly"] + 1)),
    ]
    run_for(jobs, FakeStatus(), 3600 - 1)
    assert runs == {"quarter": 4, "hourly": 1}


def test_failing_job_does_not_stop_others():
    ran = []

    def boom(now):
        raise ValueError("kaput")

    status = FakeStatus()
    run_for([Job("a", 900, boom), Job("b", 900, lambda now: ran.append(now))], status, 899)
    assert len(ran) == 1
    assert ("a", False, "ValueError: kaput") in status.calls
    assert ("b", True, None) in status.calls


def test_job_note_is_recorded_on_an_ok_run(capsys):
    status = FakeStatus()
    run_for([Job("a", 900, lambda now: "estacoes secundarias com falha: 1 ?token=abc")], status, 10)
    assert status.calls == [("a", True, "estacoes secundarias com falha: 1 ?token=***")]
    assert "job ok with partial failure" in capsys.readouterr().out


def test_non_string_job_result_is_ignored():
    status = FakeStatus()
    run_for([Job("a", 900, lambda now: 42)], status, 10)
    assert status.calls == [("a", True, None)]


def test_job_runs_once_at_startup():
    ran = []
    run_for([Job("a", 3600, lambda now: ran.append(now))], FakeStatus(), 10)
    assert ran == [T0]


def test_loop_writes_tick_file_even_without_jobs(tick_file):
    run_for([], FakeStatus(), 60)
    assert tick_file.exists()
