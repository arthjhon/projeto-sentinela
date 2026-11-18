"""Detector runner: fake store (same event contract as PgHealthStore) and fake Influx."""
import re
import subprocess
import sys
import textwrap
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from synthetic import (DEFAULT_START, clean_series, inject_calibration_session, inject_gap,
                       inject_out_of_range, inject_spike, inject_step, inject_stuck)

from sentinela_worker.detector import rules, runner, stats
from sentinela_worker.detector.config import ConfigError, load_detector_config
from sentinela_worker.detector.state import SensorState
from sentinela_worker.pg import Buoy, MaintenanceWindow

CFG_PATH = Path(__file__).parent.parent / "config" / "detector.yaml"
CFG = load_detector_config(CFG_PATH)
T0 = pd.Timestamp(DEFAULT_START)
SENSORS = ("ph", "temperatura", "turbidez")
ALERTA = ("falha", "sem_dados", "suspeito")


def at(**kw) -> datetime:
    return (T0 + timedelta(**kw)).to_pydatetime()


# ---- fakes ------------------------------------------------------------------------------

class FakeStore:
    """In-memory store honoring the PgHealthStore contract (events included)."""

    def __init__(self):
        self.states: dict[tuple[str, str], SensorState] = {}
        self.events: list[dict] = []
        self.fail = False
        self.applied = 0
        self.last_ok = None         # worker_jobs.ultimo_sucesso of the detector job

    def last_success(self):
        return self.last_ok

    def load_states(self):
        return dict(self.states)

    def _open(self, d, s):
        return next((e for e in self.events if (e["device_id"], e["sensor"]) == (d, s)
                     and e["fim"] is None), None)

    def apply(self, changes, prune):
        if self.fail:
            raise RuntimeError("store down")
        self.applied += 1
        for c in changes:
            key = (c.device_id, c.sensor)
            self.states[key] = c.new
            ev = self._open(*key)
            if c.close_event and ev:
                ev["fim"] = max(ev["inicio"], c.new.desde)
            if c.open_event:
                if ev and ev["fim"] is None and ev["estado"] != c.new.estado:
                    ev["fim"] = max(ev["inicio"], c.new.desde)
                if self._open(*key) is None:
                    self.events.append(dict(device_id=c.device_id, sensor=c.sensor,
                                            estado=c.new.estado, inicio=c.new.desde, fim=None))
        for key in prune:
            self.states.pop(key, None)

    def opened(self, device=None, sensor=None):
        return [e for e in self.events if (device is None or e["device_id"] == device)
                and (sensor is None or e["sensor"] == sensor)]


class FakeInflux:
    """Answers the runner's two Flux queries from in-memory raw data; records writes."""

    def __init__(self, raw: pd.DataFrame | None = None):
        self.raw = raw if raw is not None else pd.DataFrame(columns=["_time", "device_id"])
        self.queries: list[str] = []
        self.written: list = []
        self.fail_write = False

    def write(self, bucket, points):
        if self.fail_write:
            raise RuntimeError("influx down")
        assert bucket == "qualidade"
        self.written += points

    def query_df(self, flux):
        self.queries.append(flux)
        start, stop = (pd.Timestamp(x) for x in
                       re.search(r"range\(start: (\S+), stop: (\S+)\)", flux).groups())
        t = pd.to_datetime(self.raw["_time"], utc=True)
        df = self.raw[(t >= start) & (t < stop)]
        if "aggregateWindow" not in flux:
            return df.assign(result="_result", table=0)
        parts = []
        for dev, g in df.groupby("device_id"):
            m = (g.set_index(pd.to_datetime(g["_time"], utc=True))[list(SENSORS)]
                 .resample("5min").mean().dropna(how="all"))
            parts.append(m.rename_axis("_time").reset_index().assign(device_id=dev))
        out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(
            columns=["_time", "device_id", *SENSORS])
        return out.assign(result="_result", table=0, _start=start, _stop=stop)

    def flags(self, **match):
        out = []
        for p in self.written:
            rec = {**p._tags, **p._fields, "time": pd.Timestamp(p._time)}
            if all(rec.get(k) == v for k, v in match.items()):
                out.append(rec)
        return out


def frame(device: str, **series: pd.Series) -> pd.DataFrame:
    df = pd.concat(series, axis=1)
    df.index.name = "_time"
    return df.reset_index().assign(device_id=device)


