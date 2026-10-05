# adaptv — the framework lifecycle

> How a adaptv app goes from **one config + one codebase** to **six running targets** and stays updated:
> configure → develop → build → deploy (SSR+SW / SPA per target) → native APK/IPA → over-the-air updates.
> The Vite plugin's decision model, the CLI surface, and the seams that keep it all driven by one file.
>
> Doctrine + design. Each section states the **model**, what **already holds** in the code today, and the
> **delta** to close (⚠︎ = not built yet, designed here). Pairs with `docs/design/rendering.md` (the isomorphism
> boundary), `docs/design/architecture.md` (the contracts), and `../decisions/prior-art.md` (OTA/Ionic prior art). Started
> **2026-07-14**.

---

## 0. The shape of the lifecycle

One `adaptv.config.ts` + one React codebase fan out into **two build lineages** that never cross:

```
                          adaptv.config.ts  (single source of truth)
                                   │
          ┌────────────────────────┴───────────────────────────┐
          ▼                                                     ▼
   WEB lineage  (vite build)                        NATIVE lineage  (adaptv CLI)
   target = "web"                                   target = "capacitor"
   render = ssr | spa   · SW on/off                 render = spa (forced) · SW off (forced)
   → .output/ (ssr) · dist/client (spa)             → .adaptv/web  (static SPA shell)
          │                                                     │
   deploy to a host (CF/Vercel/Node) or static      cap sync → android/ · ios/  →  APK / IPA
          │                                                     │
   SW revalidate = free OTA for web/PWA             adaptv OTA = bundle-swap of .adaptv/web  ⚠︎
```

The two lineages share **everything above the build** (routes, components, capabilities, the shell) and
**nothing below it**. The native SPA (`.adaptv/web`) is produced **only** by the CLI and is **never**
emitted by a plain `vite build` — so a web deploy can't accidentally build or ship the Capacitor bundle
(this separation already holds: `.adaptv/web` and the generated Capacitor config materialize only under
`ADAPTV_TARGET=capacitor`).

The five stages: **1. Configure · 2. Develop · 3. Build · 4. Deploy · 5. Update.**

---

## 1. Configure — `adaptv.config.ts` is the only knob surface

Everything downstream is derived from `defineApp({...})`. The consumer never hand-writes
`capacitor.config`, a web manifest, a TanStack Start config, a service worker registration, or a native
project setting — adaptv generates each from this file (doctrine §1: configure *intent*, not mechanism).

Both readers (the Vite plugin's `loadAppConfig`, the CLI's `loadConfig`) bundle it with esbuild to a
`data:` URL with **dynamic imports left external**, so the screen thunks (`splashScreen: () =>
import(...)`) never execute at build time — adaptv reads their specifier and emits a static import in the
generated root. One file, two consumers, identical data.

### 1.1 What drives the lifecycle (today)

| Field | Drives |
|---|---|
| `render: "spa" \| "ssr"` | web render mode (see §3). **Top-level** — the `router.render` this row used to name is gone (see the note below, and §1.2) |
| `serviceWorkers?: string[]` | the APP's own worker modules, run inside adaptv's. adaptv's worker itself is not configurable (`docs/design/rendering.md §3`) |
| `appId?: string` | **presence enables the native lineage**; absence = web-only (§6) |
| `styles`, `themeColor`, `icons`, `orientation`, `splashScreen`, `splashMaskMode`, `patches`, … | manifest, head, splash, native project, WebKit fixes |

