"""Layer-1 rules: deterministic, vectorized checks on one sensor's series.

Every rule coerces its input (non-numeric/None/NaN/inf samples are dropped, never
reported as faixa violations) and returns a list of Flag.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

import numpy as np
import pandas as pd

from sentinela_worker.detector.config import DetectorConfig, SensorRules

NOMINAL_STEP = timedelta(seconds=5)


@dataclass(slots=True)   # slots: a long outage can recover ~10^5 flags in one run
class Flag:
    regra: str
    severidade: Literal["suspeito", "falha"]
    time: datetime
    valor: float | None
    detalhe: str


def coerce(s: pd.Series) -> pd.Series:
    out = _normalize_index(pd.to_numeric(s, errors="coerce").astype(float))
    return out[np.isfinite(out.to_numpy())]


def _normalize_index(s: pd.Series) -> pd.Series:
    """Sorted index, duplicate timestamps dropped (keep last)."""
    s = s.sort_index(kind="stable")
    return s[~s.index.duplicated(keep="last")]


def _flags(s: pd.Series, mask, regra: str, severidade: str, detalhe: str) -> list[Flag]:
    sel = s[np.asarray(mask)]
    return [Flag(regra, severidade, t.to_pydatetime(), float(v), detalhe)
            for t, v in zip(sel.index, sel.to_numpy())]


def check_faixa(s: pd.Series, r: SensorRules) -> list[Flag]:
    s = coerce(s)
    lo, hi = r.faixa
    return _flags(s, (s < lo) | (s > hi), "faixa", "falha",
                  f"valor fora da faixa fisica do sensor [{lo:g}, {hi:g}]")


def check_plausibilidade(s: pd.Series, r: SensorRules) -> list[Flag]:
    """Outside the plausible band but inside faixa (faixa violations are reported by check_faixa)."""
    s = coerce(s)
    (flo, fhi), (plo, phi) = r.faixa, r.plausivel
    out = ((s < plo) | (s > phi)) & (s >= flo) & (s <= fhi)
    return _flags(s, out, "plausibilidade", "suspeito",
                  f"valor fora da faixa plausivel [{plo:g}, {phi:g}]")


def check_salto(s: pd.Series, r: SensorRules, step: timedelta = NOMINAL_STEP) -> list[Flag]:
    """Jump between consecutive samples; pairs more than 2x step apart are not compared."""
    s = coerce(s)
    if len(s) < 2:
        return []
    dt = pd.Series(s.index, index=s.index).diff()
    jump = s.diff().abs()
    mask = (jump > r.salto_max) & (dt <= 2 * pd.Timedelta(step))
    return _flags(s, mask, "salto", "suspeito",
                  f"variacao entre amostras consecutivas maior que {r.salto_max:g}")


def check_travado(s: pd.Series, r: SensorRules, step: timedelta = NOMINAL_STEP) -> list[Flag]:
    """Rolling (max - min) over travado_min below travado_eps, i.e. no change at all (eps should be
    under half the 0.01 firmware LSB, so quantized live signals never trip it). One flag per stuck
    run, at the first sample of the run. Stuck exactly at the sensor floor (turbidez 0.00) is only
    'suspeito'."""
    s = coerce(s)
    win = pd.Timedelta(r.travado_min)
    expected = win / pd.Timedelta(step)
    roll = s.rolling(win)
    mask = (((roll.max() - roll.min()) < r.travado_eps) & (roll.count() >= 0.8 * expected)).fillna(False)
    starts = mask & ~mask.shift(1, fill_value=False)
    flags = []
    for end in s.index[starts.to_numpy()]:
        v = float(s[end])
        first = s.index[s.index.searchsorted(end - win, side="right")]
        at_piso = r.piso is not None and abs(v - r.piso) <= r.travado_eps
        flags.append(Flag(
            "travado", "suspeito" if at_piso else "falha", first.to_pydatetime(), v,
            f"valor constante por {int(win.total_seconds() // 60)} min"
            + (" no piso do sensor" if at_piso else "")))
    return flags


def check_sem_dados(last_seen: datetime | None, now: datetime, cfg: DetectorConfig) -> list[Flag]:
    if last_seen is None:
        return [Flag("sem_dados", "falha", now, None, "nenhuma amostra recebida")]
    if now - last_seen > cfg.sem_dados_max:
        mins = (now - last_seen).total_seconds() / 60
        return [Flag("sem_dados", "falha", last_seen, None,
                     f"sem amostras ha {mins:.0f} min (limite {cfg.sem_dados_max.total_seconds() / 60:.0f} min)")]
    return []


def check_campo_ausente(present: pd.Series) -> list[Flag]:
    """present: bool Series aligned to payload timestamps. One flag per contiguous missing run."""
    miss = ~_normalize_index(present).astype(bool)
    starts = miss & ~miss.shift(1, fill_value=False)
    run_id = starts.cumsum()
    sizes = miss.groupby(run_id).sum()
    flags = []
    for t in miss.index[starts.to_numpy()]:
        n = int(sizes[run_id[t]])
        flags.append(Flag("campo_ausente", "falha", t.to_pydatetime(), None,
                          f"campo ausente no payload ({n} amostras seguidas)"))
    return flags
