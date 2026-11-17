from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from synthetic import (
    clean_series, inject_calibration_session, inject_drift, inject_gap,
    inject_out_of_range, inject_spike, inject_step, inject_stuck,
)

T0 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
MEANS = {"ph": (7.8, 0.15), "temperatura": (28.0, 1.5), "turbidez": (25.0, 8.0)}


def at(h=0, m=0):
    return T0 + timedelta(hours=h, minutes=m)


def base(sensor="ph", days=2):
    return clean_series(sensor, days=days)


def outside(a, b, lo, hi):
    def cut(x):
        return x[(x.index < lo) | (x.index >= hi)]
    return cut(a), cut(b)


@pytest.mark.parametrize("sensor", list(MEANS))
def test_shape_index_name_and_quantization(sensor):
    s = clean_series(sensor, days=1)
    assert len(s) == 86400 // 5
    assert s.name == sensor
    assert str(s.index.tz) == "UTC"
    assert s.index[0] == pd.Timestamp(T0)
    assert (s.index[1:] - s.index[:-1] == pd.Timedelta(seconds=5)).all()
    assert s.dtype == float
    assert np.allclose(s, s.round(2), atol=1e-9)
    mean, amp = MEANS[sensor]
    assert abs(s.mean() - mean) < amp * 0.3
    assert s.max() - s.min() > amp  # daily cycle present


def test_daily_cycle_peaks_near_15h_local():
    s = clean_series("temperatura", days=1)
    hourly = s.groupby((s.index.hour)).mean()
    assert hourly.idxmax() in (17, 18, 19)  # 15:00 UTC-3 == 18:00 UTC


def test_determinism_and_seed():
    a, b = clean_series("ph", 1, seed=3), clean_series("ph", 1, seed=3)
    pd.testing.assert_series_equal(a, b)
    assert not a.equals(clean_series("ph", 1, seed=4))


def test_step_and_start_kwarg():
    s = clean_series("ph", 0.01, step_s=10, start=datetime(2026, 3, 1, tzinfo=timezone.utc))
    assert s.index[0] == pd.Timestamp("2026-03-01T00:00:00Z")
    assert (s.index[1] - s.index[0]) == pd.Timedelta(seconds=10)


def test_turbidez_never_negative():
    assert (clean_series("turbidez", 3, seed=1) >= 0).all()


def test_unknown_sensor():
    with pytest.raises(ValueError):
        clean_series("salinidade", 1)


def test_stuck_freezes_only_window():
    s = base()
    d = timedelta(minutes=30)
    out = inject_stuck(s, at(3), d)
    w = (out.index >= at(3)) & (out.index < at(3) + d)
    assert out[w].nunique() == 1
    a, b = outside(s, out, at(3), at(3) + d)
    pd.testing.assert_series_equal(a, b)


def test_inputs_not_mutated():
    s = base()
    ref = s.copy()
    inject_stuck(s, at(1), timedelta(minutes=5))
    inject_spike(s, at(1), 1.0)
    inject_step(s, at(1), 1.0)
    inject_drift(s, at(1), 1.0)
    inject_gap(s, at(1), timedelta(minutes=5))
    inject_out_of_range(s, at(1), 99.0)
    inject_calibration_session(s, at(1))
    pd.testing.assert_series_equal(s, ref)


def test_spike_single_sample():
    s = base()
    out = inject_spike(s, at(5), 2.0)
    diff = (out - s).abs() > 1e-9
    assert diff.sum() == 1
    assert out[pd.Timestamp(at(5))] == pytest.approx(s[pd.Timestamp(at(5))] + 2.0, abs=0.01)


def test_step_from_at_onward():
    s = base()
    out = inject_step(s, at(10), -0.5)
    a, b = outside(s, out, at(10), s.index[-1] + pd.Timedelta(seconds=5))
    pd.testing.assert_series_equal(a, b)
    after = out[out.index >= at(10)] - s[s.index >= at(10)]
    assert np.allclose(after, -0.5, atol=0.011)


def test_drift_linear_from_start():
    s = base(days=3)
    out = inject_drift(s, at(12), 0.3)
    pre = s.index < at(12)
    pd.testing.assert_series_equal(s[pre], out[pre])
    end = s.index[-1]
    expected = 0.3 * (end - pd.Timestamp(at(12))).total_seconds() / 86400
    assert (out[end] - s[end]) == pytest.approx(expected, abs=0.011)
    assert np.allclose(out, out.round(2))


def test_gap_removes_samples():
    s = base()
    d = timedelta(minutes=10)
    out = inject_gap(s, at(2), d)
    assert len(out) == len(s) - 120
    assert not out.isna().any()
    assert not ((out.index >= at(2)) & (out.index < at(2) + d)).any()
    a, b = outside(s, out, at(2), at(2) + d)
    pd.testing.assert_series_equal(a, b)
    assert out.index.tz is not None


def test_out_of_range_single_sample():
    s = base()
    out = inject_out_of_range(s, at(7), 14.9)
    assert out[pd.Timestamp(at(7))] == 14.9
    assert ((out - s).abs() > 1e-9).sum() == 1


def test_calibration_plateaus():
    s = base()
    out = inject_calibration_session(s, at(4))
    for i, v in enumerate((4.00, 6.86, 9.18)):
        w = (out.index >= at(4, 10 * i)) & (out.index < at(4, 10 * i + 10))
        assert (out[w] - v).abs().max() <= 0.02 + 1e-9
        assert np.allclose(out[w], out[w].round(2))
    a, b = outside(s, out, at(4), at(4, 30))
    pd.testing.assert_series_equal(a, b)


def test_naive_datetime_rejected():
    with pytest.raises(ValueError):
        inject_spike(base(), datetime(2026, 1, 5, 1), 1.0)
