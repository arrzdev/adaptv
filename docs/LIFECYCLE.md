# adaptv — the framework lifecycle

> How a adaptv app goes from **one config + one codebase** to **six running targets** and stays updated:
> configure → develop → build → deploy (SSR+SW / SPA per target) → native APK/IPA → over-the-air updates.
> The Vite plugin's decision model, the CLI surface, and the seams that keep it all driven by one file.
>
> Doctrine + design. Each section states the **model**, what **already holds** in the code today, and the
> **delta** to close (⚠︎ = not built yet, designed here). Pairs with `RENDERING.md` (the isomorphism
> boundary), `ARCHITECTURE.md` (the contracts), and `RESEARCH.md` (OTA/TanStack prior art). Started
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
   → dist/  (server + client + sw.js)               → dist-capacitor/client  (static SPA shell)
          │                                                     │
   deploy to a host (CF/Vercel/Node) or static      cap sync → android/ · ios/  →  APK / IPA
          │                                                     │
   SW revalidate = free OTA for web/PWA             adaptv OTA = bundle-swap of dist-capacitor  ⚠︎
```

The two lineages share **everything above the build** (routes, components, capabilities, the shell) and
**nothing below it**. The native SPA (`dist-capacitor/`) is produced **only** by the CLI and is **never**
emitted by a plain `vite build` — so a web deploy can't accidentally build or ship the Capacitor bundle
(this separation already holds: `capacitor.config.json` + `dist-capacitor/` materialize only under
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
| `router.render: "spa" \| "ssr"` | web render mode (see §3) |
| `sw: string \| false` | service-worker entry, or off |
| `appId?: string` | **presence enables the native lineage**; absence = web-only (§6) |
| `styles`, `themeColor`, `icons`, `orientation`, `splashScreen`, `splashMaskMode`, `patches`, … | manifest, head, splash, native project, WebKit fixes |

> ### ✅ BUILT (2026-07-20) — the `web` block resolves; static emit is wired but blocked on a shell
>
> `src/config/web-config.ts` resolves the block once in `adaptv()` and shares it via `AdaptvContext`, so
> `render`/`host`/SW settings cannot drift between the router wiring, the manifest and the SW build.
> 16 tests.
>
> - **`web.render` now defaults to `"ssr"`**, resolving the doc-vs-code conflict (`DECISIONS.md §3.3`):
>   the legacy `router.render` defaulted to `"spa"` while the docs said `"ssr"`. Both legacy fields still
>   work as escape hatches, with the `web` block winning.
> - **`target: "capacitor"` is an override, not a default** (L12) — SPA + no SW + static host, unconditionally.
> - **`adaptvStaticHostPlugin`** emits `index.html`, `404.html`, `.nojekyll` and `_redirects`
>   (`DECISIONS.md` B26). It gates on the **`ssr` environment**, because `closeBundle` fires once per
>   environment and the client build finishes first — running then looks for a shell that has not been
>   written yet and fails with a misleading error.
>
> ⛔ **`host: "static"` still cannot complete, and the reason corrects an assumption in this doc.**
> Measured in project-zero: with `spa: { enabled: true }` and the Cloudflare adapter, **Start emitted no
> HTML at all** — no `_shell.html`, no `index.html`. So "copy Start's shell" is not a foundation adaptv
> can stand on, and `RENDERING.md §3.1.2`'s requirement that adaptv **generate** its own user-agnostic
> shell is load-bearing rather than belt-and-braces. The emit plugin is built and wired; it has nothing
> to copy. It now fails with an accurate message naming the real cause. → CORE 5.
>
> The same missing shell is why the **SSR precache fallback** currently binds to an `/index.html` that
> does not exist — one gap, two symptoms.

### 1.2 ⚠︎ Delta — a first-class `web` deployment block

Today the deploy shape is expressed as two low-level fields (`router.render` + `sw`) and the web adapter
is **hardcoded** in the example app (Cloudflare). That's mechanism leaking into config. **Recommended
target:** a single intent-level `web` block, with `router.render`/`sw` demoted to advanced escape
hatches:

```ts
export default defineApp({
  // Screen thunks — statically imported by the plugin, NOT lazy chunks (§3.3, RENDERING.md §3.1.2)
  splashScreen:     () => import("@/components/splash-screen"),
  offlineComponent: () => import("@/components/offline"),

  web: {
    render: "ssr",                 // "ssr" (DEFAULT — see DECISIONS.md §6.3) | "spa"
    host: "cloudflare",            // "cloudflare" | "vercel" | "node" | "static"  → picks the Start adapter
    sw: {
      enabled: true,               // default true; `false` for no SW
      // Public, user-agnostic routes precached AS DOCUMENTS so they cold-load
      // instantly and work offline. NEVER list a route rendering per-user content
      // — Cache Storage is per-origin, not per-user. → RENDERING.md §3.2
      precacheDocuments: ["/", "/pricing"],
      register: "prompt",          // "prompt" (default) | "autoUpdate" | "manual" → RENDERING.md §3.4
    },
  },
  native: { appId: "com.acme.app" },   // omit the whole block → web-only (§6)
  ota: { channel: "production" },       // ⚠︎ §5 — omit → no OTA
})
```

- `web.render` defaults to **`"ssr"`** — settled in `DECISIONS.md §6.3` on the asymmetry argument
  (defaulting to SPA silently kills SEO and is discovered late; defaulting to SSR costs a config flip).
  ⚠︎ the legacy code defaults `router.render` to `"spa"`; `web.render` resolves it.
- **`offlineComponent`** mirrors `splashScreen` exactly: one consumer-owned component with optional
  props, rendered by **adaptv** when the app can't boot far enough for a route to exist, and by the
  **consumer** when a mounted route's data is unavailable. → `RENDERING.md §3.1.2`.
- **`web.sw.precacheDocuments`** is empty by default. Route *chunks* are always precached (that's what
  makes navigation instant); this allowlist is only for public HTML documents.
- `web.host` maps to a TanStack Start deploy preset — this is *precisely* why adaptv keeps Start (roadmap
  #4): rent its deploy-anywhere adapters instead of owning CD. `host: "static"` + `render: "spa"` is the
  fully-static PWA path (§3.2).
- `native.appId` presence is the **native opt-in/opt-out** switch (§6). `ota` presence enables §5.

---

## 2. Develop — `adaptv dev`

### 2.1 Web / PWA dev (today)

`vite dev` (through the `adaptv()` plugin) runs the app with HMR. The plugin's `configureServer` watcher
re-loads `adaptv.config.ts` (and any module it imports) on change and full-reloads. Standalone-PWA and
mobile-browser dev = the same dev server opened on a phone / simulator over the LAN.

### 2.2 ⚠︎ Delta — `adaptv dev` as the unified entry, with device live-reload

There is **no `adaptv dev` command today** (contra a stale HANDOFF note); web dev is bare `vite dev`.
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

| `target` | `web.render` | `web.sw` | → render | → service worker | → server? | Output dir |
|---|---|---|---|---|---|---|
| `web` | `ssr` | `true` | **SSR** | yes (adaptv-owned) | yes (adapter) | `dist/` (server + client + `sw.js`) |
| `web` | `spa` | `true` | **SPA** prerender | yes | no | `dist/client/` (static + `sw.js`) |
| `web` | `spa` | `false` | **SPA** prerender | no | no | `dist/client/` (static) |
| `capacitor` | — *forced* — | — *forced* — | **SPA** | **off** | no | `dist-capacitor/client/` |

**Precedence (the rule the consumer asked for):**
1. **`target = "capacitor"` is absolute** — always `render:"spa"` + `sw:false`, no matter what the config
   says. A WebView has no server to SSR into, and the on-device bundle *is* the offline shell, so a SW
   would fight it (`RENDERING.md §1`). Only the adaptv CLI ever sets this target (`ADAPTV_TARGET=capacitor`).
2. **For `target = "web"`, the consumer's `web.render` / `web.sw` win.** So "I want a static SPA + SW on
   the web anyway" (deploy to a CDN, no server) is just `web: { render: "spa", host: "static", sw: true }`
   — fully supported, no native involvement.

This already works mechanically today via `options.target ?? ADAPTV_TARGET` + `config.router.render` +
`config.sw`; the delta is only the nicer `web` config surface (§1.2) feeding it.

### 3.2 Static deploy — the "SPA + SW, no server" path

`web.render:"spa"` prerenders a static shell and hydrates on the client; `web.sw:true` precaches the
route chunks + a navigation-fallback to the shell. Result: a fully static PWA that works offline and
updates via SW revalidate — deployable to any static host (`host:"static"`), no Node server. This is the
correct path for devs who "just want to deploy statically," and it's a per-app choice that never touches
the native lineage.

### 3.3 Generated files & the `.adaptv/` future

The plugin **stamps** the generated root route + router entry (`router.gen`) unless the app ejects
(`src/router.tsx` / `src/client.tsx`). Today these land at the app root; the `ARCHITECTURE.md §3` plan
relocates them (and the TanStack `*.gen` route tree) into a hidden `.adaptv/` dir so the consumer's source
imports only `adaptv`. That's a build-plumbing change layered on top of this same stamping step.

---

## 4. Build & deploy — the web lineage

### 4.1 Build

`vite build` (via `adaptv()`), driven by §3.1 for `target:"web"`:
- **SSR:** emits the server bundle + `dist/client/` + `dist/client/sw.js` (the SW build runs on the SSR
  environment's `closeBundle`, bundles the app-authored `src/sw.ts`, injects the Workbox precache
  manifest + a content-hashed `__ADAPTV_BUILD_TAG__` so the cache namespace tracks the deployed assets).
- **SPA/static:** emits `dist/client/` (+ `sw.js`) only, no server.

### 4.2 Deploy

adaptv deliberately **does not own web CD** — `web.host` selects a TanStack Start adapter and the actual
deploy is the host's own tool (`wrangler deploy`, `vercel`, a Node process, or copying `dist/client/` to
a bucket). Renting Start's adapters is the whole reason to keep it (roadmap #4); adaptv's job stops at
producing the correct adapter output. (⚠︎ delta: today the example hardcodes the Cloudflare adapter in
`vite.config.ts`; the target is `web.host` selecting it.)

### 4.3 OTA for web is free

A new deploy → the adaptv SW revalidates the shell + assets (`autoUpdate`) → the next load is fresh. No
extra mechanism; this is the SW's job (`RENDERING.md §3`). Only the **native** lineage needs a real OTA
system — §5.

---

## 5. ⚠︎ Update — over-the-air for native (designed here)

Not built. This is the design. Framing from the goal: *the build is saved on every deployment to a
default public folder*, and the app pulls it — **no third-party update server**.

### 5.1 The core insight

The Capacitor SPA (`dist-capacitor/`) is **pure JS/CSS/assets — zero native code**. So an OTA update *is*
simply shipping a newer `dist-capacitor/` to the installed app. The entire safety problem reduces to:
**"is this new bundle native-compatible with the installed shell?"**

**⚠︎ Policy correction (verified 2026-07-20).** Earlier drafts of this doc and `RESEARCH.md §5` cited
"Apple §3.3.2." That citation is **wrong on two counts**:

- There is **no §3.3.2 in the App Store Review Guidelines.** The relevant Review Guideline is **2.5.2**
  ("Apps should be self-contained in their bundles… nor may they download, install, or execute code
  which introduces or changes features or functionality of the app").
- In the **Developer Program License Agreement** (v. 2026-06-18), **§3.3.2 is now "Regulatory
  Compliance"** (FDA/FAA/FCC) — nothing to do with code. The interpreted-code rule moved to
  **§3.3.1(B) "Executable Code."**

And §3.3.1(B) was **rewritten in a more permissive direction**: the historic requirement that
interpreted code run in "Apple's built-in WebKit framework or JavaScriptCore" has been **deleted
entirely** (0 occurrences of "WebKit" or "JavaScriptCore" in the 117-page agreement). The rule is now
purely behavioural — downloaded interpreted code is fine so long as it (a) doesn't change the app's
primary advertised purpose, (b) doesn't bypass signing/sandbox/OS security, and (c) doesn't create a
storefront for other apps.

**Google Play** names the exemption verbatim: the no-self-update rule *"does not apply to code that
runs in a virtual machine or an interpreter… (such as **JavaScript in a webview** or browser)"* — with
the standing obligation that OTA content must not itself violate Play policy.

> **Net: adaptv's OTA design is squarely inside both stores' rules, and the 2026 DPLA rewrite made
> Apple's position clearer and slightly broader, not narrower.** The hard line is unchanged: web
> assets only. No `.dylib`/`.framework`/`dex`/`JAR`/`.so`, ever — the packer must reject them.

### 5.2 The channel lives in the app's own web deploy

adaptv hosts OTA on the **same origin the web app already deploys to** — no Appflow/Capgo backend:

```
https://app.acme.com/.well-known/adaptv/ota/<channel>/
   manifest.json          → { buildTag, nativeFingerprint, url, sha256, minShell, createdAt }
   bundle-<buildTag>.zip   → the gzipped dist-capacitor/client
