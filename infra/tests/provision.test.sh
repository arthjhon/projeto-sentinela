#!/usr/bin/env bash
# Runs infra/tests/test_provision_board.py in a pinned python image (repo mounted read-only,
# non-root, no secrets). Needs docker and network for pip (pinned versions).
set -u
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)
readonly IMAGE=python:3.12.8-slim

docker run --rm --user "$(id -u):$(id -g)" --read-only --tmpfs /tmp \
  -e HOME=/tmp -e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/tmp/deps \
  -v "$repo:/repo:ro" -w /repo "$IMAGE" \
  sh -c 'pip install --quiet --disable-pip-version-check --target /tmp/deps pyserial==3.5 pytest==8.3.4 \
         && python -m pytest -q -p no:cacheprovider infra/tests/test_provision_board.py'
