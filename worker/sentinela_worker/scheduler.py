import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from .log import log
from .sinks.status import JobStatusSink

TICK_FILE = os.environ.get("WORKER_TICK_FILE", "/tmp/sentinela-worker.tick")
MAX_SLEEP_S = 30


@dataclass(frozen=True)
class Job:
    name: str
    interval_s: int
    fn: Callable[[datetime], None]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def touch_tick(path: str | None = None) -> None:
    path = path or TICK_FILE
    with open(path, "a"):
        pass
    os.utime(path, None)


def _run_job(job: Job, status: JobStatusSink, now: Callable[[], datetime]) -> None:
    started = now()
    t0 = time.monotonic()
    error: str | None = None
    try:
        job.fn(started)
    except Exception as exc:  # a failing job must not stop the others
        error = f"{type(exc).__name__}: {exc}"
    duration = time.monotonic() - t0
    ok = error is None
    log("INFO" if ok else "ERROR", job.name, "job ok" if ok else "job failed",
        duration_s=round(duration, 3), **({"error": error} if error else {}))
    try:
        status.record(job.name, ok, started, duration, error)
    except Exception as exc:
        log("ERROR", job.name, "status record failed", error=f"{type(exc).__name__}: {exc}")


def run_forever(
    jobs: list[Job],
    status: JobStatusSink,
    now: Callable[[], datetime] = utcnow,
    sleep: Callable[[float], None] = time.sleep,
    stop: Callable[[], bool] = lambda: False,
) -> None:
    due = {job.name: now() for job in jobs}  # every job runs once at startup
    while not stop():
        touch_tick()
        current = now()
        for job in jobs:
            if due[job.name] <= current:
                _run_job(job, status, now)
                step = timedelta(seconds=job.interval_s)
                due[job.name] += step
                if due[job.name] <= current:  # fell behind: skip missed runs
                    due[job.name] = now() + step
        if stop():
            break
        wait = min((d for d in due.values()), default=now() + timedelta(seconds=MAX_SLEEP_S)) - now()
        sleep(max(0.0, min(wait.total_seconds(), MAX_SLEEP_S)))
