import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from synthetic import (clean_series, inject_gap, inject_out_of_range, inject_spike,
                       inject_step, inject_stuck)

from sentinela_worker.detector import rules
from sentinela_worker.detector.config import ConfigError, load_detector_config

CFG_PATH = Path(__file__).parent.parent / "config" / "detector.yaml"
CFG = load_detector_config(CFG_PATH)
T0 = datetime(2026, 1, 5, tzinfo=timezone.utc)


def at(**kw):
    return T0 + timedelta(**kw)


def all_layer1(sensor, s):
    r = CFG.sensores[sensor]
    return (rules.check_faixa(s, r) + rules.check_plausibilidade(s, r)
            + rules.check_salto(s, r) + rules.check_travado(s, r))


def test_each_layer1_fault_is_flagged():
    r = CFG.sensores["ph"]
    base = clean_series("ph", 1)
    f = rules.check_travado(inject_stuck(base, at(hours=10), timedelta(hours=3)), r)
    assert len(f) == 1 and f[0].regra == "travado" and f[0].severidade == "falha"
    assert at(hours=9, minutes=50) <= f[0].time <= at(hours=10, minutes=10)
    f = rules.check_faixa(inject_out_of_range(base, at(hours=5), 20.0), r)
    assert [(x.regra, x.severidade, x.valor, x.time) for x in f] == [("faixa", "falha", 20.0, at(hours=5))]
    f = rules.check_salto(inject_step(base, at(hours=6), 2.0), r)
    assert len(f) == 1 and f[0].regra == "salto" and f[0].severidade == "suspeito" and f[0].time == at(hours=6)
    f = rules.check_sem_dados(inject_gap(base, at(hours=8), timedelta(hours=1)).index[-1].to_pydatetime(),
                              at(hours=24, minutes=30), CFG)
    assert f and f[0].regra == "sem_dados" and f[0].severidade == "falha"
    f = rules.check_plausibilidade(inject_out_of_range(base, at(hours=5), 12.0), r)
    assert len(f) == 1 and f[0].severidade == "suspeito"


def test_gap_does_not_create_salto():
    r = CFG.sensores["temperatura"]
    s = inject_step(clean_series("temperatura", 1), at(hours=6), 1.5)
    s = inject_gap(s, at(hours=6) - timedelta(minutes=1), timedelta(minutes=2))
    assert rules.check_salto(s, r) == []


def test_stuck_at_floor_is_suspeito_not_falha():
    r = CFG.sensores["turbidez"]
    base = clean_series("turbidez", 1)
    s = inject_out_of_range(base, at(hours=9, minutes=59, seconds=55), 0.0)
    s = inject_stuck(s, at(hours=10), timedelta(hours=3))
    f = rules.check_travado(s, r)
    assert len(f) == 1 and f[0].severidade == "suspeito" and f[0].valor == 0.0
    # same stuck at a non-floor value is a falha
    f2 = rules.check_travado(inject_stuck(base, at(hours=10), timedelta(hours=3)), r)
    assert f2[0].severidade == "falha"


def test_missing_temperatura_is_campo_ausente():
    idx = clean_series("temperatura", 0.1).index
    present = pd.Series(True, index=idx)
    present.iloc[100:110] = False
    f = rules.check_campo_ausente(present)
    assert len(f) == 1 and f[0].regra == "campo_ausente" and f[0].severidade == "falha"
    assert f[0].time == idx[100].to_pydatetime()
    assert rules.check_campo_ausente(pd.Series(True, index=idx)) == []


def test_rules_ignore_nan_and_non_numeric():
    s = clean_series("ph", 0.05).astype(object)
    s.iloc[3] = None
    s.iloc[4] = "abc"
    s.iloc[5] = float("nan")
    s.iloc[6] = float("inf")
    r = CFG.sensores["ph"]
    assert rules.check_faixa(s, r) == []
    assert rules.check_plausibilidade(s, r) == []
    assert rules.check_salto(s, r) == []
    assert rules.check_travado(s, r) == []


def test_clean_week_has_no_layer1_flags():
    for i, sensor in enumerate(("ph", "temperatura", "turbidez")):
        assert all_layer1(sensor, clean_series(sensor, 7, seed=i + 1)) == []


