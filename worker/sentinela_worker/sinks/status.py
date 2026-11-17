from datetime import datetime
from typing import Protocol

from influxdb_client import Point

STATUS_BUCKET = "qualidade"
STATUS_MEASUREMENT = "worker_status"


class JobStatusSink(Protocol):
    def record(
        self, job: str, ok: bool, started: datetime, duration_s: float, error: str | None
    ) -> None: ...


class InfluxJobStatus:
    def __init__(self, sink):
        self._sink = sink

    def record(
        self, job: str, ok: bool, started: datetime, duration_s: float, error: str | None
    ) -> None:
        point = (
            Point(STATUS_MEASUREMENT)
            .tag("job", job)
            .field("ok", ok)
            .field("duration_s", float(duration_s))
            .field("error", error or "")
            .time(started)
        )
        self._sink.write(STATUS_BUCKET, [point])
