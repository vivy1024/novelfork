#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

python "$SCRIPT_DIR/cleaner.py" \
  --input "$TASK_DIR/environment/dirty_data.csv" \
  --output "$TASK_DIR/cleaned_data.csv"
