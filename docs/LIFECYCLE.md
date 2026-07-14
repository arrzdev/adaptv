# nativ — the framework lifecycle

> How a nativ app goes from **one config + one codebase** to **six running targets** and stays updated:
> configure → develop → build → deploy (SSR+SW / SPA per target) → native APK/IPA → over-the-air updates.
> The Vite plugin's decision model, the CLI surface, and the seams that keep it all driven by one file.
>
> Doctrine + design. Each section states the **model**, what **already holds** in the code today, and the
> **delta** to close (⚠︎ = not built yet, designed here). Pairs with `RENDERING.md` (the isomorphism
> boundary), `ARCHITECTURE.md` (the contracts), and `RESEARCH.md` (OTA/TanStack prior art). Started
> **2026-07-14**.

---

## 0. The shape of the lifecycle

One `nativ.config.ts` + one React codebase fan out into **two build lineages** that never cross:

```
                          nativ.config.ts  (single source of truth)
                                   │
          ┌────────────────────────┴───────────────────────────┐
          ▼                                                     ▼
   WEB lineage  (vite build)                        NATIVE lineage  (nativ CLI)
   target = "web"                                   target = "capacitor"
   render = ssr | spa   · SW on/off                 render = spa (forced) · SW off (forced)
   → dist/  (server + client + sw.js)               → dist-capacitor/client  (static SPA shell)
          │                                                     │
   deploy to a host (CF/Vercel/Node) or static      cap sync → android/ · ios/  →  APK / IPA
          │                                                     │
   SW revalidate = free OTA for web/PWA             nativ OTA = bundle-swap of dist-capacitor  ⚠︎
```

The two lineages share **everything above the build** (routes, components, capabilities, the shell) and
**nothing below it**. The native SPA (`dist-capacitor/`) is produced **only** by the CLI and is **never**
emitted by a plain `vite build` — so a web deploy can't accidentally build or ship the Capacitor bundle
(this separation already holds: `capacitor.config.json` + `dist-capacitor/` materialize only under
`NATIV_TARGET=capacitor`).

The five stages: **1. Configure · 2. Develop · 3. Build · 4. Deploy · 5. Update.**

---

## 1. Configure — `nativ.config.ts` is the only knob surface

Everything downstream is derived from `defineApp({...})`. The consumer never hand-writes
`capacitor.config`, a web manifest, a TanStack Start config, a service worker registration, or a native
project setting — nativ generates each from this file (doctrine §1: configure *intent*, not mechanism).

Both readers (the Vite plugin's `loadAppConfig`, the CLI's `loadConfig`) bundle it with esbuild to a
`data:` URL with **dynamic imports left external**, so the screen thunks (`splashScreen: () =>
import(...)`) never execute at build time — nativ reads their specifier and emits a static import in the
generated root. One file, two consumers, identical data.

### 1.1 What drives the lifecycle (today)

| Field | Drives |
|---|---|
| `router.render: "spa" \| "ssr"` | web render mode (see §3) |
| `sw: string \| false` | service-worker entry, or off |
| `appId?: string` | **presence enables the native lineage**; absence = web-only (§6) |
| `styles`, `themeColor`, `icons`, `orientation`, `splashScreen`, `splashMaskMode`, `patches`, … | manifest, head, splash, native project, WebKit fixes |

### 1.2 ⚠︎ Delta — a first-class `web` deployment block

Today the deploy shape is expressed as two low-level fields (`router.render` + `sw`) and the web adapter
is **hardcoded** in the example app (Cloudflare). That's mechanism leaking into config. **Recommended
target:** a single intent-level `web` block, with `router.render`/`sw` demoted to advanced escape
hatches:

