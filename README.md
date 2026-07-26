# adaptv

**One React codebase → desktop web, an installable PWA, and native iOS/Android — correct on every target, no per-platform babysitting.**

adaptv is a cross-platform React framework. You write ordinary React (DOM/CSS), and adaptv makes it
behave like a native app on six runtimes: desktop browser, mobile browser (iOS/Android), installed PWA
(iOS/Android), and a native Capacitor build (iOS/Android). Native capability comes through **Capacitor
as a thin seam**; on top sit **primitives that are correct-by-construction** — a `View` that can't
scroll wrong, a splash that follows the app theme, capability hooks that transparently pick
browser / polyfill / native.

> **It's Expo's ambition on Capacitor's mechanism — and, unlike Expo, the web is the _primary_ target,
> not a bolt-on.** Closest existing thing is Ionic; adaptv beats it on correctness and developer joy by
> being opinionated end-to-end.

This is a **private, personal framework** (extracted from the `chopchop` app, where it lived as
`@repo/adaptv`). Not public — yet, maybe ever.

🧭 **Continuing development?** Start with [`HANDOFF.md`](HANDOFF.md) — current state, how to develop, roadmap, and locked-in decisions.

🧭 **Start with [`docs/DECISIONS.md`](docs/DECISIONS.md)** — the decision register (🔒 locked / 📐 designed /
🔀 conflicted / ❓ open), every doc-vs-code conflict, the recorded bugs, and the time-sensitive items.

📖 **Read these first:** [`docs/VISION.md`](docs/VISION.md) (the north star + doctrine) ·
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (the cross-platform contracts: shell/frame/`View`,
storage, TanStack opacity) · [`docs/LIFECYCLE.md`](docs/LIFECYCLE.md) (config → build → deploy → native
→ OTA, the Vite-plugin decision model + CLI) · [`docs/COORDINATION.md`](docs/COORDINATION.md) (the runtime
app lifecycle: app state/resume, back chain, gesture controller, route lifecycle) ·
[`docs/RENDERING.md`](docs/RENDERING.md)
(rendering/delivery + the hard `createServerFn` limit) · [`docs/BEHAVIORS.md`](docs/BEHAVIORS.md) (what
adaptv fixes, how, and how to test each) · [`docs/TESTING.md`](docs/TESTING.md) ·
[`docs/capacitor-internals.md`](docs/capacitor-internals.md).

⌨️ **Changing the CLI?** [`docs/CLI-UX.md`](docs/CLI-UX.md) is the **output contract** — read it
before touching `bin/`. Every rule there exists because the output broke it once; the test suite
can't catch any of them, so the manual checklist at the end is the gate.

**Reference:** [`STYLING.md`](docs/STYLING.md) (how consumers restyle primitives) ·
[`FACADE.md`](docs/FACADE.md) (the `createServerFn` ban) · [`ANIMATION.md`](docs/ANIMATION.md) (the
motion substrate + the iOS 60Hz ceiling) · [`PRIOR-ART.md`](docs/PRIOR-ART.md) (what we port from Ionic,
and the attribution convention) · [`COOKBOOK.md`](docs/COOKBOOK.md) (consumer recipes — offline UI, auth
guards, offline-first data).

---

## The one boundary that makes it work

A single codebase runs on all targets **only because adaptv code is isomorphic**:

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
pnpm add @arrzdev/adaptv

# ...or during framework dev, link the local checkout instead:
#    "@arrzdev/adaptv": "link:../adaptv"   in the app's package.json
```

```ts
import { useTheme } from "@arrzdev/adaptv/hooks"
import { View, Button } from "@arrzdev/adaptv/components"
import { adaptv } from "@arrzdev/adaptv/vite"
import { defineApp } from "@arrzdev/adaptv/config"
```

Subpath exports: `/shell` `/router` `/route-globals` `/config` `/components` `/hooks` `/capabilities`
`/storage` `/ota` `/routes` `/utils` `/sw` `/vite` `/styles.css`.

### The CLI

```bash
adaptv doctor                          # check the native toolchain (JDK, SDK, Xcode, pod)
adaptv dev     web|ios|android|all     # live reload: one Vite dev server, native WebViews attached
adaptv preview ios|android|all         # build SPA → sync → install → launch (static, no reload)
adaptv build   ios|android|all         # build SPA → sync → produce the .ipa / .apk

