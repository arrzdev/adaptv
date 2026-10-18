#!/usr/bin/env bash
# Runs an e2e suite in one of `e2e_max` slots shared by every repo on the agent
# VM (TUD-708) and gives it free ports. Usage: scripts/e2e-lock.sh <command...>
#
# e2e_max comes from the company capacity.json (E2E_CAPACITY_FILE overrides the
# path); 1 when the file or the key is missing or unreadable. A suite that finds
# every slot busy waits up to E2E_LOCK_WAIT seconds (default 900), then exits 75.
#
# Outside CI every E2E_*_PORT in E2E_PORT_VARS that is not already set gets a
# distinct free port from the OS, so suites on one host never share a port. A
# port you set yourself is kept. Pair it with reuseExistingServer only when
# E2E_REUSE=1, or a suite can still test another checkout's server.
# CI and machines without flock run the command directly.
set -euo pipefail

if [ -n "${CI:-}" ] || [ -n "${E2E_LOCK_DISABLE:-}" ] || ! command -v flock >/dev/null 2>&1; then
  exec "$@"
fi

capacity="${E2E_CAPACITY_FILE:-$HOME/.paperclip/instances/default/companies/706e19a7-64b1-449c-b48c-83e389e03941/tools/capacity.json}"
slots=1
if [ -r "$capacity" ]; then
  n="$(sed -n 's/.*"e2e_max"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$capacity" 2>/dev/null | head -n1 || true)"
  if [ -n "$n" ] && [ "$n" -ge 1 ] 2>/dev/null; then slots="$n"; fi
fi

dir="${E2E_LOCK_DIR:-$HOME/.locks}"
wait="${E2E_LOCK_WAIT:-900}"
mkdir -p "$dir"

take_slot() {
  local i
  for i in $(seq 1 "$slots"); do
    exec 9>>"$dir/e2e-$i.lock"
    if flock -n 9; then
      E2E_SLOT="$i"
      return 0
    fi
  done
  return 1
}

if ! take_slot; then
  echo "e2e slots busy (all $slots in $dir): waiting up to ${wait}s..." >&2
  deadline=$((SECONDS + wait))
  until take_slot; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "e2e slots busy after ${wait}s: run only unit/API checks now and run e2e in your next run (TUD-681)." >&2
      exit 75
    fi
    sleep 2
  done
fi
export E2E_SLOT

all_vars="${E2E_PORT_VARS:-E2E_APP_PORT E2E_GAME_PORT E2E_API_PORT E2E_API_INSPECTOR_PORT E2E_APP_INSPECTOR_PORT E2E_STUB_PORT}"
unset_vars=""
for v in $all_vars; do
  if [ -z "${!v:-}" ]; then unset_vars="$unset_vars $v"; fi
done
if [ -n "$unset_vars" ]; then
  # One process holds every socket open at once, so the ports are distinct.
  while read -r v p; do export "$v=$p"; done < <(python3 -c '
import socket, sys
held = [(n, socket.socket()) for n in sys.argv[1:]]
for n, s in held:
    s.bind(("127.0.0.1", 0))
    print(n, s.getsockname()[1])
' $unset_vars)
fi

summary="slot $E2E_SLOT/$slots"
for v in $all_vars; do
  if [ -n "${!v:-}" ]; then summary="$summary $v=${!v}"; fi
done
echo "e2e-lock: $summary" >&2

# The slot stays held by fd 9 until the command exits.
exec "$@"