```ts
export default defineApp({
  // …
  web: {
    render: "ssr",                 // "ssr" (default — first paint, per RENDERING.md) | "spa"
    host: "cloudflare",            // "cloudflare" | "vercel" | "node" | "static"  → picks the Start adapter
    sw: true,                      // default true
  },
  native: { appId: "com.acme.app" },   // omit the whole block → web-only (§6)
  ota: { channel: "production" },       // ⚠︎ §5 — omit → no OTA
})
```

- `web.render` defaults to **`"ssr"`** to match `RENDERING.md`'s "SSR by default" (⚠︎ the code currently
  defaults `router.render` to `"spa"` — reconcile: `web.render` resolves `router.render`).
- `web.host` maps to a TanStack Start deploy preset — this is *precisely* why nativ keeps Start (roadmap
  #4): rent its deploy-anywhere adapters instead of owning CD. `host: "static"` + `render: "spa"` is the
  fully-static PWA path (§3.2).
- `native.appId` presence is the **native opt-in/opt-out** switch (§6). `ota` presence enables §5.

---

## 2. Develop — `nativ dev`

### 2.1 Web / PWA dev (today)

`vite dev` (through the `nativ()` plugin) runs the app with HMR. The plugin's `configureServer` watcher
re-loads `nativ.config.ts` (and any module it imports) on change and full-reloads. Standalone-PWA and
mobile-browser dev = the same dev server opened on a phone / simulator over the LAN.

### 2.2 ⚠︎ Delta — `nativ dev` as the unified entry, with device live-reload

There is **no `nativ dev` command today** (contra a stale HANDOFF note); web dev is bare `vite dev`.
**Recommended:**

```bash
nativ dev                    # = vite dev (web/PWA HMR)
nativ dev --host ios         # vite dev + cap run ios with server.url → the dev server (live-reload on device)
nativ dev --host android     # same for Android
```

`--host` uses Capacitor's live-reload (`server.url` → the LAN dev-server URL) so a real device/emulator
renders the **live** app with HMR against the same server — the fast native inner loop, no rebuild per
change. Native-only code paths (`isNativePlatform()` branches, plugins) light up because it's the real
WebView, while JS edits hot-reload.

---

## 3. The Vite plugin — the deploy decision model

One `nativ()` call in `vite.config.ts`. It is an **async plugin factory**: it loads the config first (so
Start is configured from it and the generated root/router exist before any hook), then returns the plugin
array (`nativ()` + TanStack Start + React + manifest + SW-build + PWA-register virtuals).

### 3.1 The decision matrix (target × render × sw)

The single most important table in the lifecycle — how one codebase resolves to a delivery shape:

| `target` | `web.render` | `web.sw` | → render | → service worker | → server? | Output dir |
|---|---|---|---|---|---|---|
| `web` | `ssr` | `true` | **SSR** | yes (nativ-owned) | yes (adapter) | `dist/` (server + client + `sw.js`) |
| `web` | `spa` | `true` | **SPA** prerender | yes | no | `dist/client/` (static + `sw.js`) |
| `web` | `spa` | `false` | **SPA** prerender | no | no | `dist/client/` (static) |
| `capacitor` | — *forced* — | — *forced* — | **SPA** | **off** | no | `dist-capacitor/client/` |

**Precedence (the rule the consumer asked for):**
1. **`target = "capacitor"` is absolute** — always `render:"spa"` + `sw:false`, no matter what the config
   says. A WebView has no server to SSR into, and the on-device bundle *is* the offline shell, so a SW
   would fight it (`RENDERING.md §1`). Only the nativ CLI ever sets this target (`NATIV_TARGET=capacitor`).
2. **For `target = "web"`, the consumer's `web.render` / `web.sw` win.** So "I want a static SPA + SW on
   the web anyway" (deploy to a CDN, no server) is just `web: { render: "spa", host: "static", sw: true }`
   — fully supported, no native involvement.

This already works mechanically today via `options.target ?? NATIV_TARGET` + `config.router.render` +
`config.sw`; the delta is only the nicer `web` config surface (§1.2) feeding it.

### 3.2 Static deploy — the "SPA + SW, no server" path

`web.render:"spa"` prerenders a static shell and hydrates on the client; `web.sw:true` precaches the
route chunks + a navigation-fallback to the shell. Result: a fully static PWA that works offline and
updates via SW revalidate — deployable to any static host (`host:"static"`), no Node server. This is the
correct path for devs who "just want to deploy statically," and it's a per-app choice that never touches
the native lineage.

### 3.3 Generated files & the `.nativ/` future

The plugin **stamps** the generated root route + router entry (`router.gen`) unless the app ejects
(`src/router.tsx` / `src/client.tsx`). Today these land at the app root; the `ARCHITECTURE.md §3` plan
relocates them (and the TanStack `*.gen` route tree) into a hidden `.nativ/` dir so the consumer's source
imports only `nativ`. That's a build-plumbing change layered on top of this same stamping step.

---

## 4. Build & deploy — the web lineage

### 4.1 Build

`vite build` (via `nativ()`), driven by §3.1 for `target:"web"`:
- **SSR:** emits the server bundle + `dist/client/` + `dist/client/sw.js` (the SW build runs on the SSR
  environment's `closeBundle`, bundles the app-authored `src/sw.ts`, injects the Workbox precache
  manifest + a content-hashed `__NATIV_BUILD_TAG__` so the cache namespace tracks the deployed assets).
- **SPA/static:** emits `dist/client/` (+ `sw.js`) only, no server.

### 4.2 Deploy

nativ deliberately **does not own web CD** — `web.host` selects a TanStack Start adapter and the actual
deploy is the host's own tool (`wrangler deploy`, `vercel`, a Node process, or copying `dist/client/` to
a bucket). Renting Start's adapters is the whole reason to keep it (roadmap #4); nativ's job stops at
producing the correct adapter output. (⚠︎ delta: today the example hardcodes the Cloudflare adapter in
`vite.config.ts`; the target is `web.host` selecting it.)

