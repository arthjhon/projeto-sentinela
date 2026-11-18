# syntax=docker/dockerfile:1
# Layers, in order of change frequency, so a code-only change ships a small layer:
#   python base | deps venv (changes only with requirements.lock) | sentinela_worker wheel | config
# Lockfiles: worker/scripts/lock.sh (hashed; pip --require-hashes refuses anything else).
FROM python:3.12.16-slim AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY requirements.lock /tmp/requirements.lock
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --require-hashes --no-deps --only-binary=:all: --no-compile \
      -r /tmp/requirements.lock \
 && /opt/venv/bin/python -m compileall -q /opt/venv/lib

# The package itself, built as a wheel with the hashed build backend (no build isolation,
# so nothing unpinned is downloaded).
FROM python:3.12.16-slim AS pkg
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /src
COPY requirements-build.lock ./
RUN python -m venv /opt/build \
 && /opt/build/bin/pip install --require-hashes --no-deps --only-binary=:all: -r requirements-build.lock
COPY pyproject.toml ./
COPY sentinela_worker ./sentinela_worker
RUN /opt/build/bin/pip wheel --no-deps --no-build-isolation --no-index -w /wheels .

FROM python:3.12.16-slim
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin worker
COPY --from=deps /opt/venv /opt/venv
RUN --mount=type=bind,from=pkg,source=/wheels,target=/wheels \
    PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    pip install --no-deps --no-index --no-compile /wheels/sentinela_worker-*.whl \
 && python -m compileall -q /opt/venv/lib/python3.12/site-packages/sentinela_worker
WORKDIR /app
COPY config /app/config
USER 10001
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD ["python", "-m", "sentinela_worker", "healthcheck"]
CMD ["python", "-m", "sentinela_worker", "run"]
