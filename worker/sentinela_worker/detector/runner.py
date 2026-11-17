"""Detector runner: one cycle = read Influx, derive per-sensor state, persist, then mark.

Order of side effects (all-or-nothing on the Postgres side):
  1. store.apply(changes, prune)  -- ONE transaction (PgHealthStore)
  2. influx.write("qualidade", flag points)  -- only after (1) succeeded

Flag point identity is stable (measurement + tags + flag time), so rewriting the same flag in a
later run overwrites the same Influx point instead of adding a new one. Each run rewrites the
per-sample flags of the last WRITE_LOOKBACK and every episode flag (one per episode) found since
the analysis start; a failed Influx write is therefore repaired by the next run.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from influxdb_client import Point

from ..log import log
from .config import SENSORS, DetectorConfig
from .rules import (NOMINAL_STEP, Flag, check_campo_ausente, check_faixa, check_plausibilidade,
                    check_salto, check_sem_dados, check_travado, coerce)
from .state import ALERTA, HealthStore, SensorState, StateChange, derive_state
from .stats import STL_BIN, layer2_flags

DETECTOR_INTERVAL_S = 300
SOURCE_BUCKET = "iot"
SOURCE_MEASUREMENT = "sensores"
QUALIDADE_BUCKET = "qualidade"
QUALIDADE_MEASUREMENT = "qualidade_dado"

RECENT = timedelta(minutes=10)            # a per-sample flag drives the state for 2 runs
WRITE_LOOKBACK = timedelta(minutes=30)    # per-sample flags rewritten (same identity) for 6 runs
PICO_WINDOW = timedelta(minutes=60)       # R23: pico_min_count picos within this window
PRUNE_SILENCE = timedelta(hours=24)       # unregistered device silent longer than this is pruned
EPISODE_RULES = ("travado", "campo_ausente", "sem_dados", "deriva", "incrustacao")

MODO_NAO_CADASTRADO = "nao_cadastrado"    # derive_state/Influx tag only; persisted modo is bancada


@dataclass(frozen=True)
class RunResult:
    changes: int      # (device, sensor) whose estado changed in this run
    flags: int        # flag points written to Influx


@dataclass(frozen=True)
class _Context:
    em_manutencao: bool
    reset: datetime   # statistics (and rules) use only data from here on


# ---- Flux --------------------------------------------------------------------------------

def _flux_time(t: datetime) -> str:
    return pd.Timestamp(t).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _source(start: datetime, stop: datetime, keep: str) -> str:
    fields = " or ".join(f'r._field == "{s}"' for s in SENSORS)
    return (f'from(bucket: "{SOURCE_BUCKET}")\n'
            f"  |> range(start: {_flux_time(start)}, stop: {_flux_time(stop)})\n"
            f'  |> filter(fn: (r) => r._measurement == "{SOURCE_MEASUREMENT}")\n'
            f"  |> filter(fn: (r) => {fields})\n"
            f"  |> keep(columns: [{keep}])\n")


def raw_query(start: datetime, stop: datetime) -> str:
    """Raw samples of every device, one row per payload (fields pivoted)."""
    return (_source(start, stop, '"_time", "_value", "_field", "device_id"')
            + '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n')


def historico_query(start: datetime, stop: datetime) -> str:
    """5-min means of every device (floating baseline), labelled by the window start like
    pandas resample, fields pivoted."""
    return (_source(start, stop, '"_start", "_stop", "_time", "_value", "_field", "device_id"')
            + '  |> aggregateWindow(every: 5m, fn: mean, timeSrc: "_start", createEmpty: false)\n'
            + '  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")\n')


# ---- inputs ------------------------------------------------------------------------------

def _by_device(df: pd.DataFrame | None, now: datetime) -> dict[str, pd.DataFrame]:
    """{device_id: frame indexed by UTC time (sorted, unique, <= now) with one column per sensor}."""
    if df is None or len(df) == 0 or "_time" not in df or "device_id" not in df:
        return {}
    df = df.assign(_time=pd.to_datetime(df["_time"], utc=True))
    df = df[df["_time"] <= pd.Timestamp(now)]
    out = {}
    for dev, g in df.groupby("device_id", sort=True):
        g = g.set_index("_time").sort_index(kind="stable")
        g = g[~g.index.duplicated(keep="last")]
        out[str(dev)] = g.reindex(columns=list(SENSORS))
    return out


def _context(buoy, maintenance, now: datetime, cfg: DetectorConfig) -> _Context:
    """Reset point = max(end of last closed maintenance + estabilizacao, modo_desde,
    now - janela_max). Open maintenance, or one closed less than estabilizacao ago, is manutencao."""
    reset = now - cfg.janela_max
    if buoy is None:
        return _Context(False, reset)
    if buoy.modo_desde is not None:
        reset = max(reset, min(buoy.modo_desde, now))
    em_manutencao = False
    for w in maintenance:
        if w.boia_id != buoy.codigo or w.inicio > now:
            continue
        if w.fim is None or w.fim > now:
            em_manutencao = True
            continue
        stable = w.fim + cfg.estabilizacao
        if stable > now:
            em_manutencao = True
        reset = max(reset, min(stable, now))
    return _Context(em_manutencao, reset)


def _registry(registry) -> dict:
    out = {}
    for b in registry:
        if b.device_id and b.device_id not in out:   # first entry wins on a duplicated deviceId
            out[b.device_id] = b
    return out


# ---- analysis ----------------------------------------------------------------------------

def _analyse(sensor: str, df: pd.DataFrame, hist: pd.DataFrame | None, ctx: _Context,
             campo: bool, now: datetime, cfg: DetectorConfig
             ) -> tuple[list[Flag], list[Flag], bool]:
    """Returns (flags to write, flags active now, dados_suficientes) for one sensor."""
    rules = cfg.sensores[sensor]
    start = max(ctx.reset, now - cfg.janela)
    region = df[df.index >= pd.Timestamp(start)]
    s = coerce(region[sensor])
    write: list[Flag] = []
    active: list[Flag] = []

    # per-sample rules: only the recent tail matters for state and for writes
    tail = s[s.index > pd.Timestamp(now - WRITE_LOOKBACK - 2 * NOMINAL_STEP)]
    sample = check_faixa(tail, rules) + check_plausibilidade(tail, rules) + check_salto(tail, rules)
    sample = [f for f in sample if f.time > now - WRITE_LOOKBACK]
    write += sample
    active += [f for f in sample if f.time > now - RECENT]

    # travado: one flag per stuck run (time = first sample), active while the run is ongoing
    travado = check_travado(s, rules)
    write += travado
    if travado and _stuck_now(s, rules):
        active.append(travado[-1])

    # campo_ausente: only temperatura (DS18B20 unplugged); payload rows = rows of the region
    if sensor == "temperatura" and len(region):
        present = pd.Series(np.isfinite(pd.to_numeric(region[sensor], errors="coerce")
                                        .astype(float).to_numpy()), index=region.index)
        ausente = check_campo_ausente(present)
        write += ausente
        if ausente and not present[present.index > pd.Timestamp(now - RECENT)].all():
            active.append(ausente[-1])

    # sem_dados: only buoys in campo; silence counted from the analysis start at most
    if campo:
        last = s.index[-1].to_pydatetime() if len(s) else None
        if now - (last or start) > cfg.sem_dados_max:
            if last is not None:
                flag = check_sem_dados(last, now, cfg)[0]
                write.append(flag)                       # time = last sample: stable identity
            else:
                flag = Flag("sem_dados", "falha", start, None,
                            f"nenhuma amostra desde {start:%Y-%m-%d %H:%M} UTC")
            active.append(flag)

    # layer 2: Hampel on the raw recent tail, STL/CUSUM/Theil-Sen on the floating baseline
    margin = NOMINAL_STEP * cfg.stats.hampel_window
    recent = s[s.index > pd.Timestamp(now - PICO_WINDOW - margin)]
    level = _level(hist[sensor] if hist is not None else None, s)
    res = layer2_flags(recent, sensor, cfg, since=ctx.reset, historico=level)
    picos = [f for f in res.flags if f.regra == "pico" and f.time > now - PICO_WINDOW]
    write += [f for f in picos if f.time > now - WRITE_LOOKBACK]    # R23: raw picos always marked
    # a Hampel window overlapping a stuck run has a degenerate MAD (half of it is flat), so the
    # picos it yields at the run's edges are artifacts: they never count towards the state
    spans = _stuck_spans(s, travado, rules.travado_eps, margin)
    counted = [f for f in picos if not any(lo <= f.time <= hi for lo, hi in spans)]
    if len(counted) >= cfg.pico_min_count:
        active.append(Flag("pico", "suspeito", counted[-1].time, None,
                           f"{len(counted)} picos isolados em {int(PICO_WINDOW.total_seconds() // 60)} min "
                           f"(limite {cfg.pico_min_count})"))
    persistent = [f for f in res.flags if f.regra != "pico"]   # deriva/incrustacao since the reset
    write += persistent
    active += persistent
    return write, active, res.dados_suficientes


def _stuck_spans(s: pd.Series, travado: list[Flag], eps: float, margin: timedelta
                 ) -> list[tuple[datetime, datetime]]:
    """[run start - margin, run end + margin] for every stuck run (run = samples within eps of
    the stuck value from the flag time on)."""
    spans = []
    for f in travado:
        after = s[s.index >= pd.Timestamp(f.time)]
        off = after[(after - f.valor).abs() >= eps]
        end = (off.index[0] if len(off) else after.index[-1]).to_pydatetime()
        spans.append((f.time - margin, end + margin))
    return spans


def _stuck_now(s: pd.Series, rules) -> bool:
    """check_travado's condition evaluated at the last sample only (the run is ongoing)."""
    win = s[s.index > s.index[-1] - pd.Timedelta(rules.travado_min)]
    expected = pd.Timedelta(rules.travado_min) / pd.Timedelta(NOMINAL_STEP)
    return len(win) >= 0.8 * expected and float(win.max() - win.min()) < rules.travado_eps