def week(days, seed=0, start=T0, **inject):
    return {s: clean_series(s, days, seed=seed + 1000 * i, start=start) for i, s in enumerate(SENSORS)}


def buoy(dev="dev1", modo="campo", codigo="SM-01", desde=T0.to_pydatetime()):
    return Buoy(codigo, dev, modo, desde)


def run(now, readings, registry, store, influx, maintenance=(), historico=None):
    t = pd.to_datetime(readings["_time"], utc=True) if len(readings) else pd.Series(dtype="datetime64[ns, UTC]")
    upto = readings[(t <= pd.Timestamp(now)) & (t > pd.Timestamp(now) - CFG.janela)] if len(readings) else readings
    return runner.run_detector(now, upto, list(registry), list(maintenance), store, influx, CFG,
                               historico=historico)


def simulate(times, raw, registry, store, influx, maintenance_at=lambda now: []):
    """One run_cycle per time (fake Influx answers both Flux queries); returns the state history."""
    fake = FakeInflux(raw)
    history = []
    for now in times:
        fake.raw = raw
        runner.run_cycle(now, fake, store, list(registry), list(maintenance_at(now)), CFG)
        history.append({k: v.estado for k, v in store.states.items()})
    influx.written += fake.written
    return history


def every(start, end, minutes=5):
    return list(pd.date_range(start, end, freq=f"{minutes}min").to_pydatetime())


# ---- brief tests ------------------------------------------------------------------------

def test_calibration_inside_maintenance_produces_zero_events():
    data = week(5, seed=300)
    m0, m1 = at(days=4), at(days=4, minutes=40)
    data["ph"] = inject_calibration_session(data["ph"], at(days=4, minutes=5))
    raw = frame("dev1", **data)

    def windows(now):
        return [MaintenanceWindow("SM-01", m0, None if now < m1 else m1)] if now >= m0 else []

    store, influx = FakeStore(), FakeInflux()
    times = every(at(days=4, minutes=-30), at(days=4, hours=3))
    hist = simulate(times, raw, [buoy()], store, influx, windows)
    assert store.events == []
    by_time = dict(zip(times, hist))
    assert by_time[at(days=4, minutes=-30)][("dev1", "ph")] == "ok"
    for t in every(m0, m1 + CFG.estabilizacao - timedelta(minutes=5)):
        assert set(by_time[t].values()) == {"manutencao"}, t
    assert set(by_time[times[-1]].values()) == {"dados_insuficientes"}
    # no flag inside the maintenance (calibration plateaus are not data-quality marks)
    assert [f for f in influx.flags() if m0 <= f["time"] < m1 + CFG.estabilizacao] == []


def test_bancada_buoy_never_falha_or_sem_dados():
    data = week(4, seed=301)
    data["ph"] = inject_out_of_range(data["ph"], at(days=3, hours=1), 15.0)
    data = {s: inject_gap(v, at(days=3, hours=2), timedelta(hours=2)) for s, v in data.items()}
    raw = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    times = (every(at(days=3, minutes=50), at(days=3, hours=1, minutes=30))
             + every(at(days=3, hours=2), at(days=4, hours=3), minutes=30))  # ends 3 h after data
    hist = simulate(times, raw, [buoy(modo="bancada")], store, influx)
    assert all(set(h.values()) == {"bancada"} for h in hist)
    assert store.events == []
    faixa = influx.flags(regra="faixa", sensor="ph")
    assert faixa and all(f["modo"] == "bancada" for f in faixa)
    assert influx.flags(regra="sem_dados") == []


def test_stats_reset_after_maintenance_end():
    data = week(8, seed=302)
    step_at = at(days=3)
    data["ph"] = inject_step(data["ph"], step_at, 0.5)          # recalibration shifts the level
    raw = frame("dev1", **data)
    now = at(days=7, hours=12)
    man = [MaintenanceWindow("SM-01", step_at - timedelta(minutes=20), step_at + timedelta(minutes=10))]
    store = FakeStore()
    runner.run_cycle(now, FakeInflux(raw), store, [buoy()], man, CFG)
    assert store.states[("dev1", "ph")].estado == "ok"
    # the same data without the maintenance record is a level shift (deriva)
    store = FakeStore()
    runner.run_cycle(now, FakeInflux(raw), store, [buoy()], [], CFG)
    assert store.states[("dev1", "ph")].estado == "suspeito"
    assert "deriva" in store.states[("dev1", "ph")].motivo


