#!/usr/bin/env bash
# The webkit smoke: what `create-adaptv` hands a developer, from the packed tarballs,
# launched in WebKit at an iPhone 15 size.
#
#   bash .github/webkit-smoke/smoke.sh <out-dir>      (or: pnpm smoke:webkit)
#
# Packs adaptv and create-adaptv, scaffolds an app OUTSIDE the checkout (so a dependency the
# tarball fails to declare fails the install or the build instead of resolving from the
# repo), installs the tarballs, builds, serves the production build and runs
# phone.smoke.ts. Steps and screenshots mirror .github/android-smoke/smoke.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="$(mkdir -p "${1:-$REPO/webkit-smoke-out}" && cd "${1:-$REPO/webkit-smoke-out}" && pwd)"
# A free port: a taken one would make vite hop to the next and the smoke would hit a stranger.
PORT="${SMOKE_PORT:-$(node -e 'const s=require("node:net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/webkit-smoke.XXXXXX")"
SERVER_PID=""

cleanup() {
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "pack"
(cd "$REPO" && pnpm build >/dev/null && pnpm pack --pack-destination "$WORK" >/dev/null)
(cd "$REPO/packages/create-adaptv" && pnpm pack --pack-destination "$WORK" >/dev/null)
ADAPTV_TGZ="$(ls "$WORK"/adaptv-[0-9]*.tgz)"
CREATE_TGZ="$(ls "$WORK"/create-adaptv-*.tgz)"

echo "scaffold"
mkdir "$WORK/create"
tar -xzf "$CREATE_TGZ" -C "$WORK/create"
APP="$WORK/app"
node --input-type=module -e '
  const { create } = await import(process.argv[1])
  create({ dir: process.argv[2], name: "smoke-app", adaptv: `file:${process.argv[3]}` })
' "$WORK/create/package/create.mjs" "$APP" "$ADAPTV_TGZ"

# The scaffold's home has nothing to navigate to or type into, so the smoke's routes replace
# its routing. Everything else is the app as scaffolded.
rm -rf "$APP/src/routing"
cp -R "$HERE/routing" "$APP/src/routing"

echo "install"
(cd "$APP" && CI= pnpm install --no-frozen-lockfile)

echo "build"
(cd "$APP" && pnpm build)

echo "serve"
(cd "$APP" && pnpm preview -- --port "$PORT" --strictPort --host 127.0.0.1 >"$OUT/preview.log" 2>&1) &
SERVER_PID=$!
for _ in $(seq 60); do
  curl -sf "http://127.0.0.1:$PORT/" >/dev/null && break
  sleep 1
done
curl -sf "http://127.0.0.1:$PORT/" >/dev/null || { echo "::error::webkit smoke: the preview never answered"; cat "$OUT/preview.log"; exit 1; }

echo "playwright"
mkdir "$WORK/runner"
cp "$HERE/playwright.config.ts" "$HERE/phone.smoke.ts" "$WORK/runner/"
(cd "$WORK/runner" && pnpm init >/dev/null && CI= pnpm add -D --ignore-workspace @playwright/test@1.61.1 >/dev/null)
(cd "$WORK/runner" && SMOKE_PORT="$PORT" SMOKE_OUT="$OUT" pnpm exec playwright test) ||
  { echo "::error::webkit smoke failed"; exit 1; }

echo "webkit smoke passed"
