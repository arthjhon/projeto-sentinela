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

from sentinela_worker.detector.config import DetectorConfig, StatsConfig
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
           cfg: StatsConfig | None = None) -> pd.Series:
    """Boolean mask of isolated spikes: |x - rolling median| > k * 1.4826 * rolling MAD.

    Centered window of `window` samples (edges reflected). A window with MAD == 0 (flat
    signal) never flags: that is the `travado` rule's territory.
    """
    cfg = cfg or StatsConfig()
    window = cfg.hampel_window if window is None else window
    k = cfg.hampel_k if k is None else k
    s = coerce(s)
    n = len(s)
    if n < 3 or window < 3:
        return pd.Series(False, index=s.index)
    window = min(window | 1, n if n % 2 else n - 1)        # odd, never longer than the data
    x = s.to_numpy()
    padded = np.pad(x, window // 2, mode="reflect")
    win = sliding_window_view(padded, window)
    med = np.median(win, axis=1)
    mad = MAD_TO_SIGMA * np.median(np.abs(win - med[:, None]), axis=1)
    flagged = (mad > 0) & (np.abs(x - med) > k * mad)
    return pd.Series(flagged, index=s.index)


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
    """Deseasonalized 5-min series, centered on its own baseline; None if data is insufficient.

    The STL trend is deliberately NOT removed: it carries the slow drift the CUSUM must see.
    The baseline is the median of the first `stl_min_days` of data.
    """
    cfg = cfg or StatsConfig()
    d = _deseasonalized(s, cfg)
    if d is None:
        return None
    head = d[d.index < d.index[0] + pd.Timedelta(days=cfg.stl_min_days)]
    return d - float(np.median(head))


def cusum_alarms(resid: pd.Series, cfg: StatsConfig | None = None) -> list[datetime]:
    """Two-sided CUSUM alarm times (statistic resets after each alarm).

    The residual is averaged to hourly bins and standardized by a robust noise scale (MAD of
    successive differences / sqrt 2: unlike the MAD of the level it is not inflated by the
    drift being sought). Returns [] when the scale is zero.
    """
    cfg = cfg or StatsConfig()
    r = coerce(resid)
    r = r.resample(CUSUM_BIN).mean().dropna()
    if len(r) < 3:
        return []
    x = r.to_numpy()
    sigma = _mad(np.diff(x)) / np.sqrt(2)
    if not np.isfinite(sigma) or sigma <= 0:
        return []
    out, hi, lo = [], 0.0, 0.0
    for t, z in zip(r.index, x / sigma):
        hi = max(0.0, hi + z - cfg.cusum_k)
        lo = max(0.0, lo - z - cfg.cusum_k)
        if hi > cfg.cusum_h or lo > cfg.cusum_h:
            out.append(t.to_pydatetime())
            hi = lo = 0.0
    return out


def cusum_alarm(resid: pd.Series, cfg: StatsConfig | None = None) -> datetime | None:
    alarms = cusum_alarms(resid, cfg)
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
    """Adapter for the runner. `since` is the last reset point (maintenance/mode change)."""
    st = cfg.stats
    s = coerce(s)
    d = _deseasonalized(s, st)
    if d is None:
        return Layer2Result([], False)
    flags: list[Flag] = []

    spikes = s[hampel(s, cfg=st).to_numpy()]
    flags += [Flag("pico", "suspeito", t.to_pydatetime(), float(v),
                   f"pico isolado (Hampel, janela {st.hampel_window}, k={st.hampel_k:g})")
              for t, v in zip(spikes.index, spikes.to_numpy())]

    head = d[d.index < d.index[0] + pd.Timedelta(days=st.stl_min_days)]
    alarm = cusum_alarm(d - float(np.median(head)), st)
    if alarm is not None:
        flags.append(Flag("deriva", "suspeito", alarm, None,
                          "deriva lenta fora do ciclo diario (CUSUM no residuo STL)"))

    if sensor == "turbidez":
        w = d if since is None else d[d.index >= pd.Timestamp(since)]
        if len(w) and w.index[-1] - w.index[0] >= pd.Timedelta(days=INCRUSTACAO_MIN_DAYS):
            slope = theil_sen_per_day(w)
            if slope > st.incrustacao_ntu_dia:
                flags.append(Flag("incrustacao", "suspeito", w.index[-1].to_pydatetime(), slope,
                                  f"turbidez subindo {slope:.1f} NTU/dia desde a ultima manutencao "
                                  f"(limite {st.incrustacao_ntu_dia:g})"))
    return Layer2Result(flags, True)
