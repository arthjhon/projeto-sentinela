from datetime import timedelta
from pathlib import Path

import pandas as pd
import pytest
from synthetic import DEFAULT_START, clean_series, inject_drift, inject_spike

from sentinela_worker.detector import stats
from sentinela_worker.detector.config import load_detector_config

CFG = load_detector_config(Path(__file__).parent.parent / "config" / "detector.yaml")
SEED_BASE = {"ph": 0, "temperatura": 1000, "turbidez": 2000}
DRIFT_PER_DAY = {"ph": 0.3, "temperatura": 1.0, "turbidez": 5.0}
T0 = pd.Timestamp(DEFAULT_START)


def series(sensor, days, seed=0):
    return clean_series(sensor, days, seed=SEED_BASE[sensor] + seed)


def test_hampel_flags_injected_spikes():
    s = series("ph", 1)
    at = [s.index[i] for i in (2000, 9000, 15000)]
    for t in at:
        s = inject_spike(s, t, 0.5)
    mask = stats.hampel(s, CFG.stats.hampel_window, CFG.stats.hampel_k)
    assert mask.index.equals(s.index)
    assert all(mask[t] for t in at)


def test_hampel_ignores_non_numeric_and_constant_windows():
    s = pd.Series([1.0] * 50, index=pd.date_range(T0, periods=50, freq="5s"))
    assert not stats.hampel(s).any()          # MAD == 0: never divide, never flag


def test_stl_returns_none_before_three_days():
    assert stats.stl_residual(series("ph", 2.9), CFG.stats) is None
    assert stats.stl_residual(series("ph", 3.5), CFG.stats) is not None


def test_stl_coverage_counts_data_not_span():
    s = series("ph", 6)
    sparse = s[(s.index - s.index[0]).days % 2 == 0]   # 3 days of data over a 5-day span
    assert stats.stl_residual(sparse, CFG.stats) is not None
    sparse = s[(s.index - s.index[0]).days % 3 == 0]   # 2 days of data
    assert stats.stl_residual(sparse, CFG.stats) is None


def test_cusum_returns_none_on_degenerate_residual():
    flat = pd.Series(0.0, index=pd.date_range(T0, periods=500, freq="1h"))
    assert stats.cusum_alarm(flat, CFG.stats) is None


@pytest.mark.parametrize("sensor", ["ph", "temperatura", "turbidez"])
def test_drift_detected_within_24h(sensor):
    start = T0 + timedelta(days=3)
    s = inject_drift(series(sensor, 7), start, DRIFT_PER_DAY[sensor])
    alarm = stats.cusum_alarm(stats.stl_residual(s, CFG.stats), CFG.stats)
    assert alarm is not None
    lat = pd.Timestamp(alarm) - start
    assert timedelta(0) <= lat <= timedelta(hours=24), lat
    res = stats.layer2_flags(s, sensor, CFG, since=None)
    assert res.dados_suficientes
    assert any(f.regra == "deriva" and f.severidade == "suspeito" for f in res.flags)


def test_negative_drift_detected_too():
    start = T0 + timedelta(days=3)
    s = inject_drift(series("ph", 7), start, -0.3)
    alarm = stats.cusum_alarm(stats.stl_residual(s, CFG.stats), CFG.stats)
    assert alarm is not None and pd.Timestamp(alarm) - start <= timedelta(hours=24)


def test_clean_week_at_most_one_false_event_per_sensor():
    for sensor in SEED_BASE:
        for seed in range(10):
            resid = stats.stl_residual(series(sensor, 7, seed), CFG.stats)
            alarms = stats.cusum_alarms(resid, CFG.stats)
            assert len(alarms) <= 1, (sensor, seed, alarms)


def test_clean_week_layer2_raises_no_event_flags():
    for sensor in SEED_BASE:
        res = stats.layer2_flags(series(sensor, 7, 3), sensor, CFG, since=None)
        assert res.dados_suficientes
        assert [f for f in res.flags if f.regra in ("deriva", "incrustacao")] == []


def test_layer2_reports_insufficient_data():
    res = stats.layer2_flags(series("ph", 2, 0), "ph", CFG, since=None)
    assert res.dados_suficientes is False and res.flags == []


def test_layer2_flags_spike_as_pico():
    s = series("ph", 4)
    t = s.index[50000]
    res = stats.layer2_flags(inject_spike(s, t, 0.5), "ph", CFG, since=None)
    picos = [f for f in res.flags if f.regra == "pico"]
    assert any(f.time == t.to_pydatetime() and f.severidade == "suspeito" for f in picos)


def test_theil_sen_flags_turbidity_creep():
    start = T0 + timedelta(days=3)
    s = inject_drift(series("turbidez", 7), start, 5.0)       # 4 days of creep
    res = stats.layer2_flags(s, "turbidez", CFG, since=start.to_pydatetime())
    inc = [f for f in res.flags if f.regra == "incrustacao"]
    assert len(inc) == 1 and inc[0].severidade == "suspeito"
    assert inc[0].valor > CFG.stats.incrustacao_ntu_dia
    assert stats.theil_sen_per_day(s[s.index >= start]) == pytest.approx(5.0, abs=1.0)


def test_theil_sen_clean_and_short_window_and_other_sensors():
    clean = series("turbidez", 7, 1)
    res = stats.layer2_flags(clean, "turbidez", CFG, since=T0.to_pydatetime())
    assert not [f for f in res.flags if f.regra == "incrustacao"]
    # creeping, but fewer than 3 days since the reset point -> not evaluated
    creep = inject_drift(clean, T0 + timedelta(days=3), 5.0)
    since = (T0 + timedelta(days=5)).to_pydatetime()
    assert not [f for f in stats.layer2_flags(creep, "turbidez", CFG, since=since).flags
                if f.regra == "incrustacao"]
    # only turbidez is evaluated
    ph = inject_drift(series("ph", 7), T0 + timedelta(days=3), 5.0)
    assert not [f for f in stats.layer2_flags(ph, "ph", CFG, since=T0.to_pydatetime()).flags
                if f.regra == "incrustacao"]


def test_layer2_runs_fast():
    import time
    s = series("turbidez", 7)
    t = time.perf_counter()
    stats.layer2_flags(s, "turbidez", CFG, since=None)
    assert time.perf_counter() - t < 3.0