# dev / preview flags
#   --target <id>   launch on a specific device/simulator id (skips the picker)
#   --latest        reuse the last device you picked for this platform
#   --host [ip]     (dev) serve on the LAN IP for a PHYSICAL device — auto when the target is
#                   a real device; pass an ip to pin it
#   --force         reinstall even when nothing native changed (otherwise dev/preview skip the
#                   rebuild and just relaunch the installed app)
#   -- <vite args>  (dev) forwarded to the Vite dev server (e.g. `-- --port 4000`)
# build flags
#   --output <path> where to write the artifact (default: .adaptv/builds/)
#   --force         rebuild even when unchanged (the web build + sync are cached)
# all commands
#   --verbose       show the full underlying tool logs (raw passthrough)
```

`dev` and `preview` show a branded device picker (arrow keys) and **remember your choice per platform**
in `.adaptv/state.json`, so the next `adaptv dev ios --latest` skips straight to the same device (shown
as a `· latest` tag on the launch line). The `all` target drives both platforms **in parallel** with a
clean two-column progress board; the inner cap/gradle/xcode/pod logs are captured and only surfaced on
failure (or with `--verbose`).

**Build cache** — a source fingerprint lets a re-run **skip the web build
and sync** when nothing that affects the bundle changed (`✓ web build · cached`), so an unchanged
`preview`/`build` goes almost straight to launch. `--force` rebuilds unconditionally.

Everything the CLI remembers between runs — that fingerprint, what is already synced/installed, your
device picks — lives in the single git-ignored **`.adaptv/state.json`**. Deleting it costs one rebuild
and one picker prompt, nothing else.

The CLI owns the native toolchain env and **owns the native project templates** (it patches
`MainActivity` / `AppDelegate` / launch storyboard / colour resources) so the consumer never touches
a Capacitor config. The native projects live inside the hidden, git-ignored **`.adaptv/`** dir
(`.adaptv/ios`, `.adaptv/android`) — regenerated artifacts, like `dist/`, not app source.

> `adaptv dev web` runs the Vite dev server on its own (no native WebView); web *deploy* stays your
> host's tool.

---

## Status — what's done vs not

### ✅ Working (transported from chopchop, verified on both simulators)

- **Platform foundation** — `isNativePlatform` / `isInstalledApp` / `getOS`, pre-paint
  `data-adaptv-platform` + `data-adaptv-os` stamp, `app:` / `web:` style variants (a native WebView lies
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
- **Config** — flat `adaptv.config.ts` (`appId`, `appName`, splash options, and a first-class `web`
  deployment block — `render` `"spa"`/`"ssr"`, `host` `cloudflare`/`vercel`/`node`/`static`, `sw`)
  generates the Capacitor config, the web manifest, and the native projects.
- **Build switch** — Vite plugin: web = SSR + service worker; capacitor = static SPA, no SW.
- **Native build** — Capacitor iOS + Android, debug `.apk` + unsigned `.ipa`.
- **Primitives** — `View`, `List` (virtualized), `Button` (press physics + haptics), `Link`
  (internal/external split), `ExternalLink`, `ScrollView`, `Image`, `Swipeable`, `PullToRefresh`,
  `Drawer`/`Sheet`, `Input`, `TextArea`, `Checkbox`, `Switch`, `WheelColumn`, and `AvoidKeyboard`
  (hybrid native+web keyboard avoidance — the autofocus race is fixed by eager listener attach).
- **Router facade** — a curated re-export of TanStack Router from `adaptv/router` (no `export *`, no
  server-only APIs); generated `*.gen` files live under `.adaptv/`, so apps import `adaptv`, not
  `@tanstack/*`.
- **Storage** — the three-tier `adaptv/storage` namespace (`local` / `secure` / `preferences`),
  platform-correct across web and native.
- **OTA** — self-hosted, pointer-flip bundle swaps via `adaptv/ota` (pure, testable policy + updater).
- **Live reload** — `adaptv dev` runs one Vite dev server with the native WebViews attached and
  hot-reloading on save, including over the LAN to a physical device (`--host`).

> **The seed is green:** `pnpm typecheck` (0), `pnpm test` (515/515), `pnpm biome:check` (0). CI runs all
> three on every PR.

### 🚧 Not done yet (see [`docs/BEHAVIORS.md`](docs/BEHAVIORS.md) §status + [`docs/RESEARCH.md`](docs/RESEARCH.md))

- **First-party `@adaptv/shell` Capacitor plugin** — collapse edge-to-edge + splash + status/nav bar +
  theme into one native module we own (instead of composing community plugins + CLI patches); owns the
  Android-15/SDK-35 inset+keyboard fix. **Designed:** [`docs/NATIVE-SHELL.md`](docs/NATIVE-SHELL.md).
- **`create-adaptv`** — `pnpm create adaptv` scaffolder. **Designed:** [`docs/LIFECYCLE.md`](docs/LIFECYCLE.md) §8.
- **Published build** — currently ships **TypeScript source** (works via local link / bundler compile).
  For real GitHub Packages publishing, add a `dist` build (tsup/unbuild) + `.d.ts`.
- **Primitive breadth** — `Text` / `Modal` / `Tabs` polish.

---

## Repo layout

```
src/            framework: shell · components · capabilities · config · hooks · routes · storage · ota · native · vite plugin · sw
  interface/    the public export barrels (map to package.json "exports")
bin/adaptv.mjs   the CLI (self-contained Node ESM; owns the native toolchain + templates)
  lib/          CLI internals: dev-server · devices · cache · build · doctor · privacy-manifest
playground/     a real app (chopchop) vendored for dogfooding — see docs/DEVELOPMENT.md
docs/           VISION · ARCHITECTURE · DECISIONS · LIFECYCLE · COORDINATION · NATIVE-SHELL · RENDERING · BEHAVIORS ·
                TESTING · RESEARCH · STYLING · FACADE · ANIMATION · PRIOR-ART · COOKBOOK · VS-IONIC · capacitor-internals
```

## Distribution & versioning

- **Now:** private GitHub Packages (`@arrzdev/adaptv`), or a local `link:` during framework dev. Pin per
  project; a deploy builds from the lockfile — **updates never propagate automatically** (bump +
  commit the lockfile in each project). See [`docs/RENDERING.md`](docs/RENDERING.md) / the versioning
  notes.
- **Consumers need** two `.npmrc` lines (`@arrzdev:registry=…` + the auth token) and a `GITHUB_TOKEN`
  with `read:packages`.

## Develop against a real app

`playground/` is a real app vendored into this repo — chopchop's `adaptv-testing` branch (React app
+ Cloudflare Workers API + D1), linked to its own checkout via `"@arrzdev/adaptv": "link:../../.."`.
Every worktree gets its own copy with the branch, so a framework change and the consumer change it
forces land in one commit. Drive it from the root of any checkout **or worktree**:

```bash
pnpm dev:web        pnpm preview:web        pnpm build:ios
pnpm dev:ios        pnpm preview:ios        pnpm build:android
pnpm dev:android    pnpm preview:android    pnpm build:all
pnpm dev:all        pnpm preview:all

pnpm adaptv doctor                     # ad-hoc passthrough to the CLI in the app
```

Full loop — fresh worktrees, ports, what the playground is (and is not):
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Verify

```bash
pnpm typecheck     # 0 errors
pnpm biome:check   # 0 errors
pnpm test          # vitest (happy-dom) — 515/515
```

All three are green today and gated in CI on every PR (`.github/workflows/ci.yml`).