```

`adaptv ota build` (§7) produces the zip + manifest and drops them under the web app's `public/` so the
**ordinary web deploy carries them** — literally "the build is saved on every deployment." Channels:
`production` / `staging` / per-PR preview.

### 5.3 The safety gate — `nativeFingerprint`

The crux (the thing Capgo's CLI gets right, `RESEARCH.md §5`). At build time adaptv computes a
**`nativeFingerprint`** = hash of the native surface: the installed Capacitor plugin set + versions +
core version + `appId` + any custom native code. It's baked into **both** the store binary and every OTA
manifest.

- **fingerprint matches** → the JS bundle is compatible with the installed shell → OTA is safe: download,
  verify `sha256`, unpack to a data dir, set as the pending bundle, **apply on next launch**.
- **fingerprint differs** → native surface changed → OTA is **refused**; the updater surfaces "update
  available in the App Store" instead of hot-swapping. This is what keeps adaptv inside **DPLA §3.3.1(B)**
  (per the §5.1 correction — *not* "§3.3.2", which is Regulatory Compliance) and prevents a JS bundle
  from running against an incompatible native shell.

> ### ✅ BUILT (2026-07-20) — `src/ota/policy.ts` + `updater.ts`, 14 tests
>
> **Policy is pure and fully tested; the mechanism is rented.** `decideUpdate`, `selectBootBundle`,
> `selectPrunableBundles` and the watchdog predicate take plain data — no plugin, no filesystem, no
> network — because *when to apply*, *what may be trusted* and *what to roll back to* are exactly the
> decisions whose failure modes are ugly, and they should be verifiable without a device.
>
> Guarded in tests, each for a specific failure:
> - **Native-fingerprint mismatch → refuse.** Not a version check, a *compatibility* check: a bundle
>   calling a plugin the installed binary lacks crashes on a user's device, and OTA bundles never pass
>   review or a staged rollout, so nothing upstream catches it.
> - **Unsigned manifest → refuse** (default). An update channel is a remote-code-execution channel into
>   every installed app.
> - **Pruning never deletes the last known-good.** That retention *is* rollback; removing it turns a bad
>   deploy into a bricked app with no recovery path.
> - **A pending bundle that never pings is failed**, and boot falls back. Silence must read as failure,
>   because a bundle that cannot boot cannot update itself out of that state.
>
> `startOtaUpdates` checks on launch **and on resume** — the resume path matters more, since a mobile
> app is backgrounded far more often than cold-started, and a launch-only check can leave a user stale
> for days. It is a direct consumer of the coordination layer's `onResume`, which exists precisely
> because a native WebView resume is not a browser focus event.
>
> ⏳ **Device verification owed.** The download/unpack/pointer-flip is Capawesome's, and the full
> install → boot → ping → prune cycle can only be exercised on hardware. `markBundleReady()` must be
> called after first paint; forgetting it looks exactly like an update that silently never applies.

### 5.4 Applying, safety, rollback

- **Apply on next launch, never mid-session** — swapping the WebView root under a live app tears its
  state. The download happens in the background (on launch + on **resume** — this is a consumer of the
  `useAppState` resume signal from the coordination layer); the swap happens at the next cold start.
- **Boot watchdog + rollback** — the shell pings "app ready" after a successful boot. If a freshly
  applied bundle doesn't ping within N seconds, the updater reverts to the last-known-good bundle on the
  next launch. Never brick. Keep ≥1 previous good bundle.
- **Integrity** — `sha256` in the manifest is verified before unpack; the manifest should be signed (an
  app-held public key) so a compromised CDN can't push arbitrary JS.

### 5.4b ⚠︎ "Replace in place" is the one thing not to do

A natural way to describe this is *"hit the URL, replace the build in place, next launch is fresh."*
The first and last parts are right; **the middle one must not be literal.**

```
   ❌ overwrite the running bundle dir        ✅ write a NEW dir, then flip a pointer
      bundles/current/  ← unpack over it        bundles/<buildTagA>/   ← last known good
                                                bundles/<buildTagB>/   ← newly downloaded
                                                pointer = B (applied at next cold start)
