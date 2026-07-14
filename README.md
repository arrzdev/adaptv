# nativ

**One React codebase → desktop web, an installable PWA, and native iOS/Android — correct on every target, no per-platform babysitting.**

nativ is a cross-platform React framework. You write ordinary React (DOM/CSS), and nativ makes it
behave like a native app on six runtimes: desktop browser, mobile browser (iOS/Android), installed PWA
(iOS/Android), and a native Capacitor build (iOS/Android). Native capability comes through **Capacitor
as a thin seam**; on top sit **primitives that are correct-by-construction** — a `View` that can't
scroll wrong, a splash that follows the app theme, capability hooks that transparently pick
browser / polyfill / native.

> **It's Expo's ambition on Capacitor's mechanism — and, unlike Expo, the web is the _primary_ target,
> not a bolt-on.** Closest existing thing is Ionic; nativ beats it on correctness and developer joy by
> being opinionated end-to-end.

This is a **private, personal framework** (extracted from the `chopchop` app, where it lived as
`@repo/nativ`). Not public — yet, maybe ever.

🧭 **Continuing development?** Start with [`HANDOFF.md`](HANDOFF.md) — current state, how to develop, roadmap, and locked-in decisions.

📖 **Read these first:** [`docs/VISION.md`](docs/VISION.md) (the north star + doctrine) ·
[`docs/RENDERING.md`](docs/RENDERING.md) (rendering/delivery + the hard `createServerFn` limit) ·
[`docs/BEHAVIORS.md`](docs/BEHAVIORS.md) (what nativ fixes, how, and how to test each) ·
[`docs/TESTING.md`](docs/TESTING.md) · [`docs/capacitor-internals.md`](docs/capacitor-internals.md).

---

## The one boundary that makes it work

A single codebase runs on all targets **only because nativ code is isomorphic**:

- ✅ **`loader` / `beforeLoad`** are Router features, not SSR — they run on the server for SSR's first
  paint and in the browser everywhere else. Use them freely.
- ❌ **`createServerFn`, server routes, server-only request/cookie reads** — these need the app's own
  server and die in a static Capacitor bundle.
- **Rule: don't ban loaders — ban server-only calls.** Data is consumer-wired (TanStack Query +
  IndexedDB persister, client-held token). Full model in [`docs/RENDERING.md`](docs/RENDERING.md).

---

## Quick start

```bash
# 1. auth to GitHub Packages (read:packages token in GITHUB_TOKEN)
#    the app's .npmrc needs:  @arrzdev:registry=https://npm.pkg.github.com
pnpm add @arrzdev/nativ

# ...or during framework dev, link the local checkout instead:
#    "@arrzdev/nativ": "link:../nativ"   in the app's package.json
```

```ts
import { useTheme } from "@arrzdev/nativ/hooks"
import { View, Button } from "@arrzdev/nativ/components"
import { nativ } from "@arrzdev/nativ/vite"
import { defineApp } from "@arrzdev/nativ/config"
```

Subpath exports: `/shell` `/config` `/components` `/hooks` `/capabilities` `/routes` `/utils` `/sw`
`/vite` `/styles.css`.

### The CLI

```bash
nativ doctor              # check the native toolchain (JDK, SDK, Xcode, pod)
nativ run ios|android     # build SPA → sync → launch on sim/emulator
nativ build ios|android   # produce the .ipa / .apk
nativ sync                # regenerate + sync both native projects
nativ assets              # brand launcher icons + native splash from ./assets
```

The CLI owns the native toolchain env and **owns the native project templates** (it patches
`MainActivity` / `AppDelegate` / launch storyboard / colour resources) so the consumer never touches
a Capacitor config.

---

## Status — what's done vs not

### ✅ Working (transported from chopchop, verified on both simulators)

- **Platform foundation** — `isNativePlatform` / `isInstalledApp` / `getOS`, pre-paint
  `data-nativ-platform` + `data-nativ-os` stamp, `app:` / `web:` style variants (a native WebView lies
  about `display-mode`, so nothing keys off it).
- **Shell** — root document, critical CSS, memory-history-when-installed (edge-swipe/back inert),
  edge-to-edge by default, safe-area utilities.