> ### ✅ BUILT (2026-07-20) — the web build settings resolve once
>
> `src/config/web-config.ts` resolves them once in `adaptv()` and shares them via `AdaptvContext`, so
> `render` and the SW settings cannot drift between the router wiring, the manifest and the SW build.
>
> - **The render mode now defaults to `"ssr"`**, resolving the doc-vs-code conflict (`docs/decisions/register.md §3.3`):
>   the legacy `router.render` defaulted to `"spa"` while the docs said `"ssr"`. Both legacy fields are
>   since **deleted** — adaptv is pre-release and carries no compatibility shims — and the key was renamed
>   from `web.render` to a top-level `render` on 2026-08-09.
> - **`target: "capacitor"` is an override, not a default** (L12) — SPA + no SW, unconditionally.
> - **`adaptvStaticHostPlugin`** emits `index.html`, `404.html`, `.nojekyll` and `_redirects`
>   (`docs/decisions/register.md` B26). It gates on the **`ssr` environment**, because `closeBundle` fires once per
>   environment and the client build finishes first — running then looks for a shell that has not been
>   written yet and fails with a misleading error.
>
> **The static path was blocked on a shell, and the reason corrected an assumption in this doc.**
> Measured in project-zero: with `spa: { enabled: true }` and the Cloudflare adapter, **Start emitted no
> HTML at all** — no `_shell.html`, no `index.html`. So "copy Start's shell" is not a foundation adaptv
> can stand on, and `docs/design/rendering.md §3.1.2`'s requirement that adaptv **generate** its own user-agnostic
> shell is load-bearing rather than belt-and-braces. The same missing shell is why the SSR precache
> fallback was binding to an `/index.html` that did not exist — one gap, two symptoms.
>
> ✅ **Resolved (2026-07-20):** `adaptvShellEmitPlugin` generates the shell instead of copying one, which
> unblocked both. → `docs/design/rendering.md §3.1.2`

### 1.2 ✅ BUILT — one deploy key, and it is `render`

The deploy shape is expressed as intent, and it turned out to need exactly one key. `router.render` is
gone, and so is the `web` block that briefly replaced it — see `docs/decisions/rendering-and-delivery.md §2`. The deploy *target*
(Cloudflare, Vercel, a bucket) is named in the consumer's `vite.config.ts`, which is where TanStack
Start puts it and where the platform's own tooling expects to find it:

```ts
export default defineApp({
  // Screen thunks — statically imported by the plugin, NOT lazy chunks (§3.3, docs/design/rendering.md §3.1.2)
  splashScreen:     () => import("@/components/splash-screen"),
  offlineComponent: () => import("@/components/offline"),
  bootErrorScreen:  () => import("@/components/boot-error"),

  // How the WEB build renders. Top-level, because it decides what a deploy needs:
  // "ssr" wants something that runs per request, "spa" runs anywhere you can put files.
  render: "ssr",                     // "ssr" (DEFAULT — see docs/decisions/rendering-and-delivery.md §1) | "spa"

  // NO `web` block, and NO `host`. The worker is core behaviour, identical on every
  // host: always registered, always precaches every route chunk, always updates at
  // the next cold launch (→ docs/design/rendering.md §3). And the deploy target lives in
  // vite.config.ts, not here (→ docs/decisions/rendering-and-delivery.md §2).

  // Your OWN worker modules, run inside adaptv's, after its setup.
  serviceWorkers: ["./src/sw/push.ts"],
  appId: "com.acme.app",                // omit → web-only (§6)
  origin: "https://acme.app",           // where installs look for OTA updates (§5) — omit → no OTA
  otaPublicKey: "…",                    // from `adaptv keys ota` — verifies the channel (ota.md §5.4d)
})
```

- **`render` is TOP-LEVEL**, not `web.render` (renamed 2026-08-09). It is the one key that decides what a
  deploy even needs — a running server for `"ssr"`, any bucket of files for `"spa"` — so it does not
  belong under `web`, where it read like a tuning knob. It defaults to **`"ssr"`**, settled in
  `docs/decisions/rendering-and-delivery.md §1` on the asymmetry argument (defaulting to SPA silently kills SEO and is discovered
  late; defaulting to SSR costs a config flip). `web` itself was **deleted** on 2026-08-10 once `host`
  went with it (`../decisions/rendering-and-delivery.md §2`) — the block had nothing left in it.
- **`offlineComponent`** mirrors `splashScreen` exactly: one consumer-owned component with optional
  props, rendered by **adaptv** when the app can't boot far enough for a route to exist, and by the
  **consumer** when a mounted route's data is unavailable. → `docs/design/rendering.md §3.1.2`.
- **`bootErrorScreen`** is the same shape once more, but for the app that **never booted** — a broken or
  missing entry chunk, where React never runs. It is the one thunk consumed at *build* time rather than
  in the bundle: prerendered with `react-dom/server` and embedded in the emitted document, since anything
  shipped in the bundle is gone in exactly the case it exists for. Runtime errors are deliberately **not**
  covered — a route that throws is the app's own boundary to catch, and adaptv installs none so it cannot
  pre-empt one. → `docs/design/rendering.md §3.1.3`, `docs/decisions/register.md B30`/`B31`.
