"""Open-Meteo collector.

Forecasts are stored by lead time (`antecedencia_h`), not by issue time: the point's
`_time` is the forecast hour, so re-fetching the same lead overwrites itself.
"""
import calendar
import time
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import PackageNotFoundError, version

import httpx
from influxdb_client import Point

from ..log import log

VARIABLES = (
    "precipitation",
    "precipitation_probability",
    "cloud_cover",
    "shortwave_radiation",
    "temperature_2m",
    "wind_speed_10m",
    "wind_direction_10m",
)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com/v1/forecast"
CELMM_LAT = -9.6559
CELMM_LON = -35.7701
# (ponto, lat, lon). bacia_mundau = ANA station 39770000 coordinates (HidroWebService
# inventory, queried 2026-11-22).
PONTOS = (
    ("celmm", CELMM_LAT, CELMM_LON),
    ("bacia_mundau", -9.4672, -35.8597),
)
CURRENT_MEASUREMENT = "previsao_atual"
BUCKET = "externos"
MEASUREMENT = "previsao"
MODEL = "best_match"
MAX_LEAD_H = 168
BACKFILL_SLEEP_S = 1.0
TIMEOUT = httpx.Timeout(30.0, connect=10.0)

try:
    _VERSION = version("sentinela-worker")
except PackageNotFoundError:
    _VERSION = "0.1.0"
USER_AGENT = f"sentinela-worker/{_VERSION}"


def make_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})


def _get(client: httpx.Client, url: str, params: dict) -> dict:
    resp = client.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def fetch_forecast(client: httpx.Client, lat: float, lon: float) -> dict:
    return _get(
        client,
        FORECAST_URL,
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": ",".join(VARIABLES),
            "forecast_days": 7,
            "timezone": "UTC",
        },
    )


def fetch_previous_runs(client: httpx.Client, lat: float, lon: float, start: date, end: date) -> dict:
    hourly = ",".join(f"{v}_previous_day{n}" for v in VARIABLES for n in range(1, 8))
    return _get(
        client,
        PREVIOUS_RUNS_URL,
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": hourly,
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "timezone": "UTC",
        },
    )


def _parse_time(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)


def _point(t: datetime, lead_h: int | None, fields: dict, ponto: str = "celmm") -> Point:
    p = (
        Point(MEASUREMENT if lead_h is not None else CURRENT_MEASUREMENT)
        .tag("fonte", "openmeteo")
        .tag("modelo", MODEL)
        .tag("ponto", ponto)
        .time(t)
    )
    if lead_h is not None:
        p = p.tag("antecedencia_h", str(lead_h))
    for name, value in fields.items():
        p = p.field(name, float(value))
    return p


def _column(hourly: dict, key: str, n: int) -> list | None:
    col = hourly.get(key)
    if col is None:
        return None
    if len(col) != n:
        raise ValueError(f"column {key} has {len(col)} values for {n} timestamps")
    return col


def _lead_points(payload: dict, fetched_at: datetime, ponto: str, with_lead: bool) -> list[Point]:
    hourly = payload["hourly"]
    times = hourly["time"]
    cols = {v: _column(hourly, v, len(times)) for v in VARIABLES}
    base = fetched_at.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    points = []
    for i, ts in enumerate(times):
        t = _parse_time(ts)
        lead = int((t - base).total_seconds() // 3600)
        if lead < 0 or lead > MAX_LEAD_H:
            continue
        fields = {v: c[i] for v, c in cols.items() if c is not None and c[i] is not None}
        if fields:
            points.append(_point(t, lead if with_lead else None, fields, ponto))
    return points


def forecast_points(payload: dict, fetched_at: datetime, ponto: str = "celmm") -> list[Point]:
    return _lead_points(payload, fetched_at, ponto, True)


def current_points(payload: dict, fetched_at: datetime, ponto: str) -> list[Point]:
    """Latest forecast for the future hours: no lead tag, overwritten by each collection."""
    return _lead_points(payload, fetched_at, ponto, False)


def previous_runs_points(payload: dict) -> list[Point]:
    hourly = payload["hourly"]
    times = hourly["time"]
    points = []
    for n in range(1, 8):
        cols = {v: _column(hourly, f"{v}_previous_day{n}", len(times)) for v in VARIABLES}
        for i, ts in enumerate(times):
            fields = {v: c[i] for v, c in cols.items() if c is not None and c[i] is not None}
            if fields:
                points.append(_point(_parse_time(ts), 24 * n, fields))
    return points


def collect_openmeteo(client: httpx.Client, sink, now: datetime) -> None:
    """One write per point; a failing point does not block the others.

    Nothing is written for a point unless it fully parsed. Raises the first error at the end.
    """
    first_error: Exception | None = None
    for ponto, lat, lon in PONTOS:
        try:
            payload = fetch_forecast(client, lat, lon)
            points = forecast_points(payload, now, ponto) + current_points(payload, now, ponto)
            sink.write(BUCKET, points)
        except Exception as exc:
            log("ERROR", "openmeteo", "point failed", ponto=ponto, error=str(exc))
            if first_error is None:
                first_error = exc
    if first_error is not None:
        raise first_error


def _month_chunks(start: date, end: date):
    cur = start
    while cur <= end:
        last = date(cur.year, cur.month, calendar.monthrange(cur.year, cur.month)[1])
        stop = min(last, end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def backfill_openmeteo(client: httpx.Client, sink, start: date, end: date, sleep=time.sleep) -> None:
    first = True
    for c_start, c_end in _month_chunks(start, end):
        if not first:
            sleep(BACKFILL_SLEEP_S)
        first = False
        payload = fetch_previous_runs(client, CELMM_LAT, CELMM_LON, c_start, c_end)
        points = previous_runs_points(payload)
        sink.write(BUCKET, points)
        log(
            "INFO",
            "backfill-openmeteo",
            "chunk done",
            start=c_start.isoformat(),
            end=c_end.isoformat(),
            points=len(points),
        )
