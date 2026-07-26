# Synq offline-first E2E

Drives **two isolated browser profiles** (= two devices) against one shared
backend with Playwright, proving the offline-first sync end-to-end: create
(via the real UI) → cross-device propagation → check → delete → reload
persistence → concurrent field-level merge → fresh-device pull.

It exercises the real data layer through `window.synqDebug` (the same
`@/data/todos/mutations` the UI buttons call; see `src/data/sync-debug.ts`) and
asserts on the real rendered DOM + the stitched IndexedDB state.

## Run (uses ports that don't collide with `pnpm dev`)

From the repo root:

```bash
# 1. isolated local D1 + migrations
cd apps/backend
./node_modules/.bin/wrangler d1 migrations apply app-backend-db --local --persist-to .wrangler-e2e
./node_modules/.bin/wrangler dev --port 8281 --inspector-port 9319 --persist-to .wrangler-e2e &

# 2. build the frontend pointed at that backend (inspector off to dodge 9220)
cd ../frontend
VITE_BACKEND_URL=http://localhost:8281 pnpm build   # temporarily set inspectorPort:false if 9220 is busy

# 3. serve the build + run the two-profile suite
node e2e/static-server.mjs 7373 &
npx playwright install chromium   # first time only
APP_URL=http://localhost:7373/ node e2e/sync.e2e.mjs
```

Expected: `RESULT: 13 passed, 0 failed`.

> Playwright is intentionally **not** a package dependency — install it ad-hoc
> with `npx playwright install chromium`. The `window.synqDebug` hook is a
> browser-only debug surface; gate it behind a flag before shipping to real
> users with auth.
