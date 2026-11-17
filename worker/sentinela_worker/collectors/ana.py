"""ANA telemetry collector (legacy ServiceANA.asmx), behind the `AnaSource` interface.

The legacy service is public and fragile: one request per station, pauses between
requests, bounded response size. `DataHora` is local time (America/Maceio, UTC-3, no
DST); points are written in UTC. The XML row element is misspelled by ANA
(`DadosHidrometereologicos`) and must be matched as such.
"""
import calendar
import math
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import PackageNotFoundError, version
from typing import Protocol
from zoneinfo import ZoneInfo

import httpx
from influxdb_client import Point

from ..log import log

BASE_URL = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos"
ESTACOES = ("39770000", "39760000", "39740000", "39700000", "39800100")
BUCKET = "externos"
MEASUREMENT = "ana_telemetria"
ROW_TAG = "DadosHidrometereologicos"  # sic
LOCAL_TZ = ZoneInfo("America/Maceio")
MAX_BODY_BYTES = 10 * 1024 * 1024
COLLECT_WINDOW = timedelta(hours=48)
COLLECT_SLEEP_S = 1.0
BACKFILL_SLEEP_S = 2.0
TIMEOUT = httpx.Timeout(30.0, connect=10.0)

try:
    _VERSION = version("sentinela-worker")
except PackageNotFoundError:
    _VERSION = "0.1.0"
USER_AGENT = f"sentinela-worker/{_VERSION}"


@dataclass
class AnaReading:
    estacao: str
    time: datetime  # UTC
    vazao: float | None
    nivel: float | None
    chuva: float | None


class AnaSource(Protocol):
    def fetch(self, estacao: str, inicio: datetime, fim: datetime) -> list[AnaReading]: ...


def make_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})


def _number(text: str | None) -> tuple[float | None, bool]:
    """Returns (value, malformed). Empty means absent, not malformed."""
    s = (text or "").strip()
    if not s:
        return None, False
    try:
        v = float(s)
    except ValueError:
        return None, True
    if not math.isfinite(v):
        return None, True
    return v, False


def parse_response(body: bytes, estacao: str) -> list[AnaReading]:
    """Parses the DataTable XML. An ErrorTable ("no data") yields []. Rows are not window-filtered."""
    head = body[:4096].upper()
    if b"<!DOCTYPE" in head or b"<!ENTITY" in head:
        raise ValueError("unexpected DTD in ANA response")
    try:
        root = ET.fromstring(body)
    except ET.ParseError as exc:
        raise ValueError(f"invalid ANA XML: {exc}") from None
    readings: list[AnaReading] = []
    malformed = 0
    for row in root.iter(ROW_TAG):
        raw_t = (row.findtext("DataHora") or "").strip()
        try:
            t = datetime.strptime(raw_t, "%Y-%m-%d %H:%M:%S").replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)
        except ValueError:
            malformed += 1
            continue
        vals = []
        for tag in ("Vazao", "Nivel", "Chuva"):
            v, bad = _number(row.findtext(tag))
            malformed += bad
            vals.append(v)
        readings.append(AnaReading(estacao, t, *vals))
    if malformed:
        log("WARN", "ana", "malformed values treated as missing", estacao=estacao, count=malformed)
    return readings


class AnaLegacySource:
    def __init__(self, client: httpx.Client):
        self._client = client

    def fetch(self, estacao: str, inicio: datetime, fim: datetime) -> list[AnaReading]:
        """`inicio`/`fim` are tz-aware, inclusive. ANA reads dd/mm/yyyy in local time, so the
        request spans the local dates of both ends and rows are filtered back to the window."""
        params = {
            "codEstacao": estacao,
            "dataInicio": inicio.astimezone(LOCAL_TZ).strftime("%d/%m/%Y"),
            "dataFim": fim.astimezone(LOCAL_TZ).strftime("%d/%m/%Y"),
        }
        buf = bytearray()
        with self._client.stream(
            "GET", BASE_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
        ) as resp:
            resp.raise_for_status()
            for chunk in resp.iter_bytes():
                buf += chunk
                if len(buf) > MAX_BODY_BYTES:
                    raise ValueError("ANA response too large")
        return [r for r in parse_response(bytes(buf), estacao) if inicio <= r.time <= fim]


def _points(readings: list[AnaReading]) -> list[Point]:
    points = []
    for r in readings:
        fields = {k: v for k, v in (("vazao", r.vazao), ("nivel", r.nivel), ("chuva", r.chuva)) if v is not None}
        if fields:
            p = Point(MEASUREMENT).tag("estacao", r.estacao).time(r.time)
            for k, v in fields.items():
                p = p.field(k, v)
            points.append(p)
    return points


def _fetch_and_write(source: AnaSource, sink, estacao: str, inicio: datetime, fim: datetime) -> int:
    points = _points(source.fetch(estacao, inicio, fim))  # write only after a successful parse
    if points:
        sink.write(BUCKET, points)
    return len(points)


def _raise_if_failed(job: str, failed: list[str]) -> None:
    if failed:
        raise RuntimeError(f"{job} failed for stations: {', '.join(failed)}")


def collect_ana(source: AnaSource, sink, now: datetime, sleep=time.sleep) -> None:
    """Window now-48h..now, one request per station. A failing station does not skip the
    others; after all are attempted an aggregated error is raised."""
    failed = []
    for i, estacao in enumerate(ESTACOES):
        if i:
            sleep(COLLECT_SLEEP_S)
        try:
            n = _fetch_and_write(source, sink, estacao, now - COLLECT_WINDOW, now)
        except Exception as exc:
            failed.append(estacao)
            log("ERROR", "collect-ana", "station failed", estacao=estacao, error=type(exc).__name__)
        else:
            log("INFO", "collect-ana", "station done", estacao=estacao, points=n)
    _raise_if_failed("collect-ana", failed)


def _month_chunks(start: date, end: date):
    cur = start
    while cur <= end:
        stop = min(date(cur.year, cur.month, calendar.monthrange(cur.year, cur.month)[1]), end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def backfill_ana(source: AnaSource, sink, start: date, end: date, sleep=time.sleep) -> None:
    """Monthly chunks per station (UTC days, inclusive), >=2 s between requests. Idempotent:
    points are keyed by (estacao, time)."""
    failed: list[str] = []
    first = True
    for estacao in ESTACOES:
        for c_start, c_end in _month_chunks(start, end):
            if not first:
                sleep(BACKFILL_SLEEP_S)
            first = False
            inicio = datetime(c_start.year, c_start.month, c_start.day, tzinfo=timezone.utc)
            fim = datetime(c_end.year, c_end.month, c_end.day, 23, 59, 59, tzinfo=timezone.utc)
            try:
                n = _fetch_and_write(source, sink, estacao, inicio, fim)
            except Exception as exc:
                if estacao not in failed:
                    failed.append(estacao)
                log("ERROR", "backfill-ana", "chunk failed", estacao=estacao,
                    start=c_start.isoformat(), end=c_end.isoformat(), error=type(exc).__name__)
                continue
            log("INFO", "backfill-ana", "chunk done", estacao=estacao,
                start=c_start.isoformat(), end=c_end.isoformat(), points=n)
    _raise_if_failed("backfill-ana", failed)
