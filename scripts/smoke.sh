#!/usr/bin/env bash
# Compatibility entry point; the runner owns isolated processes and a disposable DB.
set -euo pipefail
exec node "$(dirname "$0")/smoke/run.mjs" "$@"