def test_event_opens_on_leaving_ok_and_closes_on_return():
    data = week(4, seed=303)
    bad = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], bad, 15.0)
    readings = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    run(bad - timedelta(minutes=5), readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")].estado == "ok" and store.events == []
    t1 = bad + timedelta(minutes=3)
    res = run(t1, readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")] == SensorState("falha", store.states[("dev1", "ph")].motivo, t1)
    assert "faixa" in store.states[("dev1", "ph")].motivo and res.changes == 1
    [ev] = store.events
    assert ev["estado"] == "falha" and ev["inicio"] == t1 and ev["fim"] is None
    run(bad + timedelta(minutes=8), readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")].desde == t1               # desde kept, no new event
    assert len(store.events) == 1
    t3 = bad + timedelta(minutes=15)
    run(t3, readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")].estado == "ok"
    assert store.events[0]["fim"] == t3
    assert [e["sensor"] for e in store.events] == ["ph"]          # the other sensors stayed ok


def test_unregistered_device_is_processed_as_nao_cadastrado():
    data = week(4, seed=304)
    now = at(days=3, hours=12)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=2), 15.0)
    store, influx = FakeStore(), FakeInflux()
    captured = []
    store_apply = store.apply
    store.apply = lambda changes, prune: (captured.extend(changes), store_apply(changes, prune))
    run(now, frame("ghost", **data), [buoy()], store, influx)
    assert {store.states[("ghost", s)].estado for s in SENSORS} == {"nao_cadastrado"}
    ghost = [c for c in captured if c.device_id == "ghost"]
    assert all(c.boia_id is None and c.modo == "bancada" and not c.open_event for c in ghost)
    assert store.opened("ghost") == []
    assert influx.flags(device_id="ghost") == []           # R26: state only, no analysis
    # the registered campo buoy that never published is sem_dados
    assert {store.states[("dev1", s)].estado for s in SENSORS} == {"sem_dados"}


def test_rows_for_unknown_and_silent_devices_are_pruned():
    now = at(days=3)
    old = frame("old", ph=clean_series("ph", 0.1, start=now - timedelta(hours=30)))
    recent = frame("recent", ph=clean_series("ph", 0.1, start=now - timedelta(hours=3)))
    readings = pd.concat([old, recent, frame("dev1", **week(3, seed=305))], ignore_index=True)
    store = FakeStore()
    t = now - timedelta(days=1)
    for dev in ("old", "gone", "recent", "dev1"):
        for s in SENSORS:
            store.states[(dev, s)] = SensorState("ok", "", t)
    store.states[("gone", "ph")] = SensorState("falha", "travado", t)
    store.events.append(dict(device_id="gone", sensor="ph", estado="falha", inicio=t, fim=None))
    seen = {}
    apply = store.apply
    store.apply = lambda changes, prune: (seen.setdefault("prune", list(prune)), apply(changes, prune))
    run(now, readings, [buoy()], store, FakeInflux())
    assert sorted(seen["prune"]) == sorted((d, s) for d in ("gone", "old") for s in SENSORS)
    assert {d for d, _ in store.states} == {"recent", "dev1"}
    assert store.events[0]["fim"] == now                     # no orphan open event


def test_store_failure_leaves_previous_state():
    data = week(4, seed=306)
    now = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=1), 15.0)
    readings = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    prev = SensorState("ok", "", at(days=3))
    store.states = {("dev1", s): prev for s in SENSORS}
    store.fail = True
    with pytest.raises(RuntimeError):
        run(now, readings, [buoy()], store, influx)
    assert influx.written == [] and store.events == []
    assert store.states == {("dev1", s): prev for s in SENSORS}
    store.fail = False
    run(now + timedelta(minutes=5), readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")].estado == "falha" and len(store.events) == 1
    assert influx.flags(regra="faixa")


def test_influx_failure_after_apply_is_repaired_by_next_run():
    data = week(4, seed=313)
    now = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=1), 15.0)
    readings = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    influx.fail_write = True
    with pytest.raises(RuntimeError):
        run(now, readings, [buoy()], store, influx)
    assert store.states[("dev1", "ph")].estado == "falha" and influx.written == []
    influx.fail_write = False
    run(now + timedelta(minutes=5), readings, [buoy()], store, influx)
    assert [f["time"] for f in influx.flags(regra="faixa")] == [pd.Timestamp(now - timedelta(minutes=1))]
    assert len(store.events) == 1