- **The service worker takes no config.** Route *chunks* are always precached — that is what makes
  navigation instant, and it is the product rather than a feature of it. No route document is ever
  precached (only the generated shell). → `docs/design/rendering.md §3.2`
- **There is no `host` key and no deploy plugin to add.** Start selects a target by which Vite plugin is
  present; adaptv adds that plugin itself (`nitro/vite`, pinned), so the target is auto-detected on eight
  providers and comes from `NITRO_PRESET` everywhere else. An adaptv enum on top of that would be a
  narrower duplicate of a thing that already works. → `docs/decisions/rendering-and-delivery.md §2`
- `appId` presence is the **native opt-in/opt-out** switch (§6). `origin` presence turns §5 on for an
  app with an `appId`; `adaptv build web` then publishes only with `otaPublicKey` set and its private
  half in the env (`ota.md §5.4d`).

---

## 2. Develop — `adaptv dev`

### 2.1 Web / PWA dev (today)

`vite dev` (through the `adaptv()` plugin) runs the app with HMR. The plugin's `configureServer` watcher
re-loads `adaptv.config.ts` (and any module it imports) on change and full-reloads. Standalone-PWA and
mobile-browser dev = the same dev server opened on a phone / simulator over the LAN.

A save that does not load (a syntax error, or a value `appConfigErrors` refuses) does not end the dev
server: every error goes to Vite's log (shown by `adaptv dev` under `--verbose`) and to Vite's error
overlay on the page, and the server keeps the config that last loaded until a save loads. This is the
watcher, which fires on every save of a half-typed file, the way Vite keeps its running server when an
edited `vite.config.ts` fails. It is not the CLI's `b` rebuild, which still ends the run on an unusable
config (`cli-contract.md` R39).

### 2.2 ⚠︎ Delta — `adaptv dev` as the unified entry, with device live-reload

`adaptv dev <surface>` exists and is the documented entrypoint (`adaptv dev web|ios|android|all`). *(This line previously read "there is no `adaptv dev` command today" — corrected 2026-08-30 against `adaptv --help`.)*
**Recommended:**

```bash
adaptv dev                    # = vite dev (web/PWA HMR)
adaptv dev --host ios         # vite dev + cap run ios with server.url → the dev server (live-reload on device)
adaptv dev --host android     # same for Android
```

`--host` uses Capacitor's live-reload (`server.url` → the LAN dev-server URL) so a real device/emulator
renders the **live** app with HMR against the same server — the fast native inner loop, no rebuild per
change. Native-only code paths (`isNativePlatform()` branches, plugins) light up because it's the real
WebView, while JS edits hot-reload.

---

## 3. The Vite plugin — the deploy decision model

One `adaptv()` call in `vite.config.ts`. It is an **async plugin factory**: it loads the config first (so
Start is configured from it and the generated root/router exist before any hook), then returns the plugin
array (`adaptv()` + TanStack Start + React + manifest + SW-build + PWA-register virtuals).

### 3.1 The decision matrix (target × render × sw)

The single most important table in the lifecycle — how one codebase resolves to a delivery shape:

| `target` | `render` | → render | → service worker | → server? | Output dir |
|---|---|---|---|---|---|
| `web` | `ssr` | **SSR** | yes (adaptv-owned) | yes (server build) | `.output/` (server + public + `sw.js`) |
| `web` | `spa` | **SPA** prerender | yes (adaptv-owned) | no | `dist/client/` (static + `sw.js`) |
| `capacitor` | — *forced* — | **SPA** | **off** | no | `.adaptv/web/` |

The service-worker column has no third value on purpose: on web it is always on, and the target is the
only thing that can turn it off.

**The output column is load-bearing, and it was not always three different values.** The native lineage
used to write `dist/client` as well, and the two were kept apart *in time only* — the CLI runs a fresh
`ADAPTV_TARGET=capacitor` build before every `cap sync`. That is safe under `ssr` by accident, because
the server build relocates the web output to `.output/`. Under `spa` the two collided: the web build
wrote `dist/client` with a service worker, the native build emptied the same directory and wrote its own
without one, and `adaptv preview all` then served the WebView bundle on the web surface. Silently — the
two `index.html` files are byte-identical and only the hashed chunks differ. They are separate in
**space** now (`src/vite/capacitor-config.ts`). `dist/server` is still shared, deliberately: it is the
prerender's scratch, nothing syncs it, and relocating it breaks the prerender outright.

