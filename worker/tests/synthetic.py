"""Synthetic sensor series with injectable faults (test helper, not shipped code).

Mimics buoy firmware: one sample every 5 s, values serialized with 2 decimals,
turbidez clamped at 0 NTU. Injectors never mutate their input.
"""
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

DEFAULT_START = datetime.fromisoformat("2026-01-05T00:00:00+00:00")
LOCAL_UTC_OFFSET_H = -3
PEAK_LOCAL_HOUR = 15.0

# sensor: (mean, daily amplitude, noise sigma)
_PROFILES = {
    "ph": (7.8, 0.15, 0.03),
    "temperatura": (28.0, 1.5, 0.1),
    "turbidez": (25.0, 8.0, 1.0),
}
_CALIBRATION_PLATEAUS = (4.00, 6.86, 9.18)
_CALIBRATION_STEP = timedelta(minutes=10)


def _ts(value) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return ts.tz_convert("UTC")


def clean_series(sensor: str, days: float, step_s: int = 5, seed: int = 0,
                 start: datetime | pd.Timestamp = DEFAULT_START) -> pd.Series:
    if sensor not in _PROFILES:
        raise ValueError(f"unknown sensor: {sensor}")
    mean, amp, sigma = _PROFILES[sensor]
    n = int(round(days * 86400 / step_s))
    index = pd.date_range(_ts(start), periods=n, freq=pd.Timedelta(seconds=step_s), tz="UTC")
    local_h = (index.hour + index.minute / 60 + index.second / 3600 + LOCAL_UTC_OFFSET_H) % 24
    cycle = amp * np.cos(2 * np.pi * (local_h - PEAK_LOCAL_HOUR) / 24)
    noise = np.random.default_rng(seed).normal(0.0, sigma, n)
    values = np.round(mean + cycle + noise, 2)
    if sensor == "turbidez":
        values = np.clip(values, 0.0, None)
    return pd.Series(values, index=index, name=sensor, dtype=float)


def _window(s: pd.Series, start, duration: timedelta) -> pd.Series:
    t0 = _ts(start)
    return (s.index >= t0) & (s.index < t0 + pd.Timedelta(duration))


def inject_stuck(s: pd.Series, start, duration: timedelta) -> pd.Series:
    out = s.copy()
    w = _window(s, start, duration)
    if w.any():
        before = s[s.index < _ts(start)]
        out[w] = before.iloc[-1] if len(before) else s[w].iloc[0]
    return out


def _at(s: pd.Series, at) -> pd.Timestamp:
    t = _ts(at)
    if t not in s.index:
        raise KeyError(f"{t} is not a sample timestamp")
    return t


def inject_spike(s: pd.Series, at, magnitude: float) -> pd.Series:
    out = s.copy()
    t = _at(s, at)
    out[t] = round(float(s[t]) + magnitude, 2)
    return out


def inject_step(s: pd.Series, at, delta: float) -> pd.Series:
    out = s.copy()
    m = s.index >= _ts(at)
    out[m] = np.round(s[m] + delta, 2)
    return out


def inject_drift(s: pd.Series, start, per_day: float) -> pd.Series:
    out = s.copy()
    t0 = _ts(start)
    m = s.index >= t0
    days = (s.index[m] - t0).total_seconds().to_numpy() / 86400
    out[m] = np.round(s[m].to_numpy() + per_day * days, 2)
    return out


def inject_gap(s: pd.Series, start, duration: timedelta) -> pd.Series:
    return s[~_window(s, start, duration)].copy()


def inject_out_of_range(s: pd.Series, at, value: float) -> pd.Series:
    out = s.copy()
    out[_at(s, at)] = value
    return out


def inject_calibration_session(s: pd.Series, start) -> pd.Series:
    out = s.copy()
    t0 = _ts(start)
    rng = np.random.default_rng(0)
    for i, plateau in enumerate(_CALIBRATION_PLATEAUS):
        lo = t0 + i * pd.Timedelta(_CALIBRATION_STEP)
        w = (s.index >= lo) & (s.index < lo + pd.Timedelta(_CALIBRATION_STEP))
        noise = rng.uniform(-0.01, 0.01, int(w.sum()))
        out[w] = np.round(plateau + noise, 2)
    return out