- **Capabilities** (browser / polyfill / native behind `isNativePlatform`) — haptics, keyboard,
  network, status bar, geolocation, Android hardware back, native theme mirror, splash, external-link
  browser.
- **Splash** — colour-driven mask (Android launch theme + `colors.xml`; iOS colour asset + solid launch
  storyboard). `splashMaskMode`: `preferences` (follows the app's `useTheme`) / `system` / `light` /
  `dark`. Self-unmounting React splash (returns `null` when ready), no double-splash, Android-12
  system-splash icon stripped, theme-aware on both platforms.
- **Config** — flat `nativ.config.ts` (`appId`, `splashScreen`, `splashScreenInBrowser`,
  `splashMaskMode`, `splashMask*Color`, …) generates the Capacitor config, the web manifest, and the
  native projects.
- **Build switch** — Vite plugin: web = SSR + service worker; capacitor = static SPA, no SW.
- **Native build** — Capacitor iOS + Android, debug `.apk` + unsigned `.ipa`.
- **Primitives** — `View`, `List` (virtualized), `Button` (press physics + haptics), `Link`
  (internal/external split), `ExternalLink`, `ScrollView`, `Image`, `Swipeable`, `PullToRefresh`,
  `Drawer`/`Sheet` (hybrid native+web keyboard avoidance — the autofocus race is fixed by eager
  listener attach).

> **The seed is green:** `pnpm typecheck` (0), `pnpm test` (180/180), `pnpm biome:check` (0). CI runs all
> three on every PR.

### 🚧 Not done yet (see [`docs/BEHAVIORS.md`](docs/BEHAVIORS.md) §status + [`docs/RESEARCH.md`](docs/RESEARCH.md))

- **`.nativ/` + re-export barrel** — apps still import `@tanstack/*` and see `*.gen` files. Plan: move
  generated files into a hidden `.nativ/` dir, re-export the router surface from `nativ` so apps import
  only `nativ`. (May need a small `pnpm patch` of `@tanstack/router-generator` for symbol recognition.)
- **First-party `@nativ/shell` Capacitor plugin** — collapse edge-to-edge + splash + status/nav bar +
  theme into one native module we own (instead of composing community plugins + CLI patches).
- **`create-nativ`** — `pnpm create nativ` scaffolder.
- **Deployment knob** — web SSR target presets (`cloudflare` / `vercel` / `node` / `static`); today the
  example hardcodes Cloudflare. Keep TanStack Start precisely for this deploy-anywhere flexibility.
- **Capacitor OTA** — live-update bundle swap (download → unpack → `serverBasePath` → apply next
  launch). Web/standalone OTA already falls out of the SW.
- **Published build** — currently ships **TypeScript source** (works via local link / bundler compile).
  For real GitHub Packages publishing, add a `dist` build (tsup/unbuild) + `.d.ts`.
- **Primitive breadth** — `Input` / `Text` / `Modal` / `Tabs` polish.

---

## Repo layout

```
src/            framework: shell · primitives (components) · capabilities · config · hooks · vite plugin · sw
  interface/    the public export barrels (map to package.json "exports")
bin/nativ.mjs   the CLI (self-contained Node ESM; owns the native toolchain + templates)
docs/           VISION · RENDERING · BEHAVIORS · TESTING · capacitor-internals
```

## Distribution & versioning

- **Now:** private GitHub Packages (`@arrzdev/nativ`), or a local `link:` during framework dev. Pin per
  project; a deploy builds from the lockfile — **updates never propagate automatically** (bump +
  commit the lockfile in each project). See [`docs/RENDERING.md`](docs/RENDERING.md) / the versioning
  notes.
- **Consumers need** two `.npmrc` lines (`@arrzdev:registry=…` + the auth token) and a `GITHUB_TOKEN`
  with `read:packages`.

## Develop against a real app

No playground — dogfood against a real app (e.g. `chopchop`) via a local dependency:

```jsonc
// in the app's package.json
"@arrzdev/nativ": "link:../nativ"
```

## Verify

```bash
pnpm typecheck     # 0 errors
pnpm biome:check   # 0 errors
pnpm test          # vitest (happy-dom) — 180/180
```

All three are green today and gated in CI on every PR (`.github/workflows/ci.yml`).
