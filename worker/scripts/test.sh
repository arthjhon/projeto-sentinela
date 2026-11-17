#!/usr/bin/env bash
# Runs pytest inside the pinned production Python image (never the host Python).
# Extra args go to pytest. Optional env: TEST_PG_DSN (passed through, never printed),
# DOCKER_NETWORK (attach the test container to this network).
# Optional SUPABASE_ENV_FILE: when set, ONLY POSTGRES_PASSWORD is parsed from it (never sourced,
# never printed) to build TEST_PG_DSN against supabase-db on the supabase_default network.
set -euo pipefail

if [[ -n "${SUPABASE_ENV_FILE:-}" ]]; then
  pw="$(sed -n 's/^POSTGRES_PASSWORD=//p' "$SUPABASE_ENV_FILE" | head -n1)"
  pw="${pw%\"}"; pw="${pw#\"}"; pw="${pw%\'}"; pw="${pw#\'}"
  [[ -n "$pw" ]] || { echo "POSTGRES_PASSWORD not found in SUPABASE_ENV_FILE" >&2; exit 1; }
  export TEST_PG_DSN="postgresql://postgres:${pw}@supabase-db:5432/postgres"
  export DOCKER_NETWORK="supabase_default"
  unset pw
fi

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

args=(--rm -v "$HERE":/app -w /app -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/app
      -v "$HERE/../supabase/migrations":/supabase/migrations:ro)  # DB tests read the migration
[[ -n "${DOCKER_NETWORK:-}" ]] && args+=(--network "$DOCKER_NETWORK")
[[ -n "${TEST_PG_DSN:-}" ]] && args+=(-e TEST_PG_DSN)   # name only: value is not printed

exec docker run "${args[@]}" "$IMAGE" python -m pytest -q -p no:cacheprovider "$@"