def test_spike_flagged_by_salto():
    r = CFG.sensores["ph"]
    base = clean_series("ph", 1)
    f = rules.check_salto(inject_spike(base, at(hours=3), 3.0), r)
    assert len(f) >= 1 and f[0].time == at(hours=3)


def test_layer1_performance_week():
    series = {s: clean_series(s, 7, seed=i + 1) for i, s in enumerate(("ph", "temperatura", "turbidez"))}
    t = time.perf_counter()
    n = sum(len(all_layer1(s, v)) for s, v in series.items())
    elapsed = time.perf_counter() - t
    print(f"layer-1 on 3x7d ({sum(map(len, series.values()))} pts): {elapsed:.2f}s")
    assert n == 0 and elapsed < 60


def test_config_loads_expected_values():
    t = CFG.sensores["turbidez"]
    assert CFG.sensores["ph"].travado_eps == 0.005
    assert t.piso == 0 and t.faixa[0] == 0 and t.travado_min == timedelta(minutes=120)
    assert CFG.sensores["temperatura"].travado_min == timedelta(minutes=360)
    assert CFG.sensores["ph"].piso is None
    assert CFG.sem_dados_max == timedelta(minutes=10) and CFG.janela == timedelta(days=7)
    assert CFG.stats.hampel_window == 21 and CFG.stats.cusum_h == 5.0


@pytest.mark.parametrize("old,new,key", [
    ("salto_max: 1.0", "salto_max: abc", "sensores.ph.salto_max"),
    ("faixa: [0, 14]", "faixa: [14, 0]", "sensores.ph.faixa"),
    ("hampel_k: 3.0", "hampel_k: -1", "stats.hampel_k"),
    ("stl_min_days: 3", "stl_min_days: 1.5", "stats.stl_min_days"),
    ("    piso: null", "    pisso: null", "sensores.ph.pisso"),
    ("janela_dias: 7 ", "janela_dia: 7 ", "janela_dia"),
])
def test_config_rejects_bad_values_naming_key(tmp_path, old, new, key):
    txt = CFG_PATH.read_text()
    assert old in txt
    p = tmp_path / "d.yaml"
    p.write_text(txt.replace(old, new, 1))
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_detector_config(p)


def _night_ph(values):
    idx = pd.date_range(T0, periods=len(values), freq="5s", tz="UTC")
    return pd.Series(values, index=idx)


def test_quantized_live_ph_is_not_stuck():
    r = CFG.sensores["ph"]
    n = 2 * 720 * 6
    v = np.full(n, 7.80)
    v[::300] = 7.81                       # one LSB blip every 25 min
    assert rules.check_travado(_night_ph(v), r) == []
    v = np.round(7.80 + 0.01 * (np.arange(n) // 240), 2)   # +0.01 every 20 min
    assert rules.check_travado(_night_ph(v), r) == []
    v = np.round(7.80 + 0.01 * (np.arange(n) // 480), 2)   # +0.01 every 40 min (plateau < 120 min)
    assert rules.check_travado(_night_ph(v), r) == []


def test_truly_constant_series_is_falha_and_time_is_first_sample():
    r = CFG.sensores["ph"]
    s = _night_ph(np.full(720 * 3, 7.80))   # 3 h constant (> 120 min window)
    f = rules.check_travado(s, r)
    assert len(f) == 1 and f[0].severidade == "falha" and f[0].time == T0


def test_unsorted_and_duplicate_index_do_not_raise():
    r = CFG.sensores["ph"]
    s = _night_ph(np.full(720 * 3, 7.80))
    shuffled = s.sample(frac=1, random_state=0)
    assert len(rules.check_travado(shuffled, r)) == 1
    dup = pd.concat([s, s.iloc[:10]])
    assert len(rules.check_travado(dup, r)) == 1
    assert rules.check_salto(shuffled, r) == [] and rules.check_faixa(dup, r) == []
    present = pd.Series(True, index=s.index[:5])
    present.iloc[2] = False
    dpresent = pd.concat([present, present])
    f = rules.check_campo_ausente(dpresent.sample(frac=1, random_state=1))
    assert len(f) == 1 and f[0].time == s.index[2].to_pydatetime()