def _level(hist_col: pd.Series | None, raw: pd.Series) -> pd.Series:
    """Floating baseline series; without a historico query, the raw window's own 5-min means."""
    if hist_col is not None:
        return coerce(hist_col)
    return raw.resample(STL_BIN).mean().dropna()


def _point(device_id: str, sensor: str, modo: str, f: Flag) -> Point:
    p = (Point(QUALIDADE_MEASUREMENT).tag("device_id", device_id).tag("sensor", sensor)
         .tag("regra", f.regra).tag("modo", modo)
         .field("severidade", f.severidade).field("detalhe", f.detalhe))
    if f.valor is not None:
        p = p.field("valor", float(f.valor))
    return p.time(f.time)


def _events(previous: SensorState | None, new: SensorState) -> tuple[bool, bool]:
    """open on entering an alert estado (also alert -> other alert: the store closes the old
    one); close on leaving alert for any non-alert estado."""
    changed = previous is None or previous.estado != new.estado
    open_event = changed and new.estado in ALERTA
    close_event = (changed and previous is not None and previous.estado in ALERTA
                   and new.estado not in ALERTA)
    return open_event, close_event


# ---- run ---------------------------------------------------------------------------------

def run_detector(now: datetime, readings: pd.DataFrame, registry: list, maintenance: list,
                 store: HealthStore, influx, cfg: DetectorConfig, *,
                 historico: pd.DataFrame | None = None) -> RunResult:
    raw = _by_device(readings, now)
    hist = _by_device(historico, now) if historico is not None else {}
    buoys = _registry(registry)
    previous = store.load_states()

    last_pub = {d: g.index[-1] for d, g in raw.items() if len(g)}
    recent_unregistered = {d for d, t in last_pub.items()
                           if d not in buoys and now - t.to_pydatetime() <= PRUNE_SILENCE}
    devices = sorted(set(buoys) | recent_unregistered)
    empty = pd.DataFrame(columns=list(SENSORS), index=pd.DatetimeIndex([], tz="UTC"), dtype=float)

    changes: list[StateChange] = []
    points: list[Point] = []
    transitions = 0
    for dev in devices:
        buoy = buoys.get(dev)
        ctx = _context(buoy, maintenance, now, cfg)
        modo = buoy.modo if buoy else MODO_NAO_CADASTRADO
        df = raw.get(dev, empty)
        for sensor in SENSORS:
            prev = previous.get((dev, sensor))
            if ctx.em_manutencao:
                write, active, suficientes = [], [], True
            else:
                write, active, suficientes = _analyse(
                    sensor, df, hist.get(dev, empty) if historico is not None else None,
                    ctx, modo == "campo", now, cfg)
            new = derive_state(active, modo, ctx.em_manutencao, buoy is not None, suficientes,
                               now, prev)
            open_event, close_event = _events(prev, new)
            changes.append(StateChange(dev, sensor, buoy.codigo if buoy else None,
                                       buoy.modo if buoy else "bancada", new,
                                       open_event, close_event))
            transitions += prev is None or prev.estado != new.estado
            points += [_point(dev, sensor, modo, f) for f in write]

    prune = sorted(k for k in previous if k[0] not in devices)
    for dev, sensor in prune:   # never leave an open event behind a pruned row
        if previous[(dev, sensor)].estado in ALERTA:
            changes.append(StateChange(dev, sensor, None, "bancada", SensorState(
                "nao_cadastrado", "removido do registro e sem publicar ha mais de 24 h", now),
                False, True))

    store.apply(changes, prune)
    if points:
        influx.write(QUALIDADE_BUCKET, points)
    return RunResult(transitions, len(points))