def test_per_sample_flags_survive_an_outage_longer_than_30_min():
    data = week(4, seed=314)
    now = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=1), 15.0)
    data["turbidez"] = inject_spike(data["turbidez"], now - timedelta(minutes=2), 40.0)
    readings = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    store.last_ok = now - timedelta(minutes=5)              # last successful detector run
    influx.fail_write = True
    with pytest.raises(RuntimeError):
        run(now, readings, [buoy()], store, influx)
    influx.fail_write = False
    later = now + timedelta(minutes=40)                     # runs in between failed too
    run(later, readings, [buoy()], store, influx)
    assert [f["time"] for f in influx.flags(regra="faixa")] == [pd.Timestamp(now - timedelta(minutes=1))]
    assert pd.Timestamp(now - timedelta(minutes=2)) in [f["time"] for f in influx.flags(regra="pico")]
    # without a record of a previous success the lookback stays at 30 min
    influx2, store2 = FakeInflux(), FakeStore()
    run(later, readings, [buoy()], store2, influx2)
    assert influx2.flags(regra="faixa") == []


def test_write_lookback_is_capped_at_janela():
    now = at(days=10)
    store = FakeStore()
    store.last_ok = now - timedelta(days=30)
    assert runner.write_lookback(now, store.last_ok, CFG) == CFG.janela
    assert runner.write_lookback(now, None, CFG) == runner.WRITE_LOOKBACK
    assert runner.write_lookback(now, now - timedelta(minutes=5), CFG) == runner.WRITE_LOOKBACK
    assert runner.write_lookback(now, now - timedelta(hours=2), CFG) == timedelta(hours=2)


def test_deriva_state_clears_after_level_recovers():
    data = week(16, seed=340)
    data["ph"] = inject_step(data["ph"], at(days=5), 0.5)
    data["ph"] = inject_step(data["ph"], at(days=7), -0.5)      # back to the baseline at day 7
    raw = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux(raw)
    out = {}
    for d in (6, 8, 10, 14):
        runner.run_cycle(at(days=d), influx, store, [buoy()], [], CFG)
        out[d] = store.states[("dev1", "ph")]
    assert out[6].estado == "suspeito" and "deriva" in out[6].motivo
    assert {out[d].estado for d in (8, 10, 14)} == {"ok"}, out
    [ev] = store.opened("dev1", "ph")
    assert ev["estado"] == "suspeito" and ev["fim"] == at(days=8)
    assert influx.flags(regra="deriva", sensor="ph")             # the alarm itself stays marked


def test_unregistered_devices_capped_per_run_most_recent_first(capsys):
    now = at(days=3)
    frames = [frame(f"g{i:02d}", ph=clean_series("ph", 0.01, start=now - timedelta(minutes=60 + i)))
              for i in range(25)]                           # g00 most recent ... g24 oldest
    store = FakeStore()
    store.states[("g24", "ph")] = SensorState("nao_cadastrado", "x", now - timedelta(hours=1))
    run(now, pd.concat(frames, ignore_index=True), [], store, FakeInflux())
    processed = {d for d, _ in store.states}
    assert processed == {f"g{i:02d}" for i in range(20)} | {"g24"}   # g24 kept, not pruned
    assert store.states[("g24", "ph")].motivo == "x"                 # ...and not updated
    assert "unregistered devices skipped" in capsys.readouterr().out


def test_duplicate_device_id_in_registry_is_logged(capsys):
    runner._reset_registry_warnings()
    store = FakeStore()
    empty = pd.DataFrame(columns=["_time", "device_id", *SENSORS])
    run(at(days=3), empty, [buoy("d1", codigo="A"), buoy("d1", codigo="B")], store, FakeInflux())
    out = capsys.readouterr().out
    assert "duplicate deviceId" in out and "B" in out
    assert ("d1", "ph") in store.states


