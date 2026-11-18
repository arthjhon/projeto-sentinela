import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from .log import log
from .redact import MAX_ERROR_LEN, redact_error, redact_text
from .sinks.status import JobStatusSink

TICK_FILE = os.environ.get("WORKER_TICK_FILE", "/tmp/sentinela-worker.tick")
MAX_SLEEP_S = 30


@dataclass(frozen=True)
class Job:
    name: str
    interval_s: int
    # Returns None, or a short note (partial failure that does not fail the job): the
    # run is recorded ok, with the note in the status error field.
    fn: Callable[[datetime], str | None]


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
    note: str | None = None
    try:
        result = job.fn(started)
        if isinstance(result, str) and result:
            note = redact_text(result)[:MAX_ERROR_LEN]
    except Exception as exc:  # a failing job must not stop the others
        error = redact_error(exc)
    duration = time.monotonic() - t0
    ok = error is None
    if not ok:
        log("ERROR", job.name, "job failed", duration_s=round(duration, 3), error=error)
    elif note:
        log("WARN", job.name, "job ok with partial failure", duration_s=round(duration, 3), note=note)
    else:
        log("INFO", job.name, "job ok", duration_s=round(duration, 3))
    try:
        status.record(job.name, ok, started, duration, error if not ok else note)
    except Exception as exc:
        log("ERROR", job.name, "status record failed", error=redact_error(exc))


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