**Precedence (the rule the consumer asked for):**
1. **`target = "capacitor"` is absolute** — always `render:"spa"` + `sw:false`, no matter what the config
   says. A WebView has no server to SSR into, and the on-device bundle *is* the offline shell, so a SW
   would fight it (`docs/design/rendering.md §1`). Only the adaptv CLI ever sets this target (`ADAPTV_TARGET=capacitor`).
2. **For `target = "web"`, the consumer's `render` wins, full stop.** Nothing else votes: the second
   voter used to be `host: "static"`, which forced `"spa"` — but that was the same statement made twice,
   and it is gone (`docs/decisions/rendering-and-delivery.md §2`). So "I want a static SPA on the web anyway" (deploy to a CDN, no
   server) is just `render: "spa"` — fully supported, no native involvement, and it still gets the
   worker plus the static-host files (§3.2).

### 3.2 Static deploy — the "SPA + SW, no server" path

`render: "spa"` prerenders a static shell and hydrates on the client; the worker precaches the
route chunks + a navigation-fallback to the shell. Result: a fully static PWA that works offline and
updates via SW revalidate — deployable to any static host, no Node server. This is the correct path for
devs who "just want to deploy statically," and it's a per-app choice that never touches the native
lineage.

`render: "spa"` **on the web lineage** is what triggers `adaptvStaticHostPlugin` to write `index.html`,
`404.html`, `.nojekyll` and `_redirects` into the client output. They are emitted **unconditionally for
every web SPA build** rather than for a nominated host, because each is read by one platform and ignored
by the others — so all four are correct wherever the bucket lands, and the build never has to be told
where that is. Under `"ssr"` they are never written: `_redirects` there would answer navigations from a
static file and take them away from the server. → `docs/decisions/rendering-and-delivery.md §2`

"On the web lineage" is the part that was missing. The gate read `render === "spa"`, and a Capacitor
bundle is `render: "spa"` too — so every `.ipa` and `.apk` shipped all four, answering to an HTTP host a
WebView does not have. `render` is the wrong question for that decision; `target` is. → §3.2a

### 3.2a The native lineage drops what only a browser could read

The mirror image, and the reason `AdaptvContext` carries `target` separately from `render`. A native
build is a normal client build, so it inherits every asset the web build emits for **browser chrome** —
and inside a WebView reading files off the device there is no tab, no bookmark, no address bar and no
install prompt to render any of it. `adaptvNativeBundlePlugin` (`src/vite/native-bundle.ts`) prunes it, as an
`enforce: "post"` plugin so it runs after the router's own post-build prerender (`vite-plugin-map.md` §2.5):

