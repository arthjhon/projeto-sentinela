#!/usr/bin/env bash
# Runs pytest inside the pinned production Python image (never the host Python).
# Extra args go to pytest. Optional env: TEST_PG_DSN (passed through, never printed),
# DOCKER_NETWORK (attach the test container to this network).
set -euo pipefail

PY_TAG="3.12.16-slim"   # keep in sync with worker/Dockerfile
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="sentinela-worker-test:${PY_TAG}"

docker build -q -t "$IMAGE" -f - "$HERE" >/dev/null <<DOCKERFILE
FROM python:${PY_TAG}
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY pyproject.toml ./
RUN python - <<'PY' > /tmp/reqs.txt
import tomllib
d = tomllib.load(open("pyproject.toml", "rb"))["project"]
print("\n".join(d["dependencies"] + d["optional-dependencies"]["test"]))
PY
RUN pip install -r /tmp/reqs.txt
DOCKERFILE

args=(--rm -v "$HERE":/app -w /app -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/app)
[[ -n "${DOCKER_NETWORK:-}" ]] && args+=(--network "$DOCKER_NETWORK")
[[ -n "${TEST_PG_DSN:-}" ]] && args+=(-e TEST_PG_DSN)   # name only: value is not printed

exec docker run "${args[@]}" "$IMAGE" python -m pytest -q -p no:cacheprovider "$@"