def test_deriva_motivo_reports_current_shift_and_hysteresis_comes_from_previous_state():
    data = week(10, seed=341)
    data["ph"] = inject_step(data["ph"], at(days=5), 0.5)
    data["ph"] = inject_step(data["ph"], at(days=7), 0.11 - 0.5)    # parked between the thresholds
    raw = frame("dev1", **data)
    store = FakeStore()
    runner.run_cycle(at(days=9), FakeInflux(raw), store, [buoy()], [], CFG)
    assert store.states[("dev1", "ph")].estado == "ok"              # not active: enter threshold
    store.states[("dev1", "ph")] = SensorState("suspeito", "deriva: x (+ pico)", at(days=8))
    runner.run_cycle(at(days=9), FakeInflux(raw), store, [buoy()], [], CFG)
    st = store.states[("dev1", "ph")]
    assert st.estado == "suspeito" and st.desde == at(days=8)       # stays active: exit threshold
    shift = float(re.search(r"nivel atual ([+-][0-9.]+)", st.motivo).group(1))
    assert shift == pytest.approx(0.11, abs=0.03)                   # current 24 h shift, not the alarm


def test_short_falha_does_not_forget_an_active_in_band_deriva():
    """Deriva active with the level parked between the exit and enter thresholds; one faixa
    sample (falha) for a run or two must not make the runner forget the deriva: once the
    sample is no longer recent the state is suspeito/deriva again, never ok."""
    data = week(10, seed=341)
    data["ph"] = inject_step(data["ph"], at(days=5), 0.5)
    data["ph"] = inject_step(data["ph"], at(days=7), 0.11 - 0.5)    # parked between the thresholds
    t_bad = at(days=9) + timedelta(minutes=2)
    data["ph"] = inject_out_of_range(data["ph"], t_bad, 15.0)       # one sample out of [0, 14]
    raw = frame("dev1", **data)
    store = FakeStore()
    store.states[("dev1", "ph")] = SensorState("suspeito", "deriva: x", at(days=8))
    runner.run_cycle(at(days=9), FakeInflux(raw), store, [buoy()], [], CFG)
    assert store.states[("dev1", "ph")].estado == "suspeito"        # hysteresis holds
    runner.run_cycle(at(days=9, minutes=5), FakeInflux(raw), store, [buoy()], [], CFG)
    st = store.states[("dev1", "ph")]
    assert st.estado == "falha" and st.motivo.startswith("faixa:") and "(+ " in st.motivo
    assert "deriva" in st.motivo                                     # still listed as active
    runner.run_cycle(at(days=9, minutes=20), FakeInflux(raw), store, [buoy()], [], CFG)
    back = store.states[("dev1", "ph")]
    assert back.estado == "suspeito" and back.motivo.startswith("deriva:"), back


def test_duplicate_device_id_warns_once_per_registry_change(capsys):
    runner._reset_registry_warnings()
    empty = pd.DataFrame(columns=["_time", "device_id", *SENSORS])
    reg = [buoy("d1", codigo="A"), buoy("d1", codigo="B")]
    for _ in range(3):
        run(at(days=3), empty, reg, FakeStore(), FakeInflux())
    assert capsys.readouterr().out.count("duplicate deviceId") == 1
    run(at(days=3), empty, reg + [buoy("d2", codigo="C"), buoy("d2", codigo="D")], FakeStore(), FakeInflux())
    assert capsys.readouterr().out.count("duplicate deviceId") == 2   # content changed: warn again


def test_long_write_lookback_is_logged(capsys):
    store = FakeStore()
    store.last_ok = at(days=3) - timedelta(hours=2)
    run(at(days=3), pd.DataFrame(columns=["_time", "device_id", *SENSORS]), [], store, FakeInflux())
    out = capsys.readouterr().out
    assert "write lookback extended" in out and "7200" in out
    store.last_ok = at(days=3) - timedelta(minutes=5)
    run(at(days=3), pd.DataFrame(columns=["_time", "device_id", *SENSORS]), [], store, FakeInflux())
    assert "write lookback extended" not in capsys.readouterr().out


# ---- state inputs -----------------------------------------------------------------------

def test_open_maintenance_is_manutencao_without_flags_or_events():
    data = week(4, seed=307)
    now = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=1), 15.0)
    store, influx = FakeStore(), FakeInflux()
    store.states = {("dev1", s): SensorState("falha", "x", at(days=3)) for s in SENSORS}
    store.events = [dict(device_id="dev1", sensor=s, estado="falha", inicio=at(days=3), fim=None)
                    for s in SENSORS]
    man = [MaintenanceWindow("SM-01", now - timedelta(hours=1), None),
           MaintenanceWindow("OUTRA", now - timedelta(hours=1), None)]
    run(now, frame("dev1", **data), [buoy()], store, influx, maintenance=man)
    assert {v.estado for v in store.states.values()} == {"manutencao"}
    assert influx.written == []
    assert all(e["fim"] == now for e in store.events)          # entering manutencao closes events