### 4.3 OTA for web is free

A new deploy → the nativ SW revalidates the shell + assets (`autoUpdate`) → the next load is fresh. No
extra mechanism; this is the SW's job (`RENDERING.md §3`). Only the **native** lineage needs a real OTA
system — §5.

---

## 5. ⚠︎ Update — over-the-air for native (designed here)

Not built. This is the design. Framing from the goal: *the build is saved on every deployment to a
default public folder*, and the app pulls it — **no third-party update server**.

### 5.1 The core insight

The Capacitor SPA (`dist-capacitor/`) is **pure JS/CSS/assets — zero native code**. So an OTA update *is*
simply shipping a newer `dist-capacitor/` to the installed app. Apple §3.3.2 explicitly permits
JS/asset-only OTA; a change that touches native code/plugins does **not** qualify and needs a store build.
The entire safety problem reduces to: **"is this new bundle native-compatible with the installed shell?"**

### 5.2 The channel lives in the app's own web deploy

nativ hosts OTA on the **same origin the web app already deploys to** — no Appflow/Capgo backend:

```
https://app.acme.com/.well-known/nativ/ota/<channel>/
   manifest.json          → { buildTag, nativeFingerprint, url, sha256, minShell, createdAt }
   bundle-<buildTag>.zip   → the gzipped dist-capacitor/client
```

`nativ ota build` (§7) produces the zip + manifest and drops them under the web app's `public/` so the
**ordinary web deploy carries them** — literally "the build is saved on every deployment." Channels:
`production` / `staging` / per-PR preview.

### 5.3 The safety gate — `nativeFingerprint`