```

Three reasons the pointer-flip is required, not stylistic:

1. **The running bundle is memory-mapped and actively serving.** Overwriting files under a live
   WebView produces torn reads and undefined behaviour — some chunks old, some new.
2. **Rollback becomes impossible.** §5.4's watchdog reverts to the last-known-good bundle if a fresh one
   fails to ping "app ready." That only works if the previous bundle still physically exists. Overwriting
   destroys the thing you roll back *to*, which converts a bad deploy into a **bricked app with no
   recovery path** — the exact failure OTA must never have.
3. **Interrupted downloads.** Unpacking over the live directory means a connection drop mid-write leaves
   a half-replaced app. Writing to a new dir makes the swap atomic: it either flipped or it didn't.

So: download → verify `sha256` → unpack to `bundles/<buildTag>/` → mark pending → **flip at next cold
start** → keep the previous dir until the new one proves itself. Retain ≥1 known-good bundle; prune
older ones on successful boot.

### 5.4c Minify, don't obfuscate

The production build already minifies — that's the win, and it's free. **Obfuscation is a separate
thing and not worth it here:**

- **It buys no secrecy.** The same bundle is already served publicly to every browser visiting the web
  app. The OTA zip is not exposing anything that wasn't public.
- **It costs the thing OTA needs most: debuggability.** OTA ships code that never touched a reviewer or
  a store rollout. When a bundle boots wrong in the field, the watchdog log and the stack trace are all
  you have — obfuscation makes them unreadable exactly when it matters.
- Source maps then have to be uploaded and matched per bundle to undo the damage.

Ship minified + content-hashed. If a secret is in the bundle, obfuscation doesn't protect it — moving it
server-side does.

### 5.4d 🔴 Signing is not optional — the blast radius is categorically different

`§5.4` says the manifest *"should be"* signed. **Make that a must**, because the failure mode is not
comparable to a normal web compromise:

| Compromise | Web deploy | OTA channel |
|---|---|---|
| Attacker controls | what a visitor sees this session | **code inside every installed app** |
| Persistence | gone on next deploy | **survives; the app re-applies it every launch** |
| Sandbox | browser | the app's own origin, with **every granted native permission** — camera, location, secure storage, biometrics |
| User can escape by | closing the tab | **reinstalling the app** |

A hijacked DNS record or a compromised CDN edge is enough. `sha256` in the manifest protects against
*corruption*, not *substitution* — the attacker rewrites both the bundle and its hash. **Only a
signature the app verifies with a public key baked into the store binary breaks that.**

Practical shape: sign the manifest with an offline private key; embed the public key in the native
shell (so it can only change via a store release); verify before unpack; refuse and keep the current
bundle on mismatch. Support a second "next" public key in the shell so the signing key can be rotated
across one store release without bricking updates.

### 5.5 Own the policy, rent the swap

Per doctrine (`ARCHITECTURE.md §0.6`: rent stable cores, own seams) and `RESEARCH.md §5` ("don't DIY the
bundle-swap blindly"): adaptv **owns** the channel convention, the manifest schema, the `nativeFingerprint`
gate, the watchdog/rollback policy, and the resume-driven check; adaptv **rents** the low-level
`WebView.setServerBasePath` bundle-swap rather than hand-rolling the native file juggling.

**🔒 Plugin pick: `@capawesome/capacitor-live-update` (MIT, 8.3.0)** — per `DECISIONS.md` **O8**.

| Option | License | Status |
|---|---|---|
| **`@capawesome/capacitor-live-update` 8.3.0** | **MIT** | ✅ **Pick.** Genuinely backend-free, and the **strongest signature story (RSA PEM + SHA-256)** — which is decisive now that §5.4d makes signing mandatory rather than optional. |
| `@capgo/capacitor-updater` 8.51.2 | **AGPL / commercial dual** | Healthier raw metrics (810★, 2 open issues) and its CLI already does fingerprint detection — but **AGPL is disqualifying for a framework that ships to consumers.** Fallback only, under the commercial licence. |
| `@capacitor/live-updates` (Appflow) | — | ❌ **Ruled out** — no new sales since 2025-02-11, sunsets 2027-12-31. |

**Two traps that must be encoded, not discovered:**

1. **Capawesome defaults `readyTimeout` to `0`, which means rollback is _disabled_.** adaptv must force a
   non-zero value — otherwise §5.4's watchdog silently doesn't exist and a bad bundle bricks the app.
2. **iOS persistence requires conforming to `Library/NoCloud/ionic_built_snapshots/<id>/`.** Deviate and
   the bundle silently fails to persist across cold launch — it appears to work in testing and fails in
   the field.

**What adaptv still owns regardless of the pick:** the `.well-known` channel convention, the manifest
schema, the `nativeFingerprint` computation, signature verification (§5.4d), the boot watchdog, and the
resume-driven check. The plugin is only the file-juggling + `serverBasePath` layer, which keeps the swap
replaceable — if Capgo's licensing or health changes, the seam is one module wide. If neither plugin
fits, the DIY path (download → verify → unpack to a new dir → flip pointer → apply next launch) is the
documented fallback.

---

## 6. Opting out of native (Capacitor) — web-only apps

**Omit `native.appId` and the app is web-only, full stop:**
- No `capacitor.config.json` is stamped, no `android/` or `ios/` project, no `dist-capacitor/`.
- The `adaptv` CLI's native commands (`run`/`build`/`sync`/`assets`) refuse fast: *"needs an `appId`."*
- `vite build` produces the normal web/PWA output (`dist/`) exactly as in §4 — SSR or static SPA per §3.
- The Capacitor plugins are **optional peer deps**, so a web-only app never installs them.

And the inverse guarantee the goal asks for: **a web build never produces or serves the Capacitor SPA.**
`dist-capacitor/` + `capacitor.config.json` materialize *only* under `ADAPTV_TARGET=capacitor`, which only
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
| `adaptv run <ios\|android\|all> [--target id] [--latest] [--verbose]` | build SPA (`ADAPTV_TARGET=capacitor`) → brand icons/splash → `cap sync` → `cap run` on device/sim. `all` = both, **in parallel** |
| `adaptv build <ios\|android\|all> [--output path] [--verbose]` | …sync → `gradlew assembleDebug` (**debug `.apk`**) / `scripts/build-ipa.sh` (**unsigned `.ipa`**). Artifact lands at `--output` or `.adaptv/<app>.apk`\|`.ipa` |

`sync` and `assets` are no longer standalone commands — they're internal steps of `run`/`build`.

**Native projects live in `.adaptv/`.** `cap add`/`sync`/`run` are pointed at `.adaptv/ios` and
`.adaptv/android` via `android.path`/`ios.path` in the generated `capacitor.config.json` (relative to the
app root, where `cap` reads it). So *everything* adaptv generates — the route tree and both native
projects — sits under one hidden, git-ignored dir, regenerated like `dist/`. A legacy app-root
`ios/`/`android/` is migrated into `.adaptv/` on the next run.

**Device targeting.** adaptv owns the picker (rather than Capacitor's opaque one) so it can cache your
choice: `run` lists targets via `cap run <platform> --list --json`, shows a branded arrow-key picker, and
writes the pick to `.adaptv/devices.json`. `--target <id>` selects directly (and caches); `--latest`
reuses the cached device (falling back to the picker if none). *Listing requires the platform to exist,
so `run` prepares the native project **before** resolving the target.*

**Branded output.** Every long-running step (vite/cap/gradle/xcode/pod) is **captured**, not inherited —
rendered as calm phased steps (a small custom spinner renderer; `@clack/prompts` only for the device
picker) with a spinner + elapsed time. Inner
logs are hidden unless a step fails (then a log tail is shown) or `--verbose` is passed (full raw
passthrough). `run all` renders the two platforms as concurrent columns; a non-TTY / CI shell degrades to
plain prefixed lines.

Every native build runs the same spine: **`buildWeb(capacitor)` → `generateAssets` → `capSync` → (launch
/ package)**. Icons come from `@capacitor/assets`; the splash is colour-driven (Android launch theme +
`colors.xml`/`colors-night.xml`; iOS colour asset + solid storyboard) and re-applied idempotently every
sync (`BEHAVIORS.md §3`).

> **`adaptv run web`** is reserved for a future Vite dev/preview wrapper (adaptv is Vite-based). For now
> use the app's `vite dev` / `vite preview`. Web *deploy* stays out of the CLI by design — it's the
> host's tool, driven by `web.host`.

### 7.2 Testing native builds

The native test loop is `adaptv run <platform>` onto a simulator/emulator (both available locally),
against the six-target discipline in `TESTING.md`. ⚠︎ *Future:* a `adaptv e2e` that drives the sim/emulator
(Maestro/Appium or the simulator MCP) so the native matrix can run in CI — out of scope for this pass,
flagged in `VISION.md §9`.

### 7.3 Signing & distribution

- **Android:** debug `.apk` is fully automated. Release signing (keystore) is the user's — a `adaptv build
  android --release` that reads a keystore from config/env is a reasonable ⚠︎ future add.
- **iOS:** only the **unsigned** `.ipa` is automatable (`adaptv build ios` → `scripts/build-ipa.sh`);
  signed TestFlight/App Store builds stay in Xcode ▸ Archive (signing identities/provisioning are
  Apple-account state adaptv shouldn't hold). adaptv stops at the artifact — it does not own fastlane
  (⚠︎ open question in `VISION.md §9`).

### 7.4 ⚠︎ Delta — designed additions

| Command | Purpose |
|---|---|
| `adaptv dev [--host ios\|android]` | §2.2 — unified dev entry with device live-reload |
| `adaptv ota build [--channel c]` | §5 — build `dist-capacitor` + compute `buildTag`/`nativeFingerprint` + write manifest + zip into the web `public/.well-known/adaptv/ota/<channel>/` |
| `adaptv ota status` | inspect the current channel manifest vs the installed build |

Web deploy stays **out** of the CLI on purpose (§4.2) — it's the host's tool, driven by `web.host`.

---

## 8. ⚠︎ `create-adaptv` — scaffolding (roadmap #3)

`pnpm create adaptv` (a separate package / `bin`) emits a ready app so the lifecycle starts from a correct
baseline, not hand-assembly:
- `adaptv.config.ts` (with a `web` block, optional `native.appId`, optional `ota`).
- `vite.config.ts` with a single `adaptv()` call.
- A `routing/` dir + one example `View`-rooted route (§`ARCHITECTURE.md §1`).
- `src/sw.ts`, `src/styles/main.css`, `assets/logo.png` placeholder.
- Scripts wired to `adaptv dev` / `vite build` / `adaptv run`.
- Optionally scaffolds `android/`/`ios/` on first `adaptv sync` rather than at create time (keeps the repo
  lean; native projects are regenerable from config).

---

## 9. Lifecycle at a glance

```
CONFIGURE   adaptv.config.ts  ── web{render,host,sw} · native{appId} · ota{channel}
                │
DEVELOP     adaptv dev [--host ios|android]        (HMR; live-reload on device)
                │
BUILD  ┌── web:      vite build ──────────────→ dist/         (SSR+SW | static SPA+SW)
       └── native:   adaptv run|build|sync ─────→ dist-capacitor/ → cap → APK | IPA
                │
DEPLOY ┌── web:      host tool (wrangler/vercel/node/static bucket)
       └── native:   sideload IPA/APK · TestFlight/Store (Xcode signing)
                │
UPDATE ┌── web/PWA:  SW revalidate                (free)
       └── native:   adaptv ota build → manifest+bundle rides the web deploy;
                     app checks on launch/resume → fingerprint-gated swap → apply next launch
```

**The invariant:** one config, one codebase; two build lineages that never cross; each target gets the
delivery + update mechanism that is correct for it, chosen by adaptv, tunable only where the choice is
legitimately the developer's (`web.render`/`host`/`sw`, `ota.channel`, native opt-out).
