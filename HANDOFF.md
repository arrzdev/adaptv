# adaptv — development handoff

Start-here doc for continuing **adaptv** development in a fresh session. Read this + the linked docs and
you have full context. Last updated **2026-07-21**.

---

## 0. Read this first

**→ [`docs/DECISIONS.md`](docs/DECISIONS.md) is the entry point.** It is the decision register: what's
🔒 locked, 📐 designed, 🔀 conflicted, ❓ open — plus every doc-vs-code conflict, 26 recorded bugs and
findings, the positioning read, and the time-sensitive items. **If you read one file, read that one.**

Then, in order:

1. `docs/VISION.md` — north star, principles, the §3 problem catalogue (which is also the main risk).
2. `docs/ARCHITECTURE.md` — the cross-platform contracts. **§0 doctrine is the spine**, and principle
   **7 ("mechanisms live at the JS layer; platform config stays dumb")** is the newest and most
   cross-cutting.
3. `docs/RENDERING.md` — the isomorphism boundary + the full delivery/SW/offline model.
4. `docs/LIFECYCLE.md` — config → build → deploy → OTA → CLI.
5. `docs/COORDINATION.md` — app state, back chain, gestures, route lifecycle.
6. Reference as needed: `STYLING.md` · `FACADE.md` · `ANIMATION.md` · `NATIVE-SHELL.md` ·
   `PRIOR-ART.md` · `BEHAVIORS.md` · `TESTING.md` · `COOKBOOK.md` · `capacitor-internals.md`.

`RESEARCH.md` is now largely superseded — `PRIOR-ART.md` replaced its §4 stub with the actual Ionic
port list, and `DECISIONS.md` absorbed the rest.

---

## 1. What adaptv is (30 seconds)

A **cross-platform React framework**: write React (DOM/CSS), ship the same code as desktop web (SSR), an
installable PWA, and native iOS/Android (Capacitor) — correct on every target, no per-platform
babysitting. Capacitor is a thin seam; on top are correct-by-construction primitives and capability
hooks that pick browser/polyfill/native. *"Expo's ambition on Capacitor's mechanism,"* web-first.

- **Repo:** `arrzdev/adaptv` (private). Local: `~/Documents/Github/adaptv`.
- **Package:** `@arrzdev/adaptv`, single-package (repo root IS the framework).
- **Extracted from** chopchop's `packages/adaptv`.

> **⚠︎ `src/` is the chopchop lift, not a spec.** Most of it will be refactored for the standalone
> package. When a doc describes current code, it is describing *the starting point* — read the bug
> entries in `DECISIONS.md` as **patterns not to carry forward**, not as a defect backlog.
> **chopchop's `packages/adaptv` is now dead** — the standalone repo is strictly ahead (0 files missing,
> 88/110 byte-identical, standalone newer on 21 of the 22 that differ). Delete it when convenient.

---

## 2. Current state — GREEN

- **CI:** `install → typecheck → biome → vitest` on every push/PR. `pnpm typecheck` (0) ·
  `pnpm biome:check` (0) · `pnpm test` (**383 vitest**, 45 files).
- **Verified end-to-end against a real Vite 8 / Rolldown build**, not only in unit tests: the whole
  browser surface (every primitive, hook, capability, both storage tiers, the shell) bundles clean at
  **618 modules**, and the `createServerFn` ban fails that same build with exit 1.

### 2.1 Built in the 2026-07-20 implementation pass

**The headline: a consumer app's source tree is now free of framework artifacts.** Audited in
project-zero:

```
src/          no *.gen.*  ·  no sw.ts  ·  no @tanstack/react-router
.adaptv/       register.d.ts  root.gen.tsx  routeTree.gen.ts  router.gen.tsx  sw.gen.ts
```

A route file is `export const Route = createFileRoute({ … })` — no import at all.

