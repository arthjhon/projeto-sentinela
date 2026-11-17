from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from synthetic import (DEFAULT_START, clean_series, inject_drift, inject_spike, inject_step)

from sentinela_worker.detector import stats
from sentinela_worker.detector.config import ConfigError, load_detector_config

CFG_PATH = Path(__file__).parent.parent / "config" / "detector.yaml"
CFG = load_detector_config(CFG_PATH)
ST = CFG.stats
SEED_BASE = {"ph": 0, "temperatura": 1000, "turbidez": 2000}
T0 = pd.Timestamp(DEFAULT_START)
BASELINE_END = T0 + timedelta(days=ST.stl_min_days)
# Thresholds were tuned on seeds 0-9 (see task-14 reports); acceptance uses held-out seeds.
HELD_OUT = range(100, 130)


def series(sensor, days, seed=0):
    return clean_series(sensor, days, seed=SEED_BASE[sensor] + seed)


def of(res, regra):
    return [f for f in res.flags if f.regra == regra]


def level_variability(s, sigma=0.02, smooth_h=6, seed=0):
    """Day-to-day level changes: per-day offsets ~ N(0, sigma), smoothed over `smooth_h` hours."""
    rng = np.random.default_rng(seed)
    days = int(np.ceil((s.index[-1] - s.index[0]) / pd.Timedelta(days=1))) + 1
    off = pd.Series(rng.normal(0, sigma, days),
                    index=pd.date_range(s.index[0].normalize(), periods=days, freq="1D"))
    lvl = off.reindex(s.index, method="ffill").rolling(f"{smooth_h}h", min_periods=1).mean()
    return (s + lvl).round(2)


# ---- Hampel ---------------------------------------------------------------------------

def test_hampel_flags_injected_spikes():
    s = series("ph", 1)
    at = [s.index[i] for i in (2000, 9000, 15000)]
    for t in at:
        s = inject_spike(s, t, 0.5)
    mask = stats.hampel(s, cfg=ST, mad_min=CFG.sensores["ph"].mad_min)
    assert mask.index.equals(s.index) and all(mask[t] for t in at)


def test_hampel_needs_a_window_of_samples_not_stl_coverage():
    s = series("ph", 0.02)                                   # 144 samples, far below 3 days
    t = s.index[70]
    res = stats.layer2_flags(inject_spike(s, t, 0.5), "ph", CFG, since=None)
    assert res.dados_suficientes is False
    assert [f.time for f in of(res, "pico")] == [t.to_pydatetime()]
    assert not stats.hampel(s.iloc[:50], cfg=ST).any()       # shorter than the window


def test_hampel_flat_signal_without_floor_never_flags():
    s = pd.Series([1.0] * 300, index=pd.date_range(T0, periods=300, freq="5s"))
    assert not stats.hampel(s, cfg=ST).any()


def test_clamped_turbidity_spike_is_pico():
    s = pd.Series(0.0, index=pd.date_range(T0, periods=2000, freq="5s"))
    t = s.index[1000]
    res = stats.layer2_flags(inject_spike(s, t, 20.0), "turbidez", CFG, since=None)
    assert [f.time for f in of(res, "pico")] == [t.to_pydatetime()]


def test_flat_temperature_spike_is_pico():
    s = pd.Series(28.0, index=pd.date_range(T0, periods=2000, freq="5s"))
    t = s.index[1000]
    res = stats.layer2_flags(inject_spike(s, t, 1.44), "temperatura", CFG, since=None)
    assert [f.time for f in of(res, "pico")] == [t.to_pydatetime()]


def test_clean_week_pico_count_is_sane():
    counts = {}
    for sensor in SEED_BASE:
        r = CFG.sensores[sensor]
        counts[sensor] = [int(stats.hampel(series(sensor, 7, sd), cfg=ST, mad_min=r.mad_min).sum())
                          for sd in range(100, 110)]
    print("clean-week pico counts (10 held-out seeds):", counts)
    assert max(max(c) for c in counts.values()) <= 60


# ---- STL ------------------------------------------------------------------------------

def test_stl_returns_none_before_three_days():
    assert stats.stl_residual(series("ph", 2.9), ST) is None
    assert stats.stl_residual(series("ph", 3.5), ST) is not None


def test_stl_coverage_counts_data_not_span():
    s = series("ph", 6)
    sparse = s[(s.index - s.index[0]).days % 2 == 0]   # 3 days of data over a 5-day span
    assert stats.stl_residual(sparse, ST) is not None
    sparse = s[(s.index - s.index[0]).days % 3 == 0]   # 2 days of data
    assert stats.stl_residual(sparse, ST) is None