def run_cycle(now: datetime, influx, store: HealthStore, registry: list, maintenance: list,
              cfg: DetectorConfig) -> RunResult:
    """Two Flux queries per run: raw samples over `janela` and 5-min means from the earliest
    reset point (never before now - janela_max), then run_detector."""
    readings = influx.query_df(raw_query(now - cfg.janela, now))
    buoys = _registry(registry)
    starts = [_context(b, maintenance, now, cfg).reset for b in buoys.values()]
    publishing = set(readings["device_id"].dropna().astype(str)) if "device_id" in readings else set()
    if not starts or publishing - set(buoys):
        starts.append(now - cfg.janela_max)
    start = pd.Timestamp(min(starts)).floor(STL_BIN).to_pydatetime()
    historico = influx.query_df(historico_query(start, now))
    return run_detector(now, readings, registry, maintenance, store, influx, cfg,
                        historico=historico)


def detect_cycle(now: datetime, influx, pg, cfg: DetectorConfig) -> RunResult:
    """Production cycle: registry and maintenance from Postgres, then run_cycle."""
    from ..pg import PgHealthStore, load_maintenance, load_registry

    registry = load_registry(pg)
    maintenance = load_maintenance(pg, now - cfg.janela_max - cfg.estabilizacao)
    res = run_cycle(now, influx, PgHealthStore(pg), registry, maintenance, cfg)
    log("INFO", "detector", "cycle", changes=res.changes, flags=res.flags,
        buoys=len(registry), maintenance=len(maintenance))
    return res


def make_detector_job(influx, pg, cfg: DetectorConfig):
    """Scheduler job: one detect_cycle per call; a lost/failed Postgres connection is dropped
    so the next run reconnects (the failure itself propagates to the job status)."""
    import psycopg

    def job(now: datetime) -> None:
        try:
            detect_cycle(now, influx, pg, cfg)
        except psycopg.OperationalError:
            pg.reset()
            raise

    return job
