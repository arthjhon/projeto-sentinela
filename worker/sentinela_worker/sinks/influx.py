import pandas as pd
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS


# Explicit HTTP timeout (ms) for every write and query: a hung InfluxDB fails the job
# (recorded in its status) instead of blocking the scheduler loop forever.
HTTP_TIMEOUT_MS = 60_000


class InfluxSink:
    def __init__(self, url: str, org: str, token: str):
        self._org = org
        self._client = InfluxDBClient(url=url, org=org, token=token, timeout=HTTP_TIMEOUT_MS)
        self._write_api = self._client.write_api(write_options=SYNCHRONOUS)
        self._query_api = self._client.query_api()

    def write(self, bucket: str, points: list[Point]) -> None:
        if points:
            self._write_api.write(bucket=bucket, org=self._org, record=points)

    def query_df(self, flux: str) -> pd.DataFrame:
        result = self._query_api.query_data_frame(flux, org=self._org)
        if isinstance(result, list):
            return pd.concat(result, ignore_index=True) if result else pd.DataFrame()
        return result

    def close(self) -> None:
        self._client.close()
