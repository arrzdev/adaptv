# Testing adaptv across targets

> **Rewritten 2026-08-30.** The previous version was written 2026-07-30 and never re-run: it predated
> the package rename, the playground, and the CLI, so **every command in it would have failed** — a
> `pnpm dev` script that does not exist, `cap:ios`/`cap:android` filters that do not exist, an
> import from `@repo/adaptv/utils`, an app id from a different app, and a link to
> `.claude/skills/stack/capacitor.md`, which is not a file. Every command below was run or resolved
> against `package.json` on the date above.
>
> **The six-target discipline itself was never the problem** and is unchanged — it is the reason this
> doc exists.

adaptv ships one app to **six** runtime targets. A change to a shell, primitive, or capability is not
"done" until it behaves on all of them — they diverge exactly where the hard cross-platform bugs live
(safe-area, edge-to-edge, keyboard, gestures, splash, history/back).

## The six targets

| # | Target | How it renders | Iterate via |
|---|--------|----------------|-------------|
| 1 | **Desktop browser** | Chrome/Safari on the Mac | dev server, hot reload |
| 2 | **Mobile browser — iOS** | Safari in the iOS Simulator | dev server, hot reload |
| 3 | **Mobile browser — Android** | Chrome in the Android emulator | dev server, hot reload |
| 4 | **Standalone PWA — iOS** | Add-to-Home-Screen in the iOS sim | dev server; `pnpm preview:web` for the worker |
| 5 | **Standalone PWA — Android** | Add-to-Home-Screen in the emulator | dev server; `pnpm preview:web` for the worker |
| 6 | **Native — iOS `.ipa` & Android `.apk`** | Capacitor WebView | rebuild (`pnpm preview:ios` / `preview:android`) |

`app:` = installed (standalone **or** native) · `web:` = browser tab. Detect in JS with
`isNativePlatform()` / `isInstalledApp()` / `getOS()` from **`@arrzdev/adaptv/utils`** — never
`display-mode`, which a native WebView lies about.

---

## Running it

Every command runs **from the root of any checkout or worktree**. There is deliberately no bare
`pnpm dev`: the target is the most important word in the command, so it is never implicit.

```bash
pnpm dev:web        pnpm preview:web        pnpm build:ios
pnpm dev:ios        pnpm preview:ios        pnpm build:android
pnpm dev:android    pnpm preview:android    pnpm build:all
pnpm dev:all        pnpm preview:all

pnpm adaptv doctor      # ad-hoc passthrough to the CLI inside the playground app
```

- **`dev`** — live reload; one Vite dev server with the native WebViews attached.
- **`preview`** — the real build, delivered the way a user gets it. No live reload.
- **`build`** — the artifact: a deployable site, an unsigned `.ipa`, a debug `.apk`.

The playground serves on **its own port block** — app `41730`, with `41740` reserved beside it
(`playground/apps/frontend/ports.ts`). It is `--strictPort`, so a busy port fails loudly rather than
silently drifting. Worktrees collide here by design; move the app with `VITE_APP_PORT` — the one
override `vite.config.ts` reads — rather than killing a neighbour's session.

**Targets 2–5 from a simulator/emulator.** The iOS sim shares the host's loopback, so
`http://localhost:41730` works directly. The Android emulator's `localhost` is the *device*: either
browse `http://10.0.2.2:41730` or map the port once with `adb reverse tcp:41730 tcp:41730`. For 4 and
5, Add to Home Screen from that browser and launch the icon.

> ⚠︎ **adaptv's service worker does not run in dev; `pnpm preview:web` is where it runs.** By default
> the dev server's shell unregisters every service worker on the origin and deletes every cache
> (`src/shell/service-worker-shell.ts`). `ADAPTV_DEV_SW=1` swaps that for a worker built from the app's
> own `serviceWorkers` modules only (`src/vite/sw-dev.ts`), never adaptv's precache or navigation
> fallback. When a new worker takes over on `preview:web` is `serviceWorkerUpdate`'s call
> ([`../design/rendering.md`](../design/rendering.md) §3.4).

---

## Is the native bridge actually there?

With the app installed and running:

```bash
pnpm smoke:android        # add --target <serial> when more than one device is up
```

It asserts on-device that **every** `@capacitor/*` plugin adaptv depends on is registered natively.
Run it after any change to native project generation, and whenever a capability "works on iOS but not
Android" — that is exactly the shape of a plugin that never made it into the build.

