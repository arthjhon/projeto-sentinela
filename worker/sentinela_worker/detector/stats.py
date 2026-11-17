"""Layer-2 statistics: Hampel spikes, STL + CUSUM drift, Theil-Sen turbidity creep.

All functions are pure (no I/O) and take a series; thresholds come from StatsConfig.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view
from scipy.stats import theilslopes
from statsmodels.tsa.seasonal import STL

from sentinela_worker.detector.config import DerivaRules, DetectorConfig, StatsConfig
from sentinela_worker.detector.rules import Flag, coerce

MAD_TO_SIGMA = 1.4826
STL_BIN = pd.Timedelta(minutes=5)
CUSUM_BIN = pd.Timedelta(hours=1)
INCRUSTACAO_MIN_DAYS = 3
# Interpolation strides: ~10x faster than the exact smoother, no visible change in the seasonal.
_STL_JUMPS = dict(seasonal_jump=6, trend_jump=24, low_pass_jump=24)


@dataclass
class Layer2Result:
    flags: list[Flag] = field(default_factory=list)
    dados_suficientes: bool = True


def _mad(x: np.ndarray) -> float:
    return MAD_TO_SIGMA * float(np.median(np.abs(x - np.median(x))))


def hampel(s: pd.Series, window: int | None = None, k: float | None = None,
           cfg: StatsConfig | None = None, mad_min: float = 0.0) -> pd.Series:
    """Boolean mask of isolated spikes: |x - rolling median| > k * max(1.4826*MAD, mad_min).

    Centered window of `window` samples (shrinking at the edges); the MAD is the rolling
    median of the deviations from each sample's own rolling median (standard fast
    approximation). `mad_min` keeps flat or clamped windows (MAD == 0) able to flag a spike.
    Needs at least `window` samples, otherwise nothing is flagged.
    """
    cfg = cfg or StatsConfig()
    window = cfg.hampel_window if window is None else window
    k = cfg.hampel_k if k is None else k
    s = coerce(s)
    if len(s) < window:
        return pd.Series(False, index=s.index)
    roll = dict(window=window, center=True, min_periods=window // 2 + 1)
    med = s.rolling(**roll).median()
    dev = (s - med).abs()
    scale = np.maximum(MAD_TO_SIGMA * dev.rolling(**roll).median(), mad_min)
    flagged = (scale > 0) & (dev > k * scale)
    return pd.Series(flagged.to_numpy(), index=s.index)


def _deseasonalized(s: pd.Series, cfg: StatsConfig) -> pd.Series | None:
    """5-min means minus the robust STL seasonal component (trend kept, so drift survives).

    The STL fit runs on a gap-free grid (small holes are interpolated so the daily phase
    stays aligned); the returned series only has the bins that actually had data.
    Returns None when there is less than `stl_min_days` of data.
    """
    s = coerce(s)
    if s.empty:
        return None
    binned = s.resample(STL_BIN).mean()
    present = binned.notna()
    if present.sum() * STL_BIN < pd.Timedelta(days=cfg.stl_min_days):
        return None
    period = cfg.stl_period_s // int(STL_BIN.total_seconds())
    if len(binned) < 2 * period:
        return None
    filled = binned.interpolate(limit_direction="both")
    fit = STL(filled, period=period, robust=True, **_STL_JUMPS).fit()
    return (filled - fit.seasonal)[present]


def stl_residual(s: pd.Series, cfg: StatsConfig | None = None) -> pd.Series | None:
    """Deseasonalized 5-min series (level), or None when data is insufficient.

    The STL trend is deliberately NOT removed: it carries the slow drift the CUSUM must see.
    """
    return _deseasonalized(s, cfg or StatsConfig())


@dataclass(frozen=True)
class DerivaAlarm:
    time: datetime      # when the CUSUM crossed h
    start: datetime     # change-point estimate: last time the active side was at 0
    shift: float        # mean offset from baseline between start and alarm, sensor units


def cusum_alarms(level: pd.Series, cfg: StatsConfig | None = None,
                 rules: DerivaRules | None = None) -> list[DerivaAlarm]:
    """Two-sided CUSUM on the hourly level against a fixed baseline (statistic resets after each alarm).

    Baseline = median of the first `stl_min_days` of `level`; the CUSUM only runs after that
    phase. z = (x - baseline) / sigma_eff with sigma_eff = max(robust scale of the baseline
    phase, sigma_min) and reference k = (delta_min / 2) / sigma_eff, so shifts smaller than
    `delta_min` never accumulate however clean the signal is. Threshold h = cfg.cusum_h.
    """
    cfg = cfg or StatsConfig()
    rules = rules or DerivaRules()
    h = coerce(level).resample(CUSUM_BIN).mean().dropna()
    if h.empty:
        return []
    base = h[h.index < h.index[0] + pd.Timedelta(days=cfg.stl_min_days)]
    rest = h[h.index >= h.index[0] + pd.Timedelta(days=cfg.stl_min_days)]
    if len(base) < 12 or rest.empty:
        return []
    baseline = float(np.median(base))
    sigma = max(_mad(base.to_numpy()), rules.sigma_min)
    k = (rules.delta_min / 2) / sigma
    dev = rest.to_numpy() - baseline
    out: list[DerivaAlarm] = []
    hi = lo = 0.0
    zero_hi = zero_lo = base.index[-1]
    i0 = 0                                    # first sample after the last reset
    for i, (t, d) in enumerate(zip(rest.index, dev)):
        z = d / sigma
        hi = max(0.0, hi + z - k)
        lo = max(0.0, lo - z - k)
        if hi == 0.0:
            zero_hi = t
        if lo == 0.0:
            zero_lo = t
        if hi > cfg.cusum_h or lo > cfg.cusum_h:
            start = zero_hi if hi > cfg.cusum_h else zero_lo
            seg = dev[max(i0, int(rest.index.searchsorted(start, side="right"))):i + 1]
            out.append(DerivaAlarm(t.to_pydatetime(), start.to_pydatetime(),
                                   float(seg.mean()) if len(seg) else float(d)))
            hi = lo = 0.0
            zero_hi = zero_lo = t
            i0 = i + 1
    return out


def cusum_alarm(level: pd.Series, cfg: StatsConfig | None = None,
                rules: DerivaRules | None = None) -> DerivaAlarm | None:
    alarms = cusum_alarms(level, cfg, rules)
    return alarms[0] if alarms else None


def theil_sen_per_day(s: pd.Series) -> float:
    """Theil-Sen slope in units/day, on hourly means (keeps the pairwise cost trivial)."""
    h = coerce(s).resample(CUSUM_BIN).mean().dropna()
    if len(h) < 2:
        return 0.0
    days = (h.index - h.index[0]).total_seconds().to_numpy() / 86400
    return float(theilslopes(h.to_numpy(), days)[0])


def layer2_flags(s: pd.Series, sensor: str, cfg: DetectorConfig,
                 since: datetime | None) -> Layer2Result:
    """Adapter for the runner. `since` is the last reset point (maintenance/mode change):
    every statistic uses only data from `since` on."""
    st, rules = cfg.stats, cfg.sensores[sensor]
    s = coerce(s)
    if since is not None:
        s = s[s.index >= pd.Timestamp(since)]
    flags: list[Flag] = []

    spikes = s[hampel(s, cfg=st, mad_min=rules.mad_min).to_numpy()]
    flags += [Flag("pico", "suspeito", t.to_pydatetime(), float(v),
                   f"pico isolado (Hampel, janela {st.hampel_window}, k={st.hampel_k:g})")
              for t, v in zip(spikes.index, spikes.to_numpy())]

    d = _deseasonalized(s, st)
    if d is None:
        return Layer2Result(flags, False)

    if rules.deriva.habilitado:
        alarm = cusum_alarm(d, st, rules.deriva)
        if alarm is not None:
            flags.append(Flag("deriva", "suspeito", alarm.start, alarm.shift,
                              f"deriva lenta: nivel {alarm.shift:+.3g} (unidades do sensor) em relacao "
                              f"ao baseline; inicio estimado {alarm.start:%Y-%m-%d %H:%M}, "
                              f"alarme {alarm.time:%Y-%m-%d %H:%M} (CUSUM)"))

    if sensor == "turbidez" and len(d):
        if d.index[-1] - d.index[0] >= pd.Timedelta(days=INCRUSTACAO_MIN_DAYS):
            slope = theil_sen_per_day(d)
            if slope > st.incrustacao_ntu_dia:
                flags.append(Flag("incrustacao", "suspeito", d.index[-1].to_pydatetime(), slope,
                                  f"turbidez subindo {slope:.1f} NTU/dia desde a ultima manutencao "
                                  f"(limite {st.incrustacao_ntu_dia:g})"))
    return Layer2Result(flags, True)
