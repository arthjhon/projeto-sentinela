"""Detector configuration: typed, validated loading of detector.yaml."""
import math
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import yaml

SENSORS = ("ph", "temperatura", "turbidez")


class ConfigError(ValueError):
    pass


@dataclass(frozen=True)
class DerivaRules:
    """Slow-drift (CUSUM) settings per sensor; disabled unless the sensor opts in."""
    habilitado: bool = False
    delta_min: float = 1.0      # smallest level shift worth flagging, in sensor units
    sigma_min: float = 1.0      # floor for the noise scale, in sensor units


@dataclass(frozen=True)
class SensorRules:
    faixa: tuple[float, float]
    plausivel: tuple[float, float]
    salto_max: float
    travado_min: timedelta
    travado_eps: float
    piso: float | None
    mad_min: float = 0.0        # floor for the Hampel scale (flat/clamped windows), sensor units
    deriva: DerivaRules = DerivaRules()


@dataclass(frozen=True)
class StatsConfig:
    hampel_window: int = 121
    hampel_k: float = 5.0
    stl_period_s: int = 86400
    stl_min_days: int = 3
    cusum_h: float = 8.0
    incrustacao_ntu_dia: float = 3.0


@dataclass(frozen=True)
class DetectorConfig:
    sensores: dict[str, SensorRules]
    stats: StatsConfig
    sem_dados_max: timedelta = timedelta(minutes=10)
    estabilizacao: timedelta = timedelta(minutes=30)
    janela: timedelta = timedelta(days=7)
    pico_min_count: int = 5                 # picos within 60 min needed to make the sensor suspeito
    janela_max: timedelta = timedelta(days=30)   # cap of the floating baseline (5-min means)


def _num(v, key: str, *, positive: bool = False, nullable: bool = False) -> float | None:
    if v is None and nullable:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ConfigError(f"{key}: expected a finite number, got {v!r}")
    if positive and v <= 0:
        raise ConfigError(f"{key}: must be > 0, got {v!r}")
    return float(v)


def _int(v, key: str, *, minimum: int = 1) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or v < minimum:
        raise ConfigError(f"{key}: expected an integer >= {minimum}, got {v!r}")
    return v


def _pair(v, key: str) -> tuple[float, float]:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise ConfigError(f"{key}: expected [min, max], got {v!r}")
    lo, hi = (_num(x, f"{key}[{i}]") for i, x in enumerate(v))
    if lo >= hi:
        raise ConfigError(f"{key}: min must be < max, got {v!r}")
    return lo, hi


def _section(d, key: str) -> dict:
    if not isinstance(d, dict):
        raise ConfigError(f"{key}: expected a mapping, got {d!r}")
    return d


_SENSOR_KEYS = {"faixa", "plausivel", "salto_max", "travado_min_min", "travado_eps", "piso",
                "mad_min", "deriva"}
_DERIVA_KEYS = {"habilitado", "delta_min", "sigma_min"}
_TOP_KEYS = {"sem_dados_max_min", "estabilizacao_min", "janela_dias", "pico_min_count",
             "janela_max_dias", "sensores", "stats"}


def _no_unknown(d: dict, prefix: str, allowed: set) -> None:
    for k in d:
        if k not in allowed:
            raise ConfigError(f"{prefix}.{k}: unknown key" if prefix else f"{k}: unknown key")


def _deriva(d, p: str) -> DerivaRules:
    d = _section(d, p)
    _no_unknown(d, p, _DERIVA_KEYS)
    for k in _DERIVA_KEYS:
        if k not in d:
            raise ConfigError(f"{p}.{k}: missing")
    if not isinstance(d["habilitado"], bool):
        raise ConfigError(f"{p}.habilitado: expected true/false, got {d['habilitado']!r}")
    return DerivaRules(
        habilitado=d["habilitado"],
        delta_min=_num(d["delta_min"], f"{p}.delta_min", positive=True),
        sigma_min=_num(d["sigma_min"], f"{p}.sigma_min", positive=True),
    )