| Area | What landed |
|---|---|
| **TanStack opacity** | Achieved via **two `pnpm patch`es** (L19): `start-plugin-core` (un-omit `verboseFileRoutes`; `moduleDeclaration` reads `ADAPTV_START_PKG`) and `router-generator` (`getTargetTemplate` reads `ADAPTV_ROUTER_PKG` — one lever for every import *and* `declare module` it emits). → `FACADE.md §2.6a–c` |
| **`.adaptv/`** | All five generated files hidden there. adaptv emits the `.gitignore` entry, the tsconfig `include`, and `register.d.ts` (ambient route factories — needed because the import now exists only at build time). |
| **Generated SW** | A normal app authors **no service worker**. adaptv generates it from `web.sw`. Escape hatch: write `src/sw.ts`. |
| **Generated shell** | `dist/client/index.html`, generated from config, never captured from a response. Unblocked `host: "static"` *and* the SSR precache fallback. |
| **`web` config block** | `render`/`host`/`sw` resolved once, shared via context. `render` defaults to **`"ssr"`**, resolving the doc-vs-code conflict. |
| **The wedge** | `createServerFn` ban — verified against a real Rolldown build, catches imports *and* `server:{handlers}`. |
| **Service worker** | Rebuilt per `RENDERING §3`; B1–B6, B25 fixed; `warm-routes` **deleted** (credentialed HTML into a URL-keyed cache). |
| **Coordination spine** | All four contracts. `Swipeable` migrated onto the gesture arbiter. |
| **Storage** | All three tiers. `store` on **raw IndexedDB, not Dexie** — every reason to want Dexie is out of the stated scope. |
| **Haptics** | Split into imperative + declarative (iOS 26.5 killed programmatic `<input switch>`). |

### 2.2 Corrections found by building rather than reasoning

Recorded because each was a confident wrong assumption:

- **The root route CAN live outside `routesDirectory`.** I had concluded it couldn't; the generator
  resolves the virtual root by path and accepts one that escapes the tree. That was the last framework
  artifact in the consumer's source.
- **Start emits no HTML at all**, even in SPA mode — so "copy Start's shell" was never a foundation.
- **Router entry *and* `generatedRouteTree` resolve relative to `src/`**, not the app root. A
  root-relative path does not error; the generator silently writes to `src/<path>`.
