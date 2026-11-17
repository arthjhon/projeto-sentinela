from dataclasses import dataclass
from datetime import datetime


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