def _sensor(d: dict, name: str) -> SensorRules:
    p = f"sensores.{name}"
    d = _section(d, p)
    _no_unknown(d, p, _SENSOR_KEYS)
    for k in ("faixa", "plausivel", "salto_max", "travado_min_min", "travado_eps"):
        if k not in d:
            raise ConfigError(f"{p}.{k}: missing")
    faixa = _pair(d["faixa"], f"{p}.faixa")
    plausivel = _pair(d["plausivel"], f"{p}.plausivel")
    if plausivel[0] < faixa[0] or plausivel[1] > faixa[1]:
        raise ConfigError(f"{p}.plausivel: must lie within faixa {list(faixa)}")
    return SensorRules(
        faixa=faixa,
        plausivel=plausivel,
        salto_max=_num(d["salto_max"], f"{p}.salto_max", positive=True),
        travado_min=timedelta(minutes=_num(d["travado_min_min"], f"{p}.travado_min_min", positive=True)),
        travado_eps=_num(d["travado_eps"], f"{p}.travado_eps", positive=True),
        piso=_num(d.get("piso"), f"{p}.piso", nullable=True),
        mad_min=_num(d.get("mad_min", 0.0), f"{p}.mad_min"),
        deriva=_deriva(d["deriva"], f"{p}.deriva") if "deriva" in d else DerivaRules(),
    )


def _stats(d: dict) -> StatsConfig:
    d = _section(d, "stats")
    base = StatsConfig()
    unknown = set(d) - set(vars(base))
    if unknown:
        raise ConfigError(f"stats.{sorted(unknown)[0]}: unknown key")
    return StatsConfig(
        hampel_window=_int(d.get("hampel_window", base.hampel_window), "stats.hampel_window", minimum=3),
        hampel_k=_num(d.get("hampel_k", base.hampel_k), "stats.hampel_k", positive=True),
        stl_period_s=_int(d.get("stl_period_s", base.stl_period_s), "stats.stl_period_s"),
        stl_min_days=_int(d.get("stl_min_days", base.stl_min_days), "stats.stl_min_days"),
        cusum_h=_num(d.get("cusum_h", base.cusum_h), "stats.cusum_h", positive=True),
        incrustacao_ntu_dia=_num(d.get("incrustacao_ntu_dia", base.incrustacao_ntu_dia),
                                 "stats.incrustacao_ntu_dia", positive=True),
    )


def load_detector_config(path: str | Path) -> DetectorConfig:
    try:
        raw = yaml.safe_load(Path(path).read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise ConfigError(f"{path}: invalid YAML: {e}") from e
    raw = _section(raw, "root")
    _no_unknown(raw, "", _TOP_KEYS)
    sensores = _section(raw.get("sensores"), "sensores")
    _no_unknown(sensores, "sensores", set(SENSORS))
    missing = [s for s in SENSORS if s not in sensores]
    if missing:
        raise ConfigError(f"sensores.{missing[0]}: missing")
    dflt = DetectorConfig(sensores={}, stats=StatsConfig())

    def minutes(key: str, default: timedelta) -> timedelta:
        v = raw.get(key)
        return default if v is None else timedelta(minutes=_num(v, key, positive=True))

    def days(key: str, default: timedelta) -> timedelta:
        v = raw.get(key)
        return default if v is None else timedelta(days=_num(v, key, positive=True))

    st = _stats(raw.get("stats", {}))
    janela_max = days("janela_max_dias", dflt.janela_max)
    if janela_max < timedelta(days=st.stl_min_days):
        raise ConfigError(f"janela_max_dias: must be >= stats.stl_min_days ({st.stl_min_days}), "
                          f"got {janela_max.total_seconds() / 86400:g}")
    return DetectorConfig(
        sensores={s: _sensor(sensores[s], f"{s}") for s in SENSORS},
        stats=st,
        sem_dados_max=minutes("sem_dados_max_min", dflt.sem_dados_max),
        estabilizacao=minutes("estabilizacao_min", dflt.estabilizacao),
        janela=days("janela_dias", dflt.janela),
        pico_min_count=_int(raw.get("pico_min_count", dflt.pico_min_count), "pico_min_count"),
        janela_max=janela_max,
    )
