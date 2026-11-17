import os
from dataclasses import dataclass, field
from typing import Mapping

_REQUIRED = ("INFLUX_URL", "INFLUX_ORG", "INFLUX_WORKER_TOKEN", "PG_WORKER_DSN")


@dataclass(frozen=True)
class Settings:
    influx_url: str
    influx_org: str
    influx_token: str = field(repr=False)
    pg_dsn: str = field(repr=False)
    detector_config_path: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        missing = [name for name in _REQUIRED if not env.get(name)]
        if missing:
            raise RuntimeError("missing required environment variables: " + ", ".join(missing))
        return cls(
            influx_url=env["INFLUX_URL"],
            influx_org=env["INFLUX_ORG"],
            influx_token=env["INFLUX_WORKER_TOKEN"],
            pg_dsn=env["PG_WORKER_DSN"],
            detector_config_path=env.get("DETECTOR_CONFIG") or "/app/config/detector.yaml",
        )