- **A checker that cannot read what it checks reports success.** Two patch-verification attempts passed
  silently (`ERR_PACKAGE_PATH_NOT_EXPORTED`, then `MODULE_NOT_FOUND` — the packages are transitive and
  unresolvable under pnpm's strict layout). The shipped guard asserts the *outcome* instead.
- **B8 was deeper than reported:** `cn` never declared `conflictingClassGroups`, so `locked` was inert
  **everywhere**, including in the two components that used `mergeStyles`.

### 2.3 Built in the 2026-07-21 native + PWA pass

**First real device run.** Drove the whole framework end-to-end on an **iOS simulator** and an **Android
emulator** via project-zero chopchop — the "no shipped app has run against it" gap in §4 item 2 is now
closed for iOS (renders, routes, styled, native plugin bridge live, safe areas correct, splash hands off
and self-dismisses).

| Area | What landed |
|---|---|
| **iOS native build** | `adaptv run ios` builds + launches on the simulator. The earlier Swift-compile wall (`CAPPluginCall has no member 'reject'`, +16 more) was **not** upstream/version — it was Capacitor's **SPM** path (the binary `capacitor-swift-pm` xcframework). Fix: the CLI forces **CocoaPods** (`cap add ios --packagemanager CocoaPods`), which builds every plugin from source against one `Capacitor` pod → BUILD SUCCEEDED. Also: peerDeps `^8` (not exact pins, which dual-installed core), `webDir: dist/client`, `cap add` auto-scaffold, platform check via `require.resolve`. `bin/adaptv.mjs`. |
| **SPA/native render** | The capacitor (and any `render:"spa"`) build white-screened with `Invariant failed`: Start's default client entry is `hydrateStart`, which hard-requires a `window.$_TSR` bootstrap that a **no-server SPA never has**. adaptv now ships its **own** client entry — `src/routes/client-entry.tsx`, a plain TanStack **Router** `hydrateRoot` — wired as Start's `client.entry` **for the `spa` target only** (web `ssr` keeps Start's entry). Also fixed the generated shell's `href="/"` stylesheet (manifest → assets-dir fallback in `shell-emit.ts`). |
| **Safe-area on native** | React strips the pre-paint `data-adaptv-platform` stamp when it reconciles `<html>` on the SPA client path, silently disabling every `app:` variant (visible symptom: content under the status bar; `env()` was fine). `applyPlatformStamp()` re-applies it from a layout effect. `src/utils/platform.ts`, `src/shell/shell-layout.tsx`. |

### 2.4 Investigated, NOT shipped (honest negatives)

- **Android standalone-PWA bottom nav bar is not web-controllable.** Measured objectively (adb screencap
  + pixel sampling): the **status bar** follows `theme-color` (adaptv's existing handling already does
  this — app dark → `#0a0a0c`, app light → `#eeeeec`), but the **bottom nav bar stays pure `rgb(0,0,0)`
  black regardless of app theme or OS**. `color-scheme` meta / manifest colours moved nothing. A
  `color-scheme` "fix" was tried and reverted — it's a platform limit for the standalone PWA, not a adaptv
  bug. The native Capacitor build controls both bars; the installed-PWA nav bar does not.
- **Emulator caveat that cost real time:** the preinstalled image was an **Android 17 preview + Chrome
  149 (dev build)** that ignores `theme-color`/`color-scheme` for standalone PWAs *entirely* and never
  mints a WebAPK. Stable **Chrome 124 (Android 15, AVD `stable35`)** honours `theme-color`. **Test PWA
  chrome on a stable Chrome, never a dev build.**
- **iOS device (not simulator)** and **Android on-device native bars** remain unverified.

## 3. How to develop

```bash
cd ~/Documents/Github/adaptv
pnpm install          # pnpm 11
pnpm typecheck && pnpm biome:check && pnpm test
```

- **pnpm-11 quirks already handled** (don't undo): `allowBuilds: esbuild: true` in
  `pnpm-workspace.yaml`; `verify-deps-before-run=false` in `.npmrc`.
- **Ships TypeScript source today.** The dist build is designed and settled — `tsdown`, **two builds**
  (`platform: 'browser'` for React, `platform: 'node'` for `/vite` + `/sw` + `/config`) →
  `DECISIONS.md §6.2`, which also lists four traps that bite this exact package shape.
- **Test against a real app** via `"@arrzdev/adaptv": "link:../adaptv"` (no playground by design).
- **chopchop IS wired as project-0**, at `.project-zero/chopchop` (gitignored; excluded from both
  `vitest.config.ts` and `biome.json` so its suites never enter the framework's gate).
  Its `@repo/adaptv` is a pnpm `overrides` link to this repo, and its vendored `packages/adaptv` is
  **deleted** (dead per L17). Rebuild it with:

  ```bash
  cd .project-zero/chopchop/apps/frontend && npx vite build
  ```

  **It builds green** — client 2584 modules, SSR 2624, and a real `sw.js` with 51 precache entries.
  Three consumer migrations were needed, and each is the intended path rather than a workaround:
  `Screen` → `<View fill>` (L5), and `registerIncrementalNavigationRoute` +
  `registerInstallRouteWarmer` → a single `registerNavigationRoute({ mode: "ssr" })`. The new SW file
  is roughly half the size of the old one — worth reading as the migration example.

---

## 4. ⏰ Do these first

**Items 3 and 4 of the previous list are DONE** (the four shipped-code fixes; the `createServerFn` ban).
What remains, in order:

1. **Android target API 36 by 2026-08-31** (~6 weeks). Edge-to-edge becomes unconditional — the opt-out
   is gone, and `setStatusBarColor`/`setNavigationBarColor` are dead. Status-bar tinting becomes purely
   a CSS problem. **Settle the safe-area contract before anything else**, and note Capacitor hard-gates
   on the viewport meta literally containing `viewport-fit=cover`. → `DECISIONS.md §6.0`.
2. **Wire chopchop as project-0.** ✅ **Done for iOS** (2026-07-21, §2.3): chopchop builds *and runs* on
   the iOS simulator — renders, routes, styled, native bridge live, safe areas correct. Still owed:
   the same run on **Android** (emulator has `adb`/`stable35` now) and on **real hardware**.
3. **Emit the SSR app shell + the static-host files.** `render:"ssr"` currently has **no artifact** for
   the precache fallback to bind to — TanStack Start emits `_shell.html` only in SPA mode — so the SSR
   offline path is designed and coded but cannot actually be exercised yet. Same task covers
   `index.html`/`404.html`/`.nojekyll`, without which `host:"static"` is not deployable. → `DECISIONS.md` B26.
4. **Redesign `@adaptv/shell` before building it.** Capacitor 8 ships `SystemBars` in core, registered
   unconditionally, already owning Android insets + IME. The original phase-1 plan would install a
   second inset listener on the same view hierarchy — that collision *is* keyboard bugs #61/#68.
   → `NATIVE-SHELL.md §0.0`.
5. **Migrate `Drawer`/`Swipeable`/edge-swipe onto the gesture controller.** The arbiter exists and is
   tested; no primitive requests capture from it yet, so they still arbitrate alone.

### 4.1 Owed device verification — cannot be closed by unit tests

| What | Why a test can't settle it |
|---|---|
| **iOS-web haptics** (`haptic-tick.ts`) | The 13 tests pin structure and lifecycle, which is all a DOM can prove. Whether the tick *fires* needs physical iOS ≥ 26.5 — simulators produce no haptics. |
| **`clickable` longhand** (B13) | Every engine except the broken one treats the shorthand and longhand identically; only a real iOS device shows the `pointercancel` difference. |
| **Gesture controller priorities** | The arbitration logic is proven; the *numbers* are a feel judgement on a real screen with a drawer, a swipeable row and a scroller together. |
| **`theme-color` / status-bar tint** (B17) | The iOS 26 behaviour is derived from the rendered background, so it is only observable on device. |

## 5. Decisions locked in (don't re-litigate)

**Foundational:** single-package repo · **no hard forks** of Capacitor/TanStack (own the seams, rent the
cores) · keep TanStack Start for its deploy adapters · **isomorphic-only** (no `createServerFn`) ·
always edge-to-edge · splash = solid colour mask natively, mascot only in the React splash.

**Resolved in the 2026-07-20 pass** — full reasoning in `DECISIONS.md`:

| Area | Decision |
|---|---|
| **Styling** | `className` + `data-*` state + `@layer`; **boolean** attributes (`data-drawer-open`), not `data-state="open"`; unprefixed CSS vars; `render` prop over `asChild`; tailwind-merge-aware merge as the **default**. No `--adaptv-*` palette. → `STYLING.md` |
| **`createServerFn` ban** | Unbypassable Vite `resolveId` hook (**backstop**) + a linter as the **primary DX surface** — a bundler error gives no editor squiggles. Safety and TanStack-opacity are **orthogonal**; opacity deferred. → `FACADE.md` |
| **Rendering** | `web.render` defaults to **`"ssr"`** (asymmetry: SPA silently kills SEO and is found late). SSR does **not** restrict route-chunk precaching. → `DECISIONS.md §6.3`, `RENDERING.md §3` |
| **Offline** | No `offline.html`, **no `/offline` route** — offline UI renders **in place** via a config-registered `offlineComponent`. → `RENDERING.md §3.0–3.1.2` |
| **SW** | Precache **all route chunks**, never credentialed documents; `precacheDocuments` allowlist for public pages only. `prompt` default, nav preload on. → `RENDERING.md §3.2` |
| **Animation** | Keep `motion`; CSS for enter/exit; **`transform`/`opacity` only** — the iOS 60Hz JS ceiling makes composited-only a *correctness* rule. Overlays are ordinary positioned elements, not the top layer. → `ANIMATION.md` |
| **OTA** | Self-hosted on the app's own deploy; **pointer-flip, never in-place**; minify but don't obfuscate; **signing is mandatory**; plugin = **`@capgo/capacitor-updater`** (Appflow is ruled out — Ionic killed commercial products Feb 2025). → `LIFECYCLE.md §5` |
| **Ionic port** | MIT, attribution convention settled (pinned-SHA permalink + a `Why:` line). Ranked port list. → `PRIOR-ART.md` |
| **Dist build** | `tsdown`, two builds, copy CSS rather than build it, pin TS 5.9.x. → `DECISIONS.md §6.2` |

---

## 6. Still open

- **Biome vs oxlint** for the lint rules — oxlint delivers editor squiggles today but its JS plugins are
  alpha; Biome is conservative. Prototype both. → `FACADE.md §2.6b`.
- **Six-target CI** — can the native matrix run in CI, or stay local? → `VISION.md §9`.
- **TanStack opacity** (deferred, not dropped) — the 2026-07-05 spike evidence is recorded in
  `FACADE.md` so it isn't rediscovered a third time.
- **`storage.secure` backend** — `@capacitor/preferences` is **plaintext** and cannot hold tokens;
  `@aparajita/capacitor-secure-storage` is the maintained candidate. → `DECISIONS.md` B23.

---

## 7. Relationship to the app repos

- **chopchop was the gold source; it no longer is.** See the §1 note — the standalone repo is ahead.
- A cross-project unification (chopchop/veralens/escolhe) is separate and not blocking.
- Distribution: private GitHub Packages or a local `link:`. Consumers pin per project; a deploy builds
  from the lockfile, so **updates never auto-propagate**. Note `create-adaptv` is unclaimed on npm —
  publish the *scaffolder* publicly and keep the framework private, or the PAT chicken-and-egg bites.
  → `DECISIONS.md §5.0`.
