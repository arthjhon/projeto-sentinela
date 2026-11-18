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


def test_influx_sink_has_an_explicit_60s_http_timeout():
    from sentinela_worker.sinks.influx import HTTP_TIMEOUT_MS, InfluxSink
    sink = InfluxSink("http://127.0.0.1:9", "org", "token")   # no connection is made
    try:
        assert HTTP_TIMEOUT_MS == 60_000
        assert sink._client.api_client.configuration.timeout == 60_000
    finally:
        sink.close()
