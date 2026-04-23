#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_TAG="csv-cleaner-cli-local"

if [[ "${CSV_CLEANER_CLI_IN_CONTAINER:-0}" == "1" ]] || ! command -v docker >/dev/null 2>&1; then
  python -m pytest -q "$SCRIPT_DIR/test_logic.py"
  exit $?
fi

DOCKER_TASK_DIR="$TASK_DIR"
DOCKER_ENV_DIR="$TASK_DIR/environment"
if command -v cygpath >/dev/null 2>&1; then
  DOCKER_TASK_DIR="$(cygpath -am "$TASK_DIR")"
  DOCKER_ENV_DIR="$(cygpath -am "$TASK_DIR/environment")"
fi

MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker build -t "$IMAGE_TAG" "$DOCKER_ENV_DIR"
MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' docker run --rm \
  -e CSV_CLEANER_CLI_IN_CONTAINER=1 \
  -v "$DOCKER_TASK_DIR:/workspace/task" \
  -w /workspace/task \
  "$IMAGE_TAG" \
  bash tests/test.sh