def test_pico_needs_min_count_within_60_min():
    data = week(4, seed=308)
    now = at(days=3, hours=12)
    k = CFG.pico_min_count
    for i in range(k - 1):
        data["turbidez"] = inject_spike(data["turbidez"], now - timedelta(minutes=45 - 10 * i), 40.0)
    store, influx = FakeStore(), FakeInflux()
    run(now, frame("dev1", **data), [buoy()], store, influx)
    assert store.states[("dev1", "turbidez")].estado == "ok"
    assert len(influx.flags(regra="pico", sensor="turbidez")) >= 2       # raw picos still written
    data["turbidez"] = inject_spike(data["turbidez"], now - timedelta(minutes=5), 40.0)
    run(now, frame("dev1", **data), [buoy()], store, influx)
    st = store.states[("dev1", "turbidez")]
    assert st.estado == "suspeito" and "pico" in st.motivo


def test_campo_ausente_only_for_temperatura():
    data = week(4, seed=309)
    now = at(days=3, hours=12)
    readings = frame("dev1", **data)
    t = pd.to_datetime(readings["_time"], utc=True)
    readings.loc[(t > now - timedelta(minutes=20)) & (t <= now), "temperatura"] = np.nan
    readings.loc[t == pd.Timestamp(now - timedelta(minutes=30)), "ph"] = np.nan   # missing ph: ignored
    store, influx = FakeStore(), FakeInflux()
    run(now, readings, [buoy()], store, influx)
    assert store.states[("dev1", "temperatura")].estado == "falha"
    assert "campo_ausente" in store.states[("dev1", "temperatura")].motivo
    assert store.states[("dev1", "ph")].estado == "ok"
    assert store.states[("dev1", "turbidez")].estado == "ok"
    assert [f["sensor"] for f in influx.flags(regra="campo_ausente")] == ["temperatura"]


def test_sem_dados_scope():
    store = FakeStore()
    empty = pd.DataFrame(columns=["_time", "device_id", *SENSORS])
    reg = [buoy("c1", "campo", "C1"), buoy("b1", "bancada", "B1"), Buoy("X", None, "campo", None)]
    run(at(days=3), empty, reg, store, FakeInflux())
    assert {store.states[("c1", s)].estado for s in SENSORS} == {"sem_dados"}
    assert {store.states[("b1", s)].estado for s in SENSORS} == {"bancada"}
    assert {d for d, _ in store.states} == {"c1", "b1"}
    # a fresh reset point (mode change 3 min ago) is not sem_dados yet
    store = FakeStore()
    run(at(days=3), empty, [buoy("c1", desde=at(days=3, minutes=-3))], store, FakeInflux())
    assert {store.states[("c1", s)].estado for s in SENSORS} == {"dados_insuficientes"}


def test_silent_campo_buoy_is_sem_dados_and_flag_identity_is_stable():
    data = {s: v[v.index < at(days=3, hours=6)] for s, v in week(4, seed=310).items()}
    readings = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    for minutes in (20, 25):
        run(at(days=3, hours=6, minutes=minutes), readings, [buoy()], store, influx)
    assert {store.states[("dev1", s)].estado for s in SENSORS} == {"sem_dados"}
    assert len(store.events) == 3
    keys = {(f["sensor"], f["time"]) for f in influx.flags(regra="sem_dados")}
    assert len(keys) == 3                                   # same point rewritten, not duplicated


def test_flag_point_format():
    data = week(4, seed=311)
    now = at(days=3, hours=6)
    data["ph"] = inject_out_of_range(data["ph"], now - timedelta(minutes=1), 15.0)
    influx = FakeInflux()
    run(now, frame("dev1", **data), [buoy()], FakeStore(), influx)
    p = next(p for p in influx.written if p._tags.get("regra") == "faixa")
    assert p._name == "qualidade_dado"
    assert p._tags == {"device_id": "dev1", "sensor": "ph", "regra": "faixa", "modo": "campo"}
    assert set(p._fields) == {"severidade", "valor", "detalhe"} and p._fields["valor"] == 15.0
    data = {s: v[v.index < at(days=3)] for s, v in week(4, seed=311).items()}
    influx = FakeInflux()
    run(at(days=3, hours=1), frame("dev1", **data), [buoy()], FakeStore(), influx)
    sd = influx.flags(regra="sem_dados")
    assert sd and all("valor" not in f for f in sd)         # valor None is omitted


