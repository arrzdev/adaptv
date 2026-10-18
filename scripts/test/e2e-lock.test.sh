#!/usr/bin/env bash
# Tests scripts/e2e-lock.sh: slots from capacity.json and distinct free ports.
# Run: bash scripts/test/e2e-lock.test.sh
set -euo pipefail

lock="$(cd "$(dirname "$0")/.." && pwd)/e2e-lock.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
export E2E_LOCK_DIR="$tmp/locks" E2E_CAPACITY_FILE="$tmp/capacity.json"
unset CI E2E_LOCK_DISABLE E2E_APP_PORT E2E_GAME_PORT E2E_API_PORT E2E_API_INSPECTOR_PORT E2E_APP_INSPECTOR_PORT E2E_STUB_PORT

fail() { echo "FAIL: $*" >&2; exit 1; }

# 1. e2e_max 2: two suites run at once, the third waits and gives up (75).
echo '{"e2e_max": 2, "run_cap": 6}' >"$E2E_CAPACITY_FILE"
for i in 1 2; do
  E2E_LOCK_WAIT=0 bash "$lock" bash -c 'echo "$E2E_SLOT $E2E_APP_PORT $E2E_API_PORT $E2E_API_INSPECTOR_PORT $E2E_STUB_PORT $E2E_GAME_PORT $E2E_APP_INSPECTOR_PORT"; sleep 4' >"$tmp/out$i" 2>/dev/null &
  sleep 0.5
done
rc=0
E2E_LOCK_WAIT=1 bash "$lock" true 2>/dev/null || rc=$?
[ "$rc" = 75 ] || fail "third suite should exit 75 with e2e_max 2, got $rc"
wait
[ "$(cut -d' ' -f1 "$tmp/out1")" != "$(cut -d' ' -f1 "$tmp/out2")" ] || fail "two suites got the same slot"

# 2. Every port is distinct inside a suite and across the two suites.
ports="$(cat "$tmp/out1" "$tmp/out2" | tr ' ' '\n' | awk 'NR%7!=1')"
[ "$(echo "$ports" | wc -l)" = 12 ] || fail "expected 12 ports"
[ "$(echo "$ports" | sort -u | wc -l)" = 12 ] || fail "ports are not distinct: $ports"

# 3. A port the caller set is kept.
got="$(E2E_API_PORT=8181 bash "$lock" bash -c 'echo $E2E_API_PORT' 2>/dev/null)"
[ "$got" = 8181 ] || fail "caller's E2E_API_PORT was overwritten: $got"

# 4. Missing, unreadable or bad capacity.json means 1 slot.
for content in "" "not json" '{"e2e_max": 0}'; do
  echo "$content" >"$E2E_CAPACITY_FILE"
  bash "$lock" sleep 3 2>/dev/null &
  sleep 0.5
  rc=0
  E2E_LOCK_WAIT=1 bash "$lock" true 2>/dev/null || rc=$?
  [ "$rc" = 75 ] || fail "capacity '$content' should mean 1 slot, got rc $rc"
  wait
done
rm -f "$E2E_CAPACITY_FILE"
bash "$lock" sleep 3 2>/dev/null &
sleep 0.5
rc=0
E2E_LOCK_WAIT=1 bash "$lock" true 2>/dev/null || rc=$?
[ "$rc" = 75 ] || fail "missing capacity.json should mean 1 slot, got rc $rc"
wait

# 5. CI runs the command directly: no slot, no ports.
got="$(CI=1 bash "$lock" bash -c 'echo "${E2E_SLOT:-none}-${E2E_API_PORT:-none}"')"
[ "$got" = none-none ] || fail "CI should not set slot or ports: $got"

echo "PASS e2e-lock"
