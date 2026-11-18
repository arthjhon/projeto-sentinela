"""Live check of the ingestao Flux against a real InfluxDB. Skipped unless TEST_INFLUX_URL is set.

Run (throwaway container; never touches the sentinela-influxdb-* volumes):
  docker run -d --name tmp-influx-status -p 18086:8086 \\
    -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=t \\
    -e DOCKER_INFLUXDB_INIT_PASSWORD=testpassword1 -e DOCKER_INFLUXDB_INIT_ORG=o \\
    -e DOCKER_INFLUXDB_INIT_BUCKET=iot -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=testtoken influxdb:2.7.12
  TEST_INFLUX_URL=http://127.0.0.1:18086 TEST_INFLUX_TOKEN=testtoken TEST_INFLUX_ORG=o \\
    DOCKER_NETWORK=host bash worker/scripts/test.sh -k status_influx_live
  docker rm -f -v tmp-influx-status
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from influxdb_client import Point

from sentinela_worker.pg import Buoy
from sentinela_worker.sinks.influx import InfluxSink
from sentinela_worker.status_job import _last_points, check_ingestao

URL = os.environ.get("TEST_INFLUX_URL")
pytestmark = pytest.mark.skipif(not URL, reason="TEST_INFLUX_URL not set")


def test_ingestao_takes_max_time_across_fields_per_device():
    sink = InfluxSink(URL, os.environ.get("TEST_INFLUX_ORG", "o"),
                      os.environ.get("TEST_INFLUX_TOKEN", "testtoken"))
    try:
        now = datetime.now(timezone.utc).replace(microsecond=0)

        def pt(dev, field, t):
            return Point("sensores").tag("device_id", dev).field(field, 1.0).time(t)

        # devA: "temp" series ended 20 min ago, "ph" is fresh. Series sort alphabetically
        # (ph < temp), so the stale series comes LAST: a plain last() would return it.
        sink.write("iot", [pt("devA", "ph", now - timedelta(seconds=20)),
                           pt("devA", "temp", now - timedelta(minutes=20)),
                           pt("devA", "temp", now - timedelta(minutes=21)),
                           pt("devB", "temp", now - timedelta(minutes=5)),
                           pt("devB", "turb", now - timedelta(minutes=9))])
        got = _last_points(sink)
        assert abs((got["devA"] - (now - timedelta(seconds=20))).total_seconds()) < 1
        assert abs((got["devB"] - (now - timedelta(minutes=5))).total_seconds()) < 1
        row = check_ingestao(sink, [Buoy("A", "devA", "campo", None)], now)
        assert row.estado == "ok"
    finally:
        sink.close()