# ---- deriva (CUSUM) ---------------------------------------------------------------------

def test_cusum_flat_level_never_alarms():
    flat = pd.Series(0.0, index=pd.date_range(T0, periods=7 * 288, freq="5min"))
    assert stats.cusum_alarms(flat, ST, CFG.sensores["ph"].deriva) == []


def test_cusum_is_silent_during_baseline_phase():
    s = inject_drift(series("ph", 3.0), T0, 5.0)           # huge drift, but only baseline data
    assert stats.cusum_alarms(stats.stl_residual(s, ST), ST, CFG.sensores["ph"].deriva) == []


def test_clean_week_at_most_one_deriva_alarm_per_sensor_per_seed():
    counts = {}
    for sensor in SEED_BASE:
        rules = CFG.sensores[sensor].deriva           # thresholds of each sensor, enabled or not
        counts[sensor] = [len(stats.cusum_alarms(stats.stl_residual(series(sensor, 7, sd), ST), ST, rules))
                          for sd in HELD_OUT]
    print("clean-week deriva alarms (30 held-out seeds):", counts)
    assert all(max(c) <= 1 for c in counts.values()), counts


@pytest.mark.parametrize("sign", [1, -1])
def test_ph_drift_detected_within_24h_after_baseline(sign):
    lats = []
    for sd in range(100, 106):
        s = inject_drift(series("ph", 7, sd), BASELINE_END, sign * 0.3)
        res = stats.layer2_flags(s, "ph", CFG, since=None)
        assert res.dados_suficientes
        deriva = of(res, "deriva")
        assert len(deriva) == 1 and deriva[0].severidade == "suspeito", sd
        alarm = stats.cusum_alarm(stats.stl_residual(s, ST), ST, CFG.sensores["ph"].deriva)
        lats.append((pd.Timestamp(alarm.time) - BASELINE_END) / pd.Timedelta(hours=1))
        assert timedelta(0) <= pd.Timestamp(alarm.time) - BASELINE_END <= timedelta(hours=24)
        # change-point estimate lies near the true start, and the shift sign is right
        assert abs(pd.Timestamp(deriva[0].time) - BASELINE_END) <= timedelta(hours=12)
        assert np.sign(deriva[0].valor) == sign
    print(f"ph drift latency after baseline end, h (sign {sign}):", lats)


def test_seasonal_temperature_trend_is_not_deriva():
    for sd in range(100, 105):
        s = inject_drift(series("temperatura", 7, sd), T0, 1.0 / 7)      # +1 C/week
        assert of(stats.layer2_flags(s, "temperatura", CFG, since=None), "deriva") == []


def test_ph_day_to_day_level_variability_is_not_deriva():
    counts = []
    for sd in range(100, 120):
        s = level_variability(series("ph", 7, sd), seed=sd)
        counts.append(len(of(stats.layer2_flags(s, "ph", CFG, since=None), "deriva")))
    print("ph level-variability deriva counts (20 held-out seeds):", counts)
    assert max(counts) <= 1


def test_maintenance_step_with_since_after_it_is_not_deriva():
    step_at = T0 + timedelta(days=3)
    since = (step_at + timedelta(minutes=30)).to_pydatetime()
    for delta in (0.1, 0.5):
        s = inject_step(series("ph", 8, 101), step_at, delta)
        assert of(stats.layer2_flags(s, "ph", CFG, since=since), "deriva") == [], delta
    # the same +0.5 step is a deriva when the reset point is ignored
    s = inject_step(series("ph", 8, 101), step_at, 0.5)
    assert of(stats.layer2_flags(s, "ph", CFG, since=None), "deriva")


def test_since_slices_every_statistic():
    s = inject_spike(series("ph", 7, 102), T0 + timedelta(hours=1), 0.5)   # before the reset
    since = (T0 + timedelta(days=1)).to_pydatetime()
    res = stats.layer2_flags(s, "ph", CFG, since=since)
    assert all(f.time >= since for f in res.flags)
    assert stats.layer2_flags(series("ph", 7, 102), "ph", CFG, since=(T0 + timedelta(days=5)).to_pydatetime()
                              ).dados_suficientes is False


def test_deriva_disabled_sensors_emit_no_deriva():
    s = inject_drift(series("temperatura", 7, 100), BASELINE_END, 3.0)
    assert of(stats.layer2_flags(s, "temperatura", CFG, since=None), "deriva") == []


# ---- adapter ----------------------------------------------------------------------------

