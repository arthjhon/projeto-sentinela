"""ANA telemetry collector, behind the `AnaSource` interface.

Two sources, chosen by `ANA_SOURCE` (`make_ana_source`): `hidrowebservice` (default; OAuth
service, one request for all stations, see `hidroweb.py`) and `legado` (rollback; the public
ServiceANA.asmx). A source with `fetch_many` is called once per window; one without it
(legacy) is called per station. The legacy service is fragile: one request per station,
pauses between requests, bounded response size. Times are local (America/Maceio, UTC-3, no
DST); points are written in UTC. The legacy XML row element is misspelled by ANA
(`DadosHidrometereologicos`) and must be matched as such.
"""
import calendar
import math
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import PackageNotFoundError, version
from collections.abc import Mapping
from typing import Protocol
from zoneinfo import ZoneInfo

import httpx
from influxdb_client import Point

from ..log import log
from ..redact import redact_error

BASE_URL = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos"
ESTACOES = ("39770000", "39760000", "39740000", "39700000", "39800100")
PRIMARY = "39770000"   # Fazenda Boa Fortuna: the station the collect job is judged on
NOTE_MAX_CHARS = 200   # partial-failure note recorded as worker_jobs.erro of an ok run
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
    vazao_status: int | None = None   # HidroWebService only; legacy source leaves these None
    nivel_status: int | None = None
    chuva_status: int | None = None


class AnaSourceInvalid(RuntimeError):
    """Invalid ANA_SOURCE: fails only the `ana` job (and backfill-ana), never the worker."""
    permanent = True


class _InvalidSource:
    max_window_days = 29

    def __init__(self, value: str):
        self._msg = f"ANA_SOURCE inválido: {value[:40]!r}; use hidrowebservice ou legado"

    def fetch_many(self, estacoes, inicio, fim):
        raise AnaSourceInvalid(self._msg)

    def fetch(self, estacao, inicio, fim):
        raise AnaSourceInvalid(self._msg)


class AnaSource(Protocol):
    def fetch(self, estacao: str, inicio: datetime, fim: datetime) -> list[AnaReading]: ...


def make_client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT, headers={"User-Agent": USER_AGENT})


def make_ana_source(env: Mapping[str, str], client: httpx.Client) -> AnaSource:
    """`ANA_SOURCE`: `hidrowebservice` (default) or `legado`. Anything else returns a source
    that fails only the ana job with a clear message (a bad .env must not crash the worker).
    Missing credentials are not checked here: the HidroWeb source fails the job at run time."""
    name = (env.get("ANA_SOURCE") or "hidrowebservice").strip().lower()
    if name == "legado":
        return AnaLegacySource(client)
    if name == "hidrowebservice":
        from .hidroweb import HidroWebSource  # lazy: hidroweb imports this module
        return HidroWebSource(client, env.get("ANA_HIDRO_USER") or None, env.get("ANA_HIDRO_PASS") or None)
    return _InvalidSource(name)


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
            for k, v in (("vazao_status", r.vazao_status), ("nivel_status", r.nivel_status),
                         ("chuva_status", r.chuva_status)):
                if v is not None:
                    p = p.field(k, int(v))
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


def _write_batch(sink, data: dict[str, list[AnaReading]], job: str) -> None:
    for estacao in ESTACOES:
        points = _points(data.get(estacao, []))
        if points:
            sink.write(BUCKET, points)
        log("INFO", job, "station done", estacao=estacao, points=len(points))


def collect_ana(source: AnaSource, sink, now: datetime, sleep=time.sleep) -> str | None:
    """With a batch source (`fetch_many`): one request for every station over now-48h..now.
    A raised error means the whole request failed, hence the primary station too: the job
    fails. A station with [] is a success with 0 points.

    Per-station source (legacy). Window now-48h..now, one request per station. A failing station does not skip the
    others. The job fails (raises, listing every failed station) only when the primary
    station fails; otherwise the failed secondary stations come back as a short note that
    the scheduler records in the status of an ok run. An ErrorTable ("no data") is a
    successful request with zero points, never a failure."""
    if hasattr(source, "fetch_many"):
        _write_batch(sink, source.fetch_many(ESTACOES, now - COLLECT_WINDOW, now), "collect-ana")
        return None
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
    if PRIMARY in failed:
        _raise_if_failed("collect-ana", failed)
    if failed:
        return f"estacoes secundarias com falha: {', '.join(failed)}"[:NOTE_MAX_CHARS]
    return None


def _month_chunks(start: date, end: date):
    cur = start
    while cur <= end:
        stop = min(date(cur.year, cur.month, calendar.monthrange(cur.year, cur.month)[1]), end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def _window_chunks(start: date, end: date, days: int):
    cur = start
    while cur <= end:
        stop = min(cur + timedelta(days=days - 1), end)
        yield cur, stop
        cur = stop + timedelta(days=1)


def backfill_ana(source: AnaSource, sink, start: date, end: date, sleep=time.sleep) -> None:
    """Batch source: chunks of at most `max_window_days` days (UTC days, inclusive), one
    `fetch_many` per chunk, >=2 s between requests. Per-station source: monthly chunks per
    station. Idempotent: points are keyed by (estacao, time)."""
    if hasattr(source, "fetch_many"):
        failed_chunks = 0
        for i, (c_start, c_end) in enumerate(_window_chunks(start, end, source.max_window_days)):
            if i:
                sleep(BACKFILL_SLEEP_S)
            inicio = datetime(c_start.year, c_start.month, c_start.day, tzinfo=timezone.utc)
            fim = datetime(c_end.year, c_end.month, c_end.day, 23, 59, 59, tzinfo=timezone.utc)
            try:
                data = source.fetch_many(ESTACOES, inicio, fim)
                _write_batch(sink, data, "backfill-ana")
            except Exception as exc:
                log("ERROR", "backfill-ana", "chunk failed", start=c_start.isoformat(),
                    end=c_end.isoformat(), error=redact_error(exc))
                if getattr(exc, "permanent", False):
                    raise  # credentials/config problem: every later chunk would fail the same way
                failed_chunks += 1
        if failed_chunks:
            raise RuntimeError(f"backfill-ana failed for {failed_chunks} chunk(s)")
        return
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
