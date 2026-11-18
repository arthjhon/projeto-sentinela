"""`status` job: component checks for the internal status page, written to public.system_status.

Every check is isolated: a failing check becomes a row with estado 'falha' and a short redacted
detail, never an exception. Only a Postgres write failure fails the job (the scheduler records it).
"""
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pandas as pd

from .log import log
from .pg import PgSystemStatus, load_registry
from .redact import redact_error

STATUS_INTERVAL_S = 60
STATUS_HTTP_TIMEOUT_MS = 5_000     # a hung InfluxDB must not stall the sequential scheduler
SOURCE_BUCKET = "iot"
FRESH = timedelta(minutes=2)       # campo buoy: <= 2 min ok
STALE = timedelta(minutes=15)      # (2, 15] min degradado; beyond (or no point) falha

INGESTAO_FLUX = (
    f'from(bucket:"{SOURCE_BUCKET}") |> range(start:-24h)'
    ' |> filter(fn:(r)=> r._measurement=="sensores")'
    ' |> keep(columns:["_time","device_id","_field","_value"])'
    ' |> last()'                                   # per series (pushdown)
    ' |> group(columns:["device_id"]) |> max(column:"_time")'
    ' |> keep(columns:["device_id","_time"])'
)


@dataclass(frozen=True)
class StatusRow:
    componente: str
    estado: str
    detalhe: str
    dados: dict | None
    verificado_em: datetime


def age_text(delta: timedelta) -> str:
    """Compact PT-BR duration without prefix: "30 s", "3 min", "2 h"."""
    secs = max(0, int(delta.total_seconds()))
    if secs < 60:
        return f"{secs} s"
    if secs < 3600:
        return f"{secs // 60} min"
    return f"{secs // 3600} h"


def human_age(delta: timedelta) -> str:
    return f"há {age_text(delta)}"


def _short(exc: BaseException) -> str:
    return redact_error(exc)[:200]


def check_influx(sink, now: datetime, slow_s: float = 2.0, clock=time.monotonic) -> StatusRow:
    try:
        t0 = clock()
        up = sink.ping()
        elapsed = clock() - t0
    except Exception as exc:
        return StatusRow("influxdb", "falha", _short(exc), None, now)
    if not up:
        return StatusRow("influxdb", "falha", "InfluxDB não respondeu ao ping", None, now)
    if elapsed > slow_s:
        return StatusRow("influxdb", "degradado", f"ping lento: {elapsed:.1f} s", None, now)
    return StatusRow("influxdb", "ok", f"ping {elapsed:.2f} s", None, now)


def _last_points(sink) -> dict[str, datetime]:
    df = sink.query_df(INGESTAO_FLUX)
    out: dict[str, datetime] = {}
    if df is None or df.empty:
        return out
    for dev, t in zip(df["device_id"], df["_time"]):
        ts = pd.Timestamp(t)
        if ts.tzinfo is None:
            ts = ts.tz_localize("UTC")
        out[str(dev)] = ts.to_pydatetime()
    return out


def check_ingestao(sink, registry, now: datetime) -> StatusRow:
    try:
        last = _last_points(sink)
    except Exception as exc:
        return StatusRow("telegraf_ingestao", "falha",
                         f"consulta ao InfluxDB falhou: {_short(exc)}", None, now)
    dados = {dev: t.isoformat() for dev, t in last.items()}
    campo = [b for b in registry if b.modo == "campo" and b.device_id]
    if not campo:
        if last:
            detalhe = ("Nenhuma bóia em campo — último ponto recebido "
                       + human_age(now - max(last.values())))
        else:
            detalhe = "Nenhuma bóia em campo — nenhum ponto em 24 h"
        return StatusRow("telegraf_ingestao", "ok", detalhe, dados, now)
    estado, problemas, oldest = "ok", [], timedelta(0)
    for b in campo:
        t = last.get(b.device_id)
        if t is None:
            b_estado, txt = "falha", f"{b.codigo} sem ponto em 24 h"
        else:
            age = now - t
            oldest = max(oldest, age)
            if age > STALE:
                b_estado = "falha"
            elif age > FRESH:
                b_estado = "degradado"
            else:
                b_estado = "ok"
            txt = f"{b.codigo} sem dados {human_age(age)}"
        if b_estado != "ok":
            problemas.append(txt)
            if b_estado == "falha" or estado == "ok":
                estado = b_estado
    if estado == "ok":
        detalhe = f"{len(campo)} bóia(s) em campo; ponto mais antigo {human_age(oldest)}"
    else:
        detalhe = "; ".join(problemas)
    return StatusRow("telegraf_ingestao", estado, detalhe, dados, now)


def check_worker(version: str, started_at: datetime, now: datetime) -> StatusRow:
    return StatusRow("worker", "ok", f"versão {version[:7]}; ativo {age_text(now - started_at)}",
                     {"versao": version, "iniciado_em": started_at.isoformat()}, now)


def run_status(now: datetime, sink, pg_conn_factory, version: str,
               started_at: datetime) -> list[StatusRow]:
    conn = pg_conn_factory()
    try:
        registry = load_registry(conn)
    except Exception as exc:
        ingestao = StatusRow("telegraf_ingestao", "falha",
                             f"registro de bóias ilegível: {_short(exc)}", None, now)
    else:
        ingestao = check_ingestao(sink, registry, now)
    rows = [check_influx(sink, now), ingestao, check_worker(version, started_at, now)]
    PgSystemStatus(conn).upsert(rows)   # one transaction; a failure here fails the job
    return rows


def make_status_job(sink, pg, version: str, started_at: datetime):
    """`sink` should be a short-timeout sink (see InfluxSink.with_timeout)."""
    def job(now: datetime) -> None:
        rows = run_status(now, sink, lambda: pg, version, started_at)
        bad = [r.componente for r in rows if r.estado != "ok"]
        if bad:
            log("WARNING", "status", "components not ok", components=",".join(bad))
    return job
