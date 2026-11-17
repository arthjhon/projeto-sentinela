"""Per-sensor health state: data types and the pure state derivation."""
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:  # rules imports pandas; keep this module import-light for pg.py
    from .rules import Flag

ALERTA = ("falha", "sem_dados", "suspeito")   # estados that open an event


@dataclass(frozen=True)
class SensorState:
    estado: str
    motivo: str
    desde: datetime


@dataclass(frozen=True)
class StateChange:
    device_id: str
    sensor: str
    boia_id: str | None
    modo: str
    new: SensorState
    open_event: bool
    close_event: bool


class HealthStore(Protocol):
    def load_states(self) -> dict[tuple[str, str], SensorState]: ...

    def apply(self, changes: list[StateChange], prune: list[tuple[str, str]]) -> None: ...


def _motivo(flags: "list[Flag]") -> str:
    first = flags[0]
    others = list(dict.fromkeys(f.regra for f in flags if f.regra != first.regra))
    return f"{first.regra}: {first.detalhe}" + (f" (+ {', '.join(others)})" if others else "")


def derive_state(flags: "list[Flag]", modo: str, em_manutencao: bool, cadastrado: bool,
                 dados_suficientes: bool, now: datetime, previous: SensorState | None) -> SensorState:
    """State from the ACTIVE flags (the runner decides which flags still hold at `now`).

    Precedence: manutencao > bancada > nao_cadastrado > falha > sem_dados > suspeito >
    dados_insuficientes > ok. `desde` is kept while the estado does not change, else it is `now`.
    """
    falha = [f for f in flags if f.severidade == "falha" and f.regra != "sem_dados"]
    sem_dados = [f for f in flags if f.regra == "sem_dados"]
    suspeito = [f for f in flags if f.severidade == "suspeito"]
    if em_manutencao:
        estado, motivo = "manutencao", "manutencao em andamento ou em estabilizacao"
    elif modo == "bancada":
        estado, motivo = "bancada", "boia em bancada: marcacoes so vao para o historico"
    elif not cadastrado:
        estado, motivo = "nao_cadastrado", "dispositivo publicando sem cadastro no registro de boias"
    elif falha:
        estado, motivo = "falha", _motivo(falha)
    elif sem_dados:
        estado, motivo = "sem_dados", _motivo(sem_dados)
    elif suspeito:
        estado, motivo = "suspeito", _motivo(suspeito)
    elif not dados_suficientes:
        estado, motivo = "dados_insuficientes", "historico insuficiente para a estatistica (camada 2)"
    else:
        estado, motivo = "ok", ""
    desde = previous.desde if previous is not None and previous.estado == estado else now
    return SensorState(estado, motivo, desde)
