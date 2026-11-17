# syntax=docker/dockerfile:1
FROM python:3.12.16-slim AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /opt/venv
WORKDIR /src
COPY pyproject.toml ./
COPY sentinela_worker ./sentinela_worker
RUN /opt/venv/bin/pip install --only-binary=:all: --no-compile . \
 && /opt/venv/bin/python -m compileall -q /opt/venv/lib

FROM python:3.12.16-slim
ENV PATH=/opt/venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin worker
COPY --from=build /opt/venv /opt/venv
WORKDIR /app
USER 10001
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD ["python", "-m", "sentinela_worker", "healthcheck"]
CMD ["python", "-m", "sentinela_worker", "run"]
