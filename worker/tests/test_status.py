from datetime import datetime, timezone

from sentinela_worker.sinks.status import InfluxJobStatus


class FakeSink:
    def __init__(self):
        self.writes = []

    def write(self, bucket, points):
        self.writes.append((bucket, points))


def test_records_worker_status_in_qualidade_bucket():
    sink = FakeSink()
    started = datetime(2026, 1, 1, 12, tzinfo=timezone.utc)
    InfluxJobStatus(sink).record("openmeteo", False, started, 1.5, "boom")
    bucket, points = sink.writes[0]
    line = points[0].to_line_protocol()
    assert bucket == "qualidade"
    assert line.startswith("worker_status,job=openmeteo ")
    assert "ok=false" in line and 'error="boom"' in line and "duration_s=1.5" in line