**Do not substitute a hand check that `Device.getInfo()` works.** `Device` was the one plugin the
consumer app declared itself, so it kept working through the entire outage where the other twelve
were missing. `Capacitor.Plugins.Haptics` existing proves nothing either — that is the JS shim; only
the call rejects.

**Inspecting a running native app**

- **Android:** `adb -s emulator-5554 exec-out screencap -p > shot.png`; focused app via
  `adb shell dumpsys window | grep mCurrentFocus`; WebView via `chrome://inspect`.
- **iOS:** `xcrun simctl io booted screenshot shot.png`;
  `xcrun simctl launch booted dev.arrz.projectzero`; WebView via Safari ▸ Develop ▸ Simulator.

Version pins and native gotchas live in
[`../research/capacitor-internals.md`](../research/capacitor-internals.md) — currently
`@capacitor/core` **8.4.3**, `@capacitor/geolocation` **8.0.0**, CocoaPods rather than SPM on iOS.

---

## The automated suites

| Suite | Command | What it covers |
|---|---|---|
| **Unit** (vitest, happy-dom) | `pnpm test` | `src/**` and the CLI's `bin/lib/*.test.mjs` |
| **Typecheck** | `pnpm typecheck` | |
| **Lint** | `pnpm biome:check` · `pnpm biome:check:playground` | the playground is its own pnpm project, so the root check never reaches it — both are required |
| **Colour** | `node scripts/check-colour.mjs` | the CLI's live layer under a pty |
| **e2e** (Playwright) | `pnpm --dir playground test:e2e` | 37 specs in `playground/e2e/` |
| **e2e, service worker** | `pnpm --dir playground test:e2e:sw:all` | `playground/e2e-sw/` across five configs (default, spa, prompt, subpath, node server) |
| **The gate** | `pnpm gate` | lint, typecheck, unit and colour — **not** the Playwright suites, which take minutes where the gate takes seconds |

→ [`e2e.md`](e2e.md) for what the Playwright estate covers and how it is wired.

**CI runs the gate and the main browser suite** on every PR and on pushes to `main`
(`.github/workflows/ci.yml`): typecheck, biome, biome:playground, vitest, the colour check, and
`test:e2e` on the **chromium** project only. Each step runs even if a prior one failed, so the summary
reports all failures at once. The main suite's **webkit** project and all four service-worker configs
run only where someone runs them — why chromium alone is recorded as answered
([`../roadmap/open-questions.md`](../roadmap/open-questions.md), **O11a**). Whether the native matrix
can run in CI at all is still open (**O11b**).

---

## Coverage

`pnpm test:coverage` runs the unit suite with V8 coverage over `src/**` and `bin/**`, prints a
summary, and writes `coverage/index.html` and `coverage/coverage-summary.json` (gitignored). It is a
map, not a gate: there are **no thresholds**, and neither `pnpm gate` nor CI runs it. Code a test
only reaches through a spawned child process is not counted.

---

## What to check per target (the divergence checklist)

| Concern | Where it breaks |
|---------|-----------------|
| Safe-area / notch / home-indicator | standalone + native (env insets differ; a `web:` tab has none) |
| Edge-to-edge (content under status/nav bar) | native only; a PWA cannot |
| On-screen keyboard push / avoidance | native (`@capacitor/keyboard`) vs web (`visualViewport`) — **the biggest divergence** |
| Splash | native shows the custom one; Android-PWA shows the OS one; a browser shows none |
| Back / history | native hardware-back + memory history vs browser back |
| Gestures (press, swipe, edge-swipe) | touch vs pointer vs native gesture |
| Browser chrome tint | Android Chrome tints its toolbar; iOS ≤ 18 tints the status bar; **iOS 26 ignores the meta tag and reads the painted page edge** |

## Definition of done for an adaptv change

1. **Web-safe:** `pnpm typecheck`, `pnpm biome:check`, `pnpm biome:check:playground`, `pnpm test` all
   green — or just `pnpm gate`.
2. **Verified on the targets the change touches, and their two neighbours.** A fix for the native
   keyboard must not regress the web `visualViewport` path.
3. **Capability changes:** confirm the accessor's web fallback *and* the native branch behind
   `isNativePlatform()`.
4. **If no automated target can reach it**, say so and add it to
   [`../roadmap/owed-device-verification.md`](../roadmap/owed-device-verification.md) rather than
   letting a happy-dom test stand in for a device.

Building a layout-reactive component with nobody watching the screen has its own method:
[`autonomous-ui-testing.md`](autonomous-ui-testing.md).
