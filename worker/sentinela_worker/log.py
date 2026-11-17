import json
import sys
from datetime import datetime, timezone


def log(level: str, job: str, msg: str, **extra) -> None:
    """Write one JSON line to stdout. Callers must never pass secrets."""
    line = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "job": job, "msg": msg}
    line.update(extra)
    sys.stdout.write(json.dumps(line, ensure_ascii=False, default=str) + "\n")
    sys.stdout.flush()