The crux (the thing Capgo's CLI gets right, `RESEARCH.md §5`). At build time nativ computes a
**`nativeFingerprint`** = hash of the native surface: the installed Capacitor plugin set + versions +
core version + `appId` + any custom native code. It's baked into **both** the store binary and every OTA
manifest.

- **fingerprint matches** → the JS bundle is compatible with the installed shell → OTA is safe: download,
  verify `sha256`, unpack to a data dir, set as the pending bundle, **apply on next launch**.
- **fingerprint differs** → native surface changed → OTA is **refused**; the updater surfaces "update
  available in the App Store" instead of hot-swapping. This is what keeps nativ inside Apple §3.3.2 and
  prevents a JS bundle from running against an incompatible native shell.

### 5.4 Applying, safety, rollback

- **Apply on next launch, never mid-session** — swapping the WebView root under a live app tears its
  state. The download happens in the background (on launch + on **resume** — this is a consumer of the
  `useAppState` resume signal from the coordination layer); the swap happens at the next cold start.
- **Boot watchdog + rollback** — the shell pings "app ready" after a successful boot. If a freshly
  applied bundle doesn't ping within N seconds, the updater reverts to the last-known-good bundle on the
  next launch. Never brick. Keep ≥1 previous good bundle.
- **Integrity** — `sha256` in the manifest is verified before unpack; the manifest should be signed (an
  app-held public key) so a compromised CDN can't push arbitrary JS.

### 5.5 Own the policy, rent the swap

Per doctrine (`ARCHITECTURE.md §0.6`: rent stable cores, own seams) and `RESEARCH.md §5` ("don't DIY the
bundle-swap blindly"): nativ **owns** the channel convention, the manifest schema, the `nativeFingerprint`
gate, the watchdog/rollback policy, and the resume-driven check; nativ **rents** the low-level
`WebView.setServerBasePath` bundle-swap from a maintained plugin (Capawesome Live Update or Capgo) rather
than hand-rolling the native file juggling. If neither fits, the DIY path (download → unpack → data dir →
`serverBasePath` → apply next launch) is the fallback — but start by wrapping.

---

## 6. Opting out of native (Capacitor) — web-only apps

**Omit `native.appId` and the app is web-only, full stop:**
- No `capacitor.config.json` is stamped, no `android/` or `ios/` project, no `dist-capacitor/`.
- The `nativ` CLI's native commands (`run`/`build`/`sync`/`assets`) refuse fast: *"needs an `appId`."*
- `vite build` produces the normal web/PWA output (`dist/`) exactly as in §4 — SSR or static SPA per §3.
- The Capacitor plugins are **optional peer deps**, so a web-only app never installs them.

And the inverse guarantee the goal asks for: **a web build never produces or serves the Capacitor SPA.**
`dist-capacitor/` + `capacitor.config.json` materialize *only* under `NATIV_TARGET=capacitor`, which only
the CLI sets — so the two lineages stay physically separate (the one exception is opt-in OTA §5.2, where
you *deliberately* emit the bundle into the web deploy's public path).

---

## 7. The CLI — `bin/nativ.mjs`

The CLI owns the **entire native toolchain** so the consumer never touches Capacitor, the env
(`ANDROID_HOME`/`JAVA_HOME`/`pod`/`LANG` are auto-resolved — explicit env still wins), or the asset
generator by hand. It reads the same `nativ.config.ts`.

### 7.1 Commands (today)

| Command | Pipeline |
|---|---|
| `nativ doctor` | check toolchain (JDK, Android SDK, Xcode, pod) + that the app has the base Capacitor plugins installed (Cap only auto-discovers **direct** deps) |
| `nativ run <ios\|android> [--target id]` | build SPA (`NATIV_TARGET=capacitor`) → brand icons/splash → `cap sync` → `cap run` on device/sim |
| `nativ sync [ios\|android]` | build SPA → brand assets → `cap sync` (no launch) |
| `nativ build android` | …sync → `gradlew assembleDebug` → **debug `.apk`** |
| `nativ build ios --ipa` | …sync → `scripts/build-ipa.sh` → **unsigned `.ipa`** (sideload / re-sign) |
| `nativ assets [ios\|android]` | regenerate launcher icons (`./assets/logo.png`) + the colour-driven splash mask |

Every native build runs the same spine: **`buildWeb(capacitor)` → `generateAssets` → `capSync` → (launch
/ package)**. Icons come from `@capacitor/assets`; the splash is colour-driven (Android launch theme +
`colors.xml`/`colors-night.xml`; iOS colour asset + solid storyboard) and re-applied idempotently every
sync (`BEHAVIORS.md §3`).

### 7.2 Testing native builds

The native test loop is `nativ run <platform>` onto a simulator/emulator (both available locally),
against the six-target discipline in `TESTING.md`. ⚠︎ *Future:* a `nativ e2e` that drives the sim/emulator
(Maestro/Appium or the simulator MCP) so the native matrix can run in CI — out of scope for this pass,
flagged in `VISION.md §9`.

### 7.3 Signing & distribution

- **Android:** debug `.apk` is fully automated. Release signing (keystore) is the user's — a `nativ build
  android --release` that reads a keystore from config/env is a reasonable ⚠︎ future add.
- **iOS:** only the **unsigned** `.ipa` is automatable (`--ipa`); signed TestFlight/App Store builds stay
  in Xcode ▸ Archive (signing identities/provisioning are Apple-account state nativ shouldn't hold). nativ
  stops at the artifact — it does not own fastlane (⚠︎ open question in `VISION.md §9`).

### 7.4 ⚠︎ Delta — designed additions

| Command | Purpose |
|---|---|
| `nativ dev [--host ios\|android]` | §2.2 — unified dev entry with device live-reload |
| `nativ ota build [--channel c]` | §5 — build `dist-capacitor` + compute `buildTag`/`nativeFingerprint` + write manifest + zip into the web `public/.well-known/nativ/ota/<channel>/` |
| `nativ ota status` | inspect the current channel manifest vs the installed build |

Web deploy stays **out** of the CLI on purpose (§4.2) — it's the host's tool, driven by `web.host`.

---

## 8. ⚠︎ `create-nativ` — scaffolding (roadmap #3)

`pnpm create nativ` (a separate package / `bin`) emits a ready app so the lifecycle starts from a correct
baseline, not hand-assembly:
- `nativ.config.ts` (with a `web` block, optional `native.appId`, optional `ota`).
- `vite.config.ts` with a single `nativ()` call.
- A `routing/` dir + one example `View`-rooted route (§`ARCHITECTURE.md §1`).
- `src/sw.ts`, `src/styles/main.css`, `assets/logo.png` placeholder.
- Scripts wired to `nativ dev` / `vite build` / `nativ run`.
- Optionally scaffolds `android/`/`ios/` on first `nativ sync` rather than at create time (keeps the repo
  lean; native projects are regenerable from config).

---

## 9. Lifecycle at a glance

```
CONFIGURE   nativ.config.ts  ── web{render,host,sw} · native{appId} · ota{channel}
                │
DEVELOP     nativ dev [--host ios|android]        (HMR; live-reload on device)
                │
BUILD  ┌── web:      vite build ──────────────→ dist/         (SSR+SW | static SPA+SW)
       └── native:   nativ run|build|sync ─────→ dist-capacitor/ → cap → APK | IPA
                │
DEPLOY ┌── web:      host tool (wrangler/vercel/node/static bucket)
       └── native:   sideload IPA/APK · TestFlight/Store (Xcode signing)
                │
UPDATE ┌── web/PWA:  SW revalidate                (free)
       └── native:   nativ ota build → manifest+bundle rides the web deploy;
                     app checks on launch/resume → fingerprint-gated swap → apply next launch
```

**The invariant:** one config, one codebase; two build lineages that never cross; each target gets the
delivery + update mechanism that is correct for it, chosen by nativ, tunable only where the choice is
legitimately the developer's (`web.render`/`host`/`sw`, `ota.channel`, native opt-out).
