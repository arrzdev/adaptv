#!/usr/bin/env bash
# Runs an e2e suite under a lock shared by every repo on the agent VM, so only
# one suite runs at a time (TUD-708). Usage: scripts/e2e-lock.sh <command...>
# A second suite waits up to E2E_LOCK_WAIT seconds (default 900), then exits 75.
# CI and machines without flock run the command directly.
set -euo pipefail

if [ -n "${CI:-}" ] || [ -n "${E2E_LOCK_DISABLE:-}" ] || ! command -v flock >/dev/null 2>&1; then
  exec "$@"
fi

lock="${E2E_LOCK_FILE:-$HOME/.locks/e2e.lock}"
wait="${E2E_LOCK_WAIT:-900}"
mkdir -p "$(dirname "$lock")"
exec 9>>"$lock"

if ! flock -n 9; then
  echo "e2e lock busy ($lock): another e2e suite runs on this machine. Waiting up to ${wait}s..." >&2
  if ! flock -w "$wait" 9; then
    echo "e2e lock busy after ${wait}s: run only unit/API checks now and run e2e in your next run (TUD-681)." >&2
    exit 75
  fi
fi

# The lock stays held by fd 9 until the command exits.
exec "$@"