| dropped | why it can't be used on device |
|---|---|
| the icon art (`icons`, or adaptv's default set) | no browser chrome to draw a favicon in — launcher icons are generated into the native project from the **source** dir, never from here |
| `.vite/manifest.json` | Vite's source→chunk map, for a **server** emitting preload tags; a static SPA ships those tags in the document |
| `_shell.html` | the router's own prerendered SPA shell; the WebView boots adaptv's `index.html` (register B31), so nothing reads it. It also stamps the render's time, and the OTA build tag hashes every file here: while it shipped, two builds of one checkout announced two bundles (66 KB on the playground, measured 2026-09-13) |
| `_redirects`, `404.html`, `.nojekyll` | not emitted at all now — see above |
| `registerSW`'s body | `virtual:adaptv/pwa-register` emits a stub when `sw.enabled` is false |
| the manifest's `icons` array | kept as `[]`; `manifest.json` itself stays, because `useManifestOrientation` fetches it on device |

The head links and the manifest entries are suppressed **at their source**, not just deleted from disk:
a dangling `<link rel="icon">` would cost a burst of 404s inside the WebView on every cold launch.

Measured on the playground: **4.5 MB → 3.1 MB**, of which 1.3 MB was icon art.

### 3.3 Generated files & `.adaptv/`

The root route and router entry are **package modules**, not stamped files: an app ejects the root by
passing its own file to `rootRoute()`, the router by writing `src/router.tsx`, and the client entry by
writing `src/client.tsx`. What adaptv does generate (TanStack's route tree, the worker's `sw.gen.ts`, the
generator's scratch under `tmp/router/`) lands in the hidden, gitignored `.adaptv/`, and `stamp.ts` only
keeps the app's `.gitignore` and tsconfig wired to it. → `docs/design/architecture.md §3`

---

## 4. Build & deploy — the web lineage

### 4.1 Build

`vite build` (via `adaptv()`), driven by §3.1 for `target:"web"`:
- **SSR:** emits `.output/server/index.mjs` + `.output/public/` + `.output/public/sw.js`.
- **SPA/static:** emits `dist/client/` (+ `sw.js`) only, no server.

The SW build runs once the client output is complete — after every client environment **and** after the
deploy plugin has copied `public/` in, but before Nitro bundles the server, whose node-server preset bakes
a table of the files it serves (`emitIntoClientOutput`, `src/vite/deploy-server.ts`). It bundles the app's `serviceWorkers: []` modules, injects the
Workbox precache manifest and a content-hashed `__ADAPTV_BUILD_TAG__` so the cache namespace tracks the
deployed assets. The hook matters: on `closeBundle` the glob caught a half-assembled directory and
shipped a worker missing 21 files, silently; in `buildApp` post, after Nitro's server bundle, the node
server answered 404 at `/sw.js`. → `docs/decisions/rendering-and-delivery.md §2`

### 4.2 Deploy

adaptv deliberately **does not own web CD**, but it does own the server *build*. `adaptv()` wires
`nitro/vite` for `render: "ssr"` and nothing for `"spa"`, so the consumer's `vite.config.ts` names no
host — `plugins: [adaptv(), tailwindcss()]`. The deploy itself stays the host's own tool
(`wrangler deploy`, `vercel`, a Node process, or copying the client output to a bucket).

- **`render: "ssr"`** → `.output/server/index.mjs` + `.output/public/` (the shell, `sw.js`, every asset).
- **`render: "spa"`** → `dist/client/` only. No server is built, because a bucket of files has nothing to
  invoke one with.

**CI/CD needs nothing from adaptv, and that is the point.** Nitro auto-detects AWS Amplify, Azure,
Cloudflare, Firebase App Hosting, Netlify, Stormkit, Vercel and Zeabur from the platform's own build
environment; pipelines building elsewhere set `NITRO_PRESET`, which Nitro's docs recommend for exactly
this case. adaptv adds no config key and no CLI flag on top. → `docs/decisions/rendering-and-delivery.md §2`

### 4.3 OTA for web is free

A new deploy → the adaptv SW revalidates the shell + assets (`autoUpdate`) → the next load is fresh. No
extra mechanism; this is the SW's job (`docs/design/rendering.md §3`). Only the **native** lineage needs a real OTA
system — §5.

---

## 5. Update — over-the-air for native

**Moved.** The OTA design grew to ~1000 lines and is a subsystem in its own right, so it now lives at
[`ota.md`](ota.md) — which also corrects its status: it is **shipped**, not "designed here". Its
section numbers are preserved, so an existing `§5.4b` / `§5.6` reference still resolves; only the file
changed.

In one line, for the lifecycle's purposes: the native lineage is pure JS/CSS/assets, so an update is a
**pointer-flip onto a newer bundle**, gated on a native fingerprint, signed, applied next launch, with
a watchdog rollback. `adaptv build web` publishes the channel alongside the site.

---

## 6. Opting out of native (Capacitor) — web-only apps

**Omit `appId` and the app is web-only, full stop:**
- No Capacitor config is generated, no `android/` or `ios/` project, no `.adaptv/web`.
- The `adaptv` CLI refuses fast when it loads the config: *"missing 'appId' in adaptv.config.ts"*.
- `vite build` produces the normal web/PWA output (`.output/` for SSR, `dist/client/` for a static SPA)
  exactly as in §4 — per §3.
- Capacitor is adaptv's own dependency, not an optional peer (`docs/decisions/register.md` L20): a
  web-only app installs it with adaptv, and nothing generates a native project from it.

And the inverse guarantee the goal asks for: **a web build never produces or serves the Capacitor SPA.**
`.adaptv/web` and the Capacitor config materialize *only* under `ADAPTV_TARGET=capacitor`, which only
the CLI sets — so the two lineages stay physically separate (the one exception is opt-in OTA §5.2, where
you *deliberately* emit the bundle into the web deploy's public path).

---

## 7. The CLI — `bin/adaptv.mjs`

The CLI owns the **entire native toolchain** so the consumer never touches Capacitor, the env
(`ANDROID_HOME`/`JAVA_HOME`/`pod`/`LANG` are auto-resolved — explicit env still wins), or the asset
generator by hand. It reads the same `adaptv.config.ts`.

### 7.1 Commands (today)

| Command | Pipeline |
|---|---|
| `adaptv doctor` | check toolchain (JDK, Android SDK, Xcode, pod) + that the app has the base Capacitor plugins installed (Cap only auto-discovers **direct** deps) |
| `adaptv dev <web\|ios\|android\|all> [--target id] [--latest] [--host]` | one Vite dev server, every named surface attached to it and live-reloading. Reverts everything it changed on exit |
| `adaptv preview <web\|ios\|android\|all> [--target id] [--latest]` | the real build, run the way a user gets it — served locally for `web`, installed and launched for a device. No live reload |
| `adaptv build <web\|ios\|android\|all> [--output path]` | `web` → the deployable site **with the update channel inside it** (§5.2); `ios`/`android` → `gradlew assembleDebug` (**debug `.apk`**) / `packageIpa` in `bin/adaptv.mjs` (**unsigned `.ipa`**), landing at `--output` or `.adaptv/builds/<app>.apk`\|`.ipa` |
| `adaptv keys ota` | the RSA pair that signs the update channel and verifies it on device (§5.4d). Run once per app; adaptv keeps no copy of the private half |
| `adaptv icons --input <image>` | the whole icon set, every platform variant, from one image |

`run`, `sync` and `assets` are no longer standalone commands — `run` split into `dev` and `preview`, and
the other two are internal steps of both. **The command surface is `bin/lib/cli-spec.mjs`**, which the
parser, the help page and the suggestions are all derived from; this table is a summary of it, not a
second copy to keep in step.

**Native projects live in `.adaptv/`.** `cap add`/`sync`/`run` are pointed at `.adaptv/ios` and
`.adaptv/android` via `android.path`/`ios.path` in the generated Capacitor config, which adaptv hands
`cap` in the `ADAPTV_CAPACITOR_CONFIG` env var rather than a file (paths relative to the app root, where
`cap` runs; `bin/lib/cap.mjs`). So *everything* adaptv generates — the route tree and both native
projects — sits under one hidden, git-ignored dir, regenerated like `dist/`. An `ios/` or `android/`
at the app root is not adaptv's and is left alone: the one-time move into `.adaptv/` that used to run
was a compatibility shim for a layout no published install ever had, and adaptv carries none.

**What adaptv writes into the Android project it owns.** Beyond what `cap add` scaffolds, every
Android prepare injects the plugin projects (`capacitor.settings.gradle`, `app/capacitor.build.gradle`,
`app/src/main/assets/capacitor.plugins.json` — the consumer declares no `@capacitor/*`, so adaptv has
to; **L20** in the register) and stamps the SDK levels into `variables.gradle`. `ANDROID_SDK_LEVELS` in
`src/native/android-sdk.ts` is the single source for `compileSdkVersion` and `targetSdkVersion`; the
stamp runs on a fresh project and an existing one alike, because `.adaptv/android` persists across both
a Capacitor template bump and a Play requirement bump, and a level adaptv only inherited from the
template would otherwise stay wherever the project was first scaffolded. `adaptv doctor` reads the same
file back.

**Device targeting.** adaptv owns the picker (rather than Capacitor's opaque one) so it can cache your
choice: `dev` and `preview` list targets via `cap run <platform> --list --json`, show a branded arrow-key
picker, and write the pick to `.adaptv/state.json` (the one file the CLI remembers anything in, under
`devices`).
`--target <id>` selects directly (and caches); `--latest`
reuses the cached device (falling back to the picker if none). *Listing requires the platform to exist,
so they prepare the native project **before** resolving the target.*

**Branded output.** Every long-running step (vite/cap/gradle/xcode/pod) is **captured**, not inherited —
rendered as calm phased steps (a small custom renderer, the device picker included) with a spinner +
elapsed time. Inner logs are hidden unless a step fails (then a log tail is shown) or `--verbose` is
passed (full raw passthrough). `dev`, `preview` and `build` run their platforms as concurrent lanes, one
live line per platform; a non-TTY / CI shell degrades to plain prefixed lines.

Every native build runs the same spine: **`buildWeb(capacitor)` → `generateAssets` → `capSync` → (launch
/ package)**. adaptv writes the launcher icons itself, with sharp (`bin/lib/icons.mjs`); the splash is
colour-driven (Android launch theme + `values/colors.xml`/`values-night/colors.xml`; iOS colour asset +
solid storyboard) and re-applied idempotently every sync (`docs/design/behaviors.md §3`).

> **Web** runs through the same commands — `adaptv dev web`, `adaptv preview web` and `adaptv build web`
> (the table above). Web *deploy* stays out of the CLI by design — it's the host's own tool, and the
> target is named in `vite.config.ts` (§4.2).

### 7.2 Testing native builds

The native test loop is `adaptv dev <platform>` or `adaptv preview <platform>` onto a simulator/emulator
(both available locally), against the six-target discipline in `docs/guides/testing.md`. ⚠︎ *Future:* a
`adaptv e2e` that drives the sim/emulator (Maestro/Appium or the simulator MCP) so the native matrix can
run in CI — out of scope for this pass, flagged in `VISION.md §9`.

### 7.3 Signing & distribution

- **Android:** debug `.apk` is fully automated. Release signing (keystore) is the user's — a `adaptv build
  android --release` that reads a keystore from config/env is a reasonable ⚠︎ future add.
- **iOS:** only the **unsigned** `.ipa` is automatable (`adaptv build ios` → `packageIpa`);
  signed TestFlight/App Store builds stay in Xcode ▸ Archive (signing identities/provisioning are
  Apple-account state adaptv shouldn't hold). adaptv stops at the artifact — it does not own fastlane
  (⚠︎ open question in `VISION.md §9`).

### 7.4 ⚠︎ Delta — designed additions

| Command | Purpose |
|---|---|
| `adaptv dev [--host ios\|android]` | §2.2 — unified dev entry with device live-reload |

Web deploy stays **out** of the CLI on purpose (§4.2) — it's the host's own tool, and the target is
named in `vite.config.ts`. No `--host`-style deploy flag is planned either: pipelines that need to switch
target per environment set `NITRO_PRESET`, which is upstream's documented path for CI/CD.

**And so does OTA.** Earlier drafts listed `adaptv ota build` / `adaptv ota status` here. There is no
such command and there will not be one: emitting the channel is a build step, and "can this ship OTA?"
is derived from the build rather than answered by a human (§5.2).

---

## 8. `create-adaptv` — scaffolding

**Moved** to its own file: [`create-adaptv.md`](create-adaptv.md).

---

## 9. Lifecycle at a glance

```
CONFIGURE   adaptv.config.ts  ── render · serviceWorkers · appId · origin
                │
DEVELOP     adaptv dev <web|ios|android|all>       (HMR; live-reload on device)
                │
BUILD  ┌── web:      vite build ──────────────→ .output/ | dist/client   (SSR+SW | static SPA+SW)
       └── native:   adaptv dev|preview|build ──→ .adaptv/web → cap → APK | IPA
                │
DEPLOY ┌── web:      host tool (wrangler/vercel/node/static bucket)
       └── native:   sideload IPA/APK · TestFlight/Store (Xcode signing)
                │
UPDATE ┌── web/PWA:  SW revalidate                (free)
       └── native:   adaptv build web emits manifest+bundle → rides the web deploy;
                     app checks on launch/resume → fingerprint-gated swap → apply next launch
```

**The invariant:** one config, one codebase; two build lineages that never cross; each target gets the
delivery + update mechanism that is correct for it, chosen by adaptv, tunable only where the choice is
legitimately the developer's (`render`, `origin`, `otaOnNativeSkew`, native opt-out).
