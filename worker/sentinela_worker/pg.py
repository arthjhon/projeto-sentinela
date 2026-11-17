from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from .detector.state import SensorState, StateChange
from .log import log
from .redact import redact_error

REGISTRY_KEY = "map_buoys"


@dataclass(frozen=True)
class Buoy:
    codigo: str
    device_id: str | None
    modo: Literal["bancada", "campo"]
    modo_desde: datetime | None


@dataclass(frozen=True)
class MaintenanceWindow:
    boia_id: str
    inicio: datetime
    fim: datetime | None


def _parse_dt(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else None  # naive timestamps are ambiguous: treat as invalid


def load_registry(conn) -> list[Buoy]:
    with conn.transaction():
        row = conn.execute("SELECT value FROM public.app_settings WHERE key = %s",
                           (REGISTRY_KEY,)).fetchone()
    if row is None or not isinstance(row[0], list):
        return []
    buoys = []
    for e in row[0]:
        if not isinstance(e, dict) or not isinstance(e.get("codigo"), str) or not e["codigo"]:
            continue
        dev = e.get("deviceId")
        device_id = dev.strip() if isinstance(dev, str) and dev.strip() else None
        modo = e.get("modo") if e.get("modo") in ("bancada", "campo") else "bancada"
        buoys.append(Buoy(e["codigo"], device_id, modo, _parse_dt(e.get("modoDesde"))))
    return buoys


def load_maintenance(conn, since: datetime) -> list[MaintenanceWindow]:
    """Windows still open or that ended at/after `since`."""
    with conn.transaction():
        rows = conn.execute(
            "SELECT boia_id, timestamp_inicio, timestamp_fim FROM public.maintenance_logs"
            " WHERE timestamp_fim IS NULL OR timestamp_fim >= %s ORDER BY timestamp_inicio",
            (since,)).fetchall()
    return [MaintenanceWindow(*r) for r in rows]


class PgHealthStore:
    def __init__(self, conn):
        self._conn = conn

    def load_states(self) -> dict[tuple[str, str], SensorState]:
        with self._conn.transaction():
            rows = self._conn.execute(
                "SELECT device_id, sensor, estado, motivo, desde FROM public.sensor_health"
            ).fetchall()
        return {(d, s): SensorState(e, m or "", t) for d, s, e, m, t in rows}

    def apply(self, changes: list[StateChange], prune: list[tuple[str, str]]) -> None:
        with self._conn.transaction():  # one transaction: any failure rolls everything back
            for c in changes:
                self._conn.execute(
                    "INSERT INTO public.sensor_health"
                    " (device_id, sensor, boia_id, modo, estado, motivo, desde, atualizado_em)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s, now())"
                    " ON CONFLICT (device_id, sensor) DO UPDATE SET boia_id=EXCLUDED.boia_id,"
                    " modo=EXCLUDED.modo, estado=EXCLUDED.estado, motivo=EXCLUDED.motivo,"
                    " desde=EXCLUDED.desde, atualizado_em=now()",
                    (c.device_id, c.sensor, c.boia_id, c.modo, c.new.estado, c.new.motivo, c.new.desde))
                if c.close_event:
                    self._conn.execute(
                        "UPDATE public.sensor_health_events SET fim=%s"
                        " WHERE device_id=%s AND sensor=%s AND fim IS NULL",
                        (c.new.desde, c.device_id, c.sensor))
                if c.open_event:
                    self._conn.execute(
                        "INSERT INTO public.sensor_health_events"
                        " (device_id, sensor, boia_id, estado, motivo, inicio)"
                        " VALUES (%s,%s,%s,%s,%s,%s)"
                        " ON CONFLICT (device_id, sensor) WHERE fim IS NULL DO NOTHING",
                        (c.device_id, c.sensor, c.boia_id, c.new.estado, c.new.motivo, c.new.desde))
            for device_id, sensor in prune:
                self._conn.execute(
                    "DELETE FROM public.sensor_health WHERE device_id=%s AND sensor=%s",
                    (device_id, sensor))


class PgJobStatus:
    def __init__(self, conn):
        self._conn = conn

    def record(self, job: str, ok: bool, started: datetime, duration_s: float,
               error: str | None) -> None:
        with self._conn.transaction():
            self._conn.execute(
                "INSERT INTO public.worker_jobs"
                " (job, ok, ultima_execucao, ultimo_sucesso, duracao_s, erro)"
                " VALUES (%(j)s, %(ok)s, %(t)s, CASE WHEN %(ok)s THEN %(t)s END, %(d)s, %(e)s)"
                " ON CONFLICT (job) DO UPDATE SET ok=EXCLUDED.ok,"
                " ultima_execucao=EXCLUDED.ultima_execucao,"
                " ultimo_sucesso=CASE WHEN EXCLUDED.ok THEN EXCLUDED.ultima_execucao"
                " ELSE public.worker_jobs.ultimo_sucesso END,"
                " duracao_s=EXCLUDED.duracao_s, erro=EXCLUDED.erro",
                {"j": job, "ok": ok, "t": started, "d": float(duration_s), "e": error})


class FanOutStatus:
    """Calls every sink; one failing sink never blocks the others."""

    def __init__(self, *sinks):
        self._sinks = sinks

    def record(self, job, ok, started, duration_s, error) -> None:
        for sink in self._sinks:
            try:
                sink.record(job, ok, started, duration_s, error)
            except Exception as exc:
                log("ERROR", job, "status sink failed", sink=type(sink).__name__,
                    error=redact_error(exc))