def test_clean_week_layer2_raises_no_event_flags():
    for sensor in SEED_BASE:
        res = stats.layer2_flags(series(sensor, 7, 103), sensor, CFG, since=None)
        assert res.dados_suficientes
        assert [f for f in res.flags if f.regra in ("deriva", "incrustacao")] == []


def test_layer2_reports_insufficient_data():
    res = stats.layer2_flags(series("ph", 2, 0), "ph", CFG, since=None)
    assert res.dados_suficientes is False
    assert [f for f in res.flags if f.regra != "pico"] == []


def test_layer2_flags_spike_as_pico():
    s = series("ph", 4)
    t = s.index[50000]
    res = stats.layer2_flags(inject_spike(s, t, 0.5), "ph", CFG, since=None)
    assert any(f.time == t.to_pydatetime() and f.severidade == "suspeito" for f in of(res, "pico"))


# ---- Theil-Sen --------------------------------------------------------------------------

def test_theil_sen_flags_turbidity_creep():
    start = T0 + timedelta(days=3)
    s = inject_drift(series("turbidez", 7), start, 5.0)       # 4 days of creep
    res = stats.layer2_flags(s, "turbidez", CFG, since=start.to_pydatetime())
    inc = of(res, "incrustacao")
    assert len(inc) == 1 and inc[0].severidade == "suspeito"
    assert inc[0].valor > ST.incrustacao_ntu_dia
    assert stats.theil_sen_per_day(s[s.index >= start]) == pytest.approx(5.0, abs=1.0)


def test_theil_sen_clean_and_short_window_and_other_sensors():
    clean = series("turbidez", 7, 1)
    assert not of(stats.layer2_flags(clean, "turbidez", CFG, since=T0.to_pydatetime()), "incrustacao")
    creep = inject_drift(clean, T0 + timedelta(days=3), 5.0)
    since = (T0 + timedelta(days=5)).to_pydatetime()           # < 3 days since the reset point
    assert not of(stats.layer2_flags(creep, "turbidez", CFG, since=since), "incrustacao")
    ph = inject_drift(series("ph", 7), T0 + timedelta(days=3), 5.0)
    assert not of(stats.layer2_flags(ph, "ph", CFG, since=T0.to_pydatetime()), "incrustacao")


def test_layer2_runs_fast():
    import time
    s = series("turbidez", 7)
    t = time.perf_counter()
    stats.layer2_flags(s, "turbidez", CFG, since=None)
    elapsed = time.perf_counter() - t
    print(f"layer2_flags 1 sensor x 7 d: {elapsed:.2f}s")
    assert elapsed < 3.0


# ---- config ------------------------------------------------------------------------------

def test_deriva_config_loaded_and_defaults():
    assert CFG.sensores["ph"].deriva.habilitado is True
    assert CFG.sensores["ph"].deriva.delta_min == 0.3 and CFG.sensores["ph"].deriva.sigma_min == 0.05
    assert not CFG.sensores["temperatura"].deriva.habilitado
    assert not CFG.sensores["turbidez"].deriva.habilitado
    assert (CFG.sensores["ph"].mad_min, CFG.sensores["temperatura"].mad_min,
            CFG.sensores["turbidez"].mad_min) == (0.01, 0.0625, 1.0)


@pytest.mark.parametrize("old,new,key", [
    ("      delta_min: 0.3 ", "      delta_min: -1 ", "sensores.ph.deriva.delta_min"),
    ("      habilitado: true ", "      habilitado: sim ", "sensores.ph.deriva.habilitado"),
    ("      sigma_min: 0.05 ", "      sigma_mim: 0.05 ", "sensores.ph.deriva.sigma_mim"),
    ("    mad_min: 0.01 ", "    mad_min: abc ", "sensores.ph.mad_min"),
])
def test_deriva_config_rejects_bad_values(tmp_path, old, new, key):
    txt = CFG_PATH.read_text()
    assert old in txt
    p = tmp_path / "d.yaml"
    p.write_text(txt.replace(old, new, 1))
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_detector_config(p)


# ---- floating baseline (historico) -------------------------------------------------------

def _means(s):
    return s.resample("5min").mean().dropna()