def test_queries():
    now = at(days=7)
    raw = runner.raw_query(now - CFG.janela, now)
    assert 'from(bucket: "iot")' in raw and 'r._measurement == "sensores"' in raw
    assert "pivot(" in raw and "aggregateWindow" not in raw
    hist = runner.historico_query(now - timedelta(days=30), now)
    assert "aggregateWindow(every: 5m, fn: mean" in hist and 'timeSrc: "_start"' in hist
    assert "createEmpty: false" in hist and "pivot(" in hist


def test_run_cycle_issues_two_queries_and_historico_starts_at_earliest_reset():
    raw = pd.concat([frame("dev1", **week(4, seed=312)),
                     frame("ghost", ph=clean_series("ph", 0.1, start=at(days=3, hours=10)))],
                    ignore_index=True)                     # unregistered: must not widen the start
    fake = FakeInflux(raw)
    now = at(days=3, hours=12)
    reg = [buoy(desde=at(days=1, minutes=2)), buoy("dev2", desde=at(days=2))]
    runner.run_cycle(now, fake, FakeStore(), reg, [], CFG)
    assert len(fake.queries) == 2
    start = re.search(r"range\(start: (\S+),", fake.queries[1]).group(1)
    assert pd.Timestamp(start) == pd.Timestamp(at(days=1))       # floored to the 5-min grid
    # capped at janela_max_dias
    reg = [buoy(desde=None)]
    fake = FakeInflux(raw)
    runner.run_cycle(now, fake, FakeStore(), reg, [], CFG)
    start = re.search(r"range\(start: (\S+),", fake.queries[1]).group(1)
    assert pd.Timestamp(start) == pd.Timestamp(now - CFG.janela_max).floor("5min")


# ---- config -----------------------------------------------------------------------------

def test_runner_config_keys():
    assert CFG.pico_min_count == 5 and CFG.janela_max == timedelta(days=30)


@pytest.mark.parametrize("old,new,key", [
    ("pico_min_count: 5 ", "pico_min_count: 0 ", "pico_min_count"),
    ("pico_min_count: 5 ", "pico_min_count: 2.5 ", "pico_min_count"),
    ("janela_max_dias: 30 ", "janela_max_dias: -1 ", "janela_max_dias"),
    ("janela_max_dias: 30 ", "janela_max_dias: 2 ", "janela_max_dias"),
])
def test_runner_config_rejects_bad_values(tmp_path, old, new, key):
    txt = CFG_PATH.read_text()
    assert old in txt
    p = tmp_path / "d.yaml"
    p.write_text(txt.replace(old, new, 1))
    with pytest.raises(ConfigError, match=key):
        load_detector_config(p)


# ---- acceptance (held-out seeds >= 300) -------------------------------------------------

@pytest.mark.slow
@pytest.mark.parametrize("seed", [320, 321])
def test_acceptance_clean_campo_week_at_most_one_event_per_sensor(seed):
    """Hourly runs over the week (a 5-min cadence costs ~10 min per seed). What an hourly cadence
    could miss are the short-lived per-sample/pico states, so those are checked on the whole week
    directly: no layer-1 sample flag and never pico_min_count picos within 60 min."""
    data = week(10, seed=seed)
    raw = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    simulate(every(at(days=3), at(days=10), minutes=60), raw, [buoy()], store, influx)
    per_sensor = {s: len(store.opened("dev1", s)) for s in SENSORS}
    max_picos = {}
    for s in SENSORS:
        v, r = data[s][data[s].index >= at(days=3)], CFG.sensores[s]
        assert rules.check_faixa(v, r) + rules.check_plausibilidade(v, r) + rules.check_salto(v, r) == []
        picos = v[stats.hampel(v, cfg=CFG.stats, mad_min=r.mad_min).to_numpy()]
        max_picos[s] = int(pd.Series(1, index=picos.index).rolling("60min").sum().max()) if len(picos) else 0
    print(f"clean week seed {seed}: events per sensor {per_sensor}, max picos/60 min {max_picos}, "
          f"flags written {len(influx.written)}")
    assert all(n <= 1 for n in per_sensor.values()), per_sensor
    assert all(n < CFG.pico_min_count for n in max_picos.values()), max_picos


def test_acceptance_stuck_ph_opens_falha_then_closes():
    data = week(5, seed=330)
    s0 = at(days=4)
    data["ph"] = inject_stuck(data["ph"], s0, timedelta(hours=3))
    raw = frame("dev1", **data)
    store, influx = FakeStore(), FakeInflux()
    times = every(s0 - timedelta(minutes=30), s0 + timedelta(hours=4, minutes=30))
    hist = simulate(times, raw, [buoy()], store, influx)
    falha = [e for e in store.opened("dev1", "ph") if e["estado"] == "falha"]
    assert len(falha) == 1 and len(store.events) == 1, store.events   # no pico artifact after it
    ev = falha[0]
    assert s0 + CFG.sensores["ph"].travado_min <= ev["inicio"] <= s0 + CFG.sensores["ph"].travado_min + timedelta(minutes=10)
    assert ev["fim"] is not None and ev["fim"] <= s0 + timedelta(hours=3, minutes=10)
    assert hist[-1][("dev1", "ph")] == "ok"
    assert [e for e in store.events if e["sensor"] != "ph"] == []
    trav = influx.flags(regra="travado", sensor="ph")
    assert len({f["time"] for f in trav}) == 1                     # one stable point per episode
    assert abs(trav[0]["time"] - pd.Timestamp(s0)) <= timedelta(minutes=1)


# ---- memory -----------------------------------------------------------------------------

@pytest.mark.slow
@pytest.mark.parametrize("seed", [350, 351])
def test_acceptance_deriva_parked_at_threshold_opens_at_most_one_event(seed):
    """R27: residual offset parked exactly at delta_min/2 for days 8-11, 15-min runs."""
    data = week(12, seed=seed)
    data["ph"] = inject_step(data["ph"], at(days=5), 0.5)
    data["ph"] = inject_step(data["ph"], at(days=7), 0.15 - 0.5)
    raw = frame("dev1", **data)
    store, fake = FakeStore(), FakeInflux(raw)
    seq = []
    for now in every(at(days=8), at(days=11), minutes=15):
        store.last_ok = now - timedelta(minutes=15)
        runner.run_cycle(now, fake, store, [buoy()], [], CFG)
        seq.append(store.states[("dev1", "ph")].estado)
    transitions = sum(a != b for a, b in zip(seq, seq[1:]))
    events = store.opened("dev1", "ph")
    print(f"deriva parked at 0.15, seed {seed}: transitions={transitions} events={len(events)} "
          f"states={sorted(set(seq))}")
    assert len(events) <= 1, events


@pytest.mark.slow
def test_runner_peak_rss_for_7d_raw_and_30d_means_under_worker_limit():
    """7 days x 1 device x 3 sensors raw + 30 days of 5-min means, in a fresh interpreter."""
    code = textwrap.dedent(f"""
        import resource, sys
        sys.path.insert(0, {str(Path(__file__).parent)!r})
        import pandas as pd
        from datetime import timedelta
        from test_runner import FakeInflux, FakeStore, frame, buoy, CFG, at, SENSORS
        from synthetic import clean_series
        from sentinela_worker.detector import rules, runner, stats
        raw7 = frame("dev1", **{{s: clean_series(s, 7, seed=400 + i, start=at(days=23))
                                for i, s in enumerate(SENSORS)}})
        now = at(days=30)
        idx = pd.date_range(at(days=0), at(days=23), freq="5min", inclusive="left")
        hist = pd.DataFrame({{s: 7.0 + 0.01 * (idx.minute % 7) for s in SENSORS}}, index=idx)
        hist = hist.rename_axis("_time").reset_index().assign(device_id="dev1")
        class F(FakeInflux):
            def query_df(self, flux):
                df = super().query_df(flux)
                if "aggregateWindow" in flux:
                    df = pd.concat([hist, df], ignore_index=True)
                return df
        base = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        runner.run_cycle(now, F(raw7), FakeStore(), [buoy(desde=None)], [], CFG)
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        print(base // 1024, peak // 1024)
    """)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                         cwd=Path(__file__).parent.parent)
    base_mib, peak_mib = map(int, out.stdout.split()[-2:])
    print(f"runner RSS: after imports+data {base_mib} MiB, peak {peak_mib} MiB")
    assert peak_mib < 300