@pytest.mark.parametrize("end_day", [12, 14])
def test_step_stays_deriva_with_historico_after_raw_window_slides_past_baseline(end_day):
    """+0.5 pH step at day 5, reset at day 1: the 7-day raw window no longer holds the baseline,
    but the 5-min means since the reset point do."""
    full = inject_step(series("ph", 15, 104), T0 + timedelta(days=5), 0.5)
    since = (T0 + timedelta(days=1)).to_pydatetime()
    end = T0 + timedelta(days=end_day)
    upto = full[full.index < end]
    raw = upto[upto.index >= end - CFG.janela]
    hist = _means(upto[upto.index >= since])
    res = stats.layer2_flags(raw, "ph", CFG, since=since, historico=hist)
    assert res.dados_suficientes
    deriva = of(res, "deriva")
    assert len(deriva) == 1 and deriva[0].valor > 0.3
    assert abs(pd.Timestamp(deriva[0].time) - (T0 + timedelta(days=5))) <= timedelta(hours=12)
    # without the floating baseline the step disappears once the raw window slides past it
    assert of(stats.layer2_flags(raw, "ph", CFG, since=since), "deriva") == []


def test_historico_does_not_feed_hampel():
    s = series("ph", 1, 105)
    t = s.index[9000]
    spiky = inject_spike(s, t, 0.5)
    tail = s[s.index >= s.index[-1] - timedelta(hours=1)]
    res = stats.layer2_flags(tail, "ph", CFG, since=None, historico=_means(spiky))
    assert of(res, "pico") == []                       # the spike is only in the historico
    res = stats.layer2_flags(spiky, "ph", CFG, since=None, historico=_means(s))
    assert [f.time for f in of(res, "pico")] == [t.to_pydatetime()]


def test_historico_is_sliced_by_since_and_drives_sufficiency():
    s = series("ph", 6, 106)
    hist = _means(s)
    recent = s[s.index >= s.index[-1] - timedelta(hours=1)]
    assert stats.layer2_flags(recent, "ph", CFG, since=None, historico=hist).dados_suficientes
    late = (T0 + timedelta(days=4)).to_pydatetime()
    assert not stats.layer2_flags(recent, "ph", CFG, since=late, historico=hist).dados_suficientes


def test_incrustacao_flag_time_is_stable_across_runs():
    start = T0 + timedelta(days=1)
    s = inject_drift(series("turbidez", 10, 3), start, 5.0)
    times = set()
    for end_day in (7, 8, 9.5):
        upto = s[s.index < T0 + timedelta(days=end_day)]
        inc = of(stats.layer2_flags(upto, "turbidez", CFG, since=start.to_pydatetime()), "incrustacao")
        assert len(inc) == 1
        times.add(inc[0].time)
    assert len(times) == 1
    t = pd.Timestamp(times.pop())
    assert start + timedelta(days=stats.INCRUSTACAO_MIN_DAYS) <= t < T0 + timedelta(days=7)


# ---- deriva hysteresis (R27) ------------------------------------------------------------

def _parked(residual, seed=107, end_day=10):
    s = inject_step(series("ph", end_day + 1, seed), T0 + timedelta(days=5), 0.5)
    s = inject_step(s, T0 + timedelta(days=7), residual - 0.5)
    return s[s.index < T0 + timedelta(days=end_day)]


def test_deriva_hysteresis_enter_and_exit_thresholds():
    rules = CFG.sensores["ph"].deriva
    enter = rules.delta_min / 2
    exit_ = enter * rules.limiar_saida_frac
    assert rules.limiar_saida_frac == 0.5 and exit_ == pytest.approx(rules.delta_min / 4)
    between = _parked(0.11)                     # between delta_min/4 (0.075) and delta_min/2 (0.15)
    off = stats.layer2_flags(between, "ph", CFG, since=None, deriva_ativa_antes=False)
    on = stats.layer2_flags(between, "ph", CFG, since=None, deriva_ativa_antes=True)
    assert of(off, "deriva") and of(on, "deriva")
    assert off.deriva_ativa is False and on.deriva_ativa is True
    assert on.deriva_desvio == pytest.approx(0.11, abs=0.03)
    low = stats.layer2_flags(_parked(0.02), "ph", CFG, since=None, deriva_ativa_antes=True)
    assert low.deriva_ativa is False                                  # below delta_min/4 clears
    high = stats.layer2_flags(_parked(0.3), "ph", CFG, since=None, deriva_ativa_antes=False)
    assert high.deriva_ativa is True and high.deriva_desvio > enter


def test_deriva_limiar_saida_frac_config(tmp_path):
    assert CFG.sensores["temperatura"].deriva.limiar_saida_frac == 0.5
    txt = CFG_PATH.read_text()
    old = "      limiar_saida_frac: 0.5 "
    assert old in txt
    for bad in ("0", "1.5", "abc"):
        p = tmp_path / "d.yaml"
        p.write_text(txt.replace(old, f"      limiar_saida_frac: {bad} ", 1))
        with pytest.raises(ConfigError, match=r"sensores\.ph\.deriva\.limiar_saida_frac"):
            load_detector_config(p)
