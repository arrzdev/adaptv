# adaptv — the decision register

> **The single answer to "what's decided and what isn't."** Every architectural call the framework
> rests on, with a status, the evidence behind it, and where the full design lives.
>
> Statuses: **🔒 LOCKED** (decided, don't re-litigate) · **📐 DESIGNED** (fully specced, not built) ·
> **🔀 CONFLICTED** (two docs/code disagree — must be resolved) · **❓ OPEN** (genuinely undecided).
>
> Started **2026-07-20**. This doc supersedes the scattered "decisions" sections in `HANDOFF.md`
> and `VISION.md §9`.

---

## 0. How to read this

`README.md`/`HANDOFF.md` answer *"what's built."* This doc answers *"what's settled."* They are
different questions and were being conflated: several things are **built but never decided** (the
styling contract), and several are **decided but contradicted elsewhere** (TanStack opacity).

A decision is only LOCKED when (a) it's written down here, (b) no other doc or code contradicts it,
and (c) the rationale survives being asked "why not the opposite?"

---

## 1. Codebase state — the audit (2026-07-20)

Verified by reading the tree, not by trusting the docs.

### 1.1 What's actually in `src/` (145 files)

| Area | Files | Reality vs README |
|---|---|---|
| `components/` | 19 primitives + tests | **Ahead of the README.** `Input`, `TextArea`, `Checkbox`, `Switch`, `WheelColumn`, `EdgeSwipeGestures`, `OrientationGuard`, `PwaSplashOverlay`, `NotFound` all exist and are exported — the README lists several as "not done." |
| `capabilities/` | 9 (haptics, keyboard, network, status-bar, geolocation, splash, browser, native-theme) | matches |
| `hooks/` | 22 | ahead — includes `useCaretRepaint`, `useFreezeViewport`, `useGlobalFpsSentinel`, `useSuppressTextMagnifier`, `useScrollDirectionLock`, `useGestureEngine` |
| `sw/` | 13 modules | **far ahead of the docs** — a full hand-rolled Workbox SW (precache, strategies, expiration, navigation, warm-routes, cache-name, lifecycle) |
| `vite/` | 15 | plugin, config loader, capacitor-config, manifest, stamping, sw-build, build-tag, virtuals |
| `shell/` | 10 | root route, critical CSS, head, launch-viewport, standalone history, foreign-SW unregister |
| `styles/` | 5 CSS files | `patches.css`, `utils.css`, `drawer.css`, `swipeable.css`, `index.css` |
| `bin/adaptv.mjs` | 845 lines | full native toolchain CLI |

**Conclusion: adaptv is substantially more built than `README.md` claims.** The README's "not done"
list is stale on primitives; it's accurate on `.adaptv/`, `@adaptv/shell`, `create-adaptv`, OTA, and the
dist build.

### 1.2 Migration from chopchop is COMPLETE — verified

File-level diff of `chopchop/packages/adaptv/src` (110 files) against `adaptv/src` (145 files):

- **0 files exist in chopchop that are missing from adaptv.**
- 34 files exist only in standalone adaptv (the whole `capabilities/` layer, `View`, `List`, `Link`,
  `ExternalLink`, `critical-css`, `capacitor-config`, `utils/styles.ts`, `platform.test.ts`).
- 88 of the 110 shared files are **byte-identical**; 22 diverged — and standalone adaptv is the
  *longer/newer* side on 21 of 22 (`platform.ts` 8→96 lines, `app-config.ts` 208→244,
  `shell-layout.tsx` 172→193, `button.tsx` 507→528, `adaptv-plugin.ts` 132→158, `utils.css` 85→98).

> **🔒 LOCKED — there is no un-migrated "gold" left in chopchop.** The standalone repo is strictly
> ahead. `chopchop/packages/adaptv` should be treated as **dead** and deleted when chopchop is wired
> as project-0. The one file where chopchop is longer (`create-root-route.tsx`, 211→203) is a
> refactor, not a loss — but diff it once before deleting.

### 1.3 The "patches" question — answered

The user's "old pwa/adaptv package patches" = the `patches` block in `adaptv.config.ts`, and **all of
it is migrated and live**:

| Patch | Config flag (default `true`) | Implementation |
|---|---|---|
| iOS caret-repaint ghost caret | `patches.caretRepaint` | `hooks/use-caret-repaint.ts` + `[data-caret-muted]` rule in `patches.css` |
| iOS double-tap text magnifier (WebKit bug 231161) | `patches.textMagnifier` | `hooks/use-suppress-text-magnifier.ts` |
| Viewport freeze (scroll pin + virtualKeyboard overlay, refcounted) | `patches.viewportFreeze` | `hooks/use-freeze-viewport.ts` |
| GPU layer promotion on FPS drop | `patches.gpuBoost` | `hooks/use-global-fps-sentinel.ts` + `html[data-gpu-boost] .hardware-boosted` |

Plus the **unflagged, always-on** `patches.css` sheet: global no-select (with `input`/`textarea`
opt-back-in), scrollbar suppression, hover-stickiness fix on touch (`@custom-variant hover` that
excludes `:focus`), autofill yellow-background kill, `-webkit-touch-callout` / tap-highlight
suppression on anchors, native focus-ring reset, `type=search` decoration removal.

> ❓ **OPEN:** the always-on rules in `patches.css` are **not** behind `patches.*` flags and several
> are aggressive (`* { user-select: none !important }`, `* { scrollbar-width: none !important }`).
> Decide whether these become flags too, or are declared doctrine. See §3.1.

### 1.4 The splash question — answered: fully migrated, and more complete than documented

Every piece of the custom-splash-over-masked-native-splash design is in the repo:

- **Android:** `Theme.SplashScreen` + `windowSplashScreenBackground` → `@color/adaptvSplashBackground`,
  with `values/colors.xml` + `values-night/colors.xml`, and a **transparent `splash_icon.xml`
  drawable** to strip the Android-12 system splash icon. `postSplashScreenTheme` hands off.
  (`bin/adaptv.mjs:368` `patchAndroidSplash`)
- **iOS:** a `AdaptvSplash` colorset + a **solid-colour `LaunchScreen.storyboard`** (no image, so
  there's no first-frame resolve flicker), plus an `AppDelegate` override when the mask follows the
  app preference. (`bin/adaptv.mjs:487`)
- **Theme tracking:** `persistNativeThemePreference` seeds native storage with the app's theme so the
  *next* launch's OS splash colour is already right (1-launch, no "open it twice"), applied at
  startup **and** live via a SharedPreferences listener.
- **Handoff:** `launchShowDuration`/`launchAutoHide` hold the OS splash; `RoutingShell` calls
  `hideNativeSplash()` after first paint → no gap, no double-splash.
- **Policy:** `splashMaskMode: preferences | system | light | dark`.
- **Browser gate:** critical CSS hides `[data-adaptv-splash]` on `html[data-adaptv-platform="web"]`
  unless `splashScreenInBrowser` — pre-paint, so no flash and no hydration mismatch.
- **The subtle one:** `getLaunchViewportInitScript()` measures resolved `100vh` with a hidden probe
  and freezes `--pwa-launch-height`, defeating the **iOS standalone cold-start ICB expansion** that
  re-centres a splash downward mid-launch.

> 🔒 **LOCKED — splash is done and is one of adaptv's strongest assets.** No migration work remains.
> The only delta is that `@adaptv/shell` (§4.3) should eventually absorb the CLI's native-source
> string-patching.

---

## 2. Locked decisions (do not re-litigate)

| # | Decision | Where |
|---|---|---|
| L1 | **Single-package repo.** Root *is* the framework. Promote to `packages/*` only when the native plugin or `create-adaptv` need separate publishing. | HANDOFF §6 |
| L2 | **No hard forks.** Rent stable cores, own the seams. Escalation ladder: re-export barrel → `.adaptv/` → `pnpm patch` → vendor one module → replace a layer. | ARCHITECTURE §0.6 |
| L19 | **`pnpm patch` is a first-class tool, not a last resort.** When a dependency structurally blocks something adaptv needs, patching it is the *correct* move for a framework built on other libraries — not a smell to be avoided. Supersedes §2.6's "reserve, don't wire up" for `pnpm patch` specifically. Decided by the owner, 2026-07-20. | §2.6a below |
| L3 | **Isomorphic-only.** No `createServerFn`, no server routes, no server-only request/cookie reads. Loaders/`beforeLoad` are *Router* features and are allowed. **Ban server-only calls, not loaders.** | RENDERING §2 |
| L4 | **Edge-to-edge is always on**, never a toggle. The consumer picks which edges a surface pads (`View safe=…`), never whether edge-to-edge happens. | ARCHITECTURE §1.4 |
| L5 | **Frame owned above the route; one `View`, no `Screen`.** RN's navigator model — the shell seeds a full-viewport slot and stretches its child; `View` is a dumb-correct `flex-col` box. Root-ness never comes from DOM sniffing. | ARCHITECTURE §1 |
| L6 | **Behavior is props, presentation is `className`.** `<View scroll="y">`, not `className="overflow-y-auto"`. | VISION §2.2 |
| L7 | **Guardrails teach, never mutate.** Catch misuse with a build-time error + dev-only runtime warning — never silently rewrite consumer code. | VISION §2.3 |
| L8 | **One config source.** `adaptv.config.ts` generates the manifest, `capacitor.config`, native projects, splash, icons, theme. No second config file. **Icons are the worked example (2026-07-28):** ONE directory (`icons`), read ONCE (`src/vite/icon-set.ts`), measured rather than name-parsed, and derived into all three surfaces — web manifest, head links, native launcher art. The three used to compute it separately and had drifted: the manifest took only `android-*` names and trusted the size written in them, the head hardcoded twenty `/favicons/*` links regardless of the config key or whether the files existed, and only the native side actually looked. An app with no usable art wears **adaptv's own mark**, never Capacitor's stock icon, and `adaptv gen icons <image>` produces the whole set from one image. | VISION §2.5 |
| L9 | **Reactive → hook, imperative → API.** Live watches are hooks over a `subscribe`/`get` accessor (so non-React consumers can subscribe); one-shot reads are async fns. | VISION §2.6 |
| L10 | **Storage = three tiers** under `storage`: sync `kv` (MMKV model), async `store` (blob KV, **not** an ORM), async `secure` (Keychain/Keystore native; **best-effort, not secure, on web**). | ARCHITECTURE §2 |
| L11 | **Hybrid primitives push the platform branch to the lowest layer.** The accessor is the only hybrid file; it returns native-*accurate data*, not machinery. Geometry is DOM-free and unit-tested. | ARCHITECTURE §4 |
| L12 | **`target:capacitor` is absolute** — always `render:"spa"` + `sw:false`, regardless of config. Only the CLI sets it. | LIFECYCLE §3.1 |
| L13 | **Native OTA is self-hosted** on the app's own web deploy (no Appflow/Capgo backend), `nativeFingerprint`-gated, applied next launch, resume-triggered, watchdog rollback. Own the policy, rent the swap. | LIFECYCLE §5 |
| L14 | **Two build lineages that never cross.** `dist-capacitor/` materialises only under `ADAPTV_TARGET=capacitor`. A web build can never ship the native bundle. | LIFECYCLE §0, §6 |
| L15 | **Native opt-out is `native.appId` presence.** No appId → no capacitor config, no native projects. ~~Capacitor plugins are optional peers~~ **Superseded 2026-07-25 (see L20):** Capacitor — the CLI, both native platforms, and the base plugins the primitives need — is now adaptv's **own dependency**; the consumer installs no `@capacitor/*`. adaptv resolves it from the framework and injects the plugin pods/gradle into the native project it owns. Extra plugins are registered via `adaptv.config.ts` `plugins`, not by touching Capacitor. | LIFECYCLE §6 |
| L16 | **Splash doctrine** — native splash = solid colour mask (mascot lives only in the React splash); React splash = installed-only (browser opt-in); mask follows app theme by default. | §1.4 above |
| L17 | **Migration from chopchop is complete**; `chopchop/packages/adaptv` is dead. | §1.2 above |
| L18 | **App-lifecycle spine build order:** `useAppState` → back priority chain → gesture controller → route lifecycle (no DOM retention). | COORDINATION |
| L20 | **Underlying packages — and any change adaptv makes to them — are invisible to the consumer.** The consumer doesn't know adaptv runs on TanStack Start/Router + Capacitor, and must never be asked to name, install, configure, or *patch* one of them. Any modification adaptv needs in a dependency it applies **itself**, through a mechanism it fully owns — an owned Vite plugin, native-project injection, in-process CLI invocation, or a vendored module — **never** by asking the consumer to add `pnpm.patchedDependencies`. **The forcing function is technical, not just aesthetic:** pnpm applies `patchedDependencies` only from the *installing project's root manifest*, so a library literally cannot deliver a working patch to its consumers — consumer-invisible ownership is therefore the *only* design that works, not merely the nicer one. Refines **L19**: `pnpm patch` stays first-class for adaptv's **own** repo/dev, but is never the consumer-facing delivery path. Embodied by: the route-tree rewrite (adaptv's own Vite plugin post-processes `routeTree.gen.ts`, replacing the old consumer-side generator patch) — which covers **every** mention, not just imports: the generator also signs the header `// automatically generated by TanStack Router.`, and that file is one the consumer reads, so it says `adaptv` too. `assertRouteTreeIsOpaque` asserts the property itself (`/@tanstack\/|tanstack router/i`), not a specifier-only proxy, so the next leak in a comment fails the build instead of shipping; Capacitor plugin wiring on **both** platforms — adaptv injects the native project it owns rather than relying on Capacitor's app-`package.json` discovery: the Podfile + `packageClassList` on iOS, and `capacitor.settings.gradle` + `app/capacitor.build.gradle` + `app/src/main/assets/capacitor.plugins.json` on Android (`injectAndroidPluginProjects`, added **2026-07-30** — Android had no equivalent for the whole life of the target, so 12 of adaptv's 13 plugins were never compiled into the APK and every native capability silently ran its web fallback; guarded now by `scripts/native-plugin-smoke.mjs`, which asserts on-device that every plugin adaptv depends on is registered). Note the tempting one-line alternative does **not** work: Capacitor's own `includePlugins` config key resolves each named package from the *app* root, which under pnpm cannot see adaptv's dependencies — it `fatal`s instead of syncing, and only appears to work in this repo because the playground sits inside adaptv's own tree; and **no `capacitor.config.json` in the consumer's project at all** — adaptv patches `@capacitor/cli` to read its config from the `ADAPTV_CAPACITOR_CONFIG` env var (in-memory, generated from `adaptv.config.ts`), and ships a **vendored shim** (`bin/lib/cap.mjs`) that recreates that behaviour in-process for a *published* consumer whose cap the pnpm patch can't reach (fs-read interception) — so cap bakes the only config copy into the native project itself. This last one is the canonical worked example of the whole doctrine: a patch adaptv applies + vendors, invisible to the consumer, on a package they don't know they depend on. Decided by the owner, **2026-07-25**. | §2 (this table) |
| L21 | **Upstream versions are pinned exact; patches are version-keyed.** Every direct dependency and peer is pinned to an exact version (no `^`/`~`) and the lockfile is committed, so an upstream release can never break a fresh install. Because a `pnpm patch` (L19) is written against ONE version's code, its `patchedDependencies` key carries the exact version (`pkg@x.y.z`, not bare `pkg`) — if the resolved version ever drifts, pnpm fails the install **loudly** instead of applying the patch to changed code. This makes bumping a rented+patched core a deliberate act: update the pin, re-verify the patch against the new source, update the version key. The guardrail is most critical precisely where L19/L20 lean hardest on patches. The patch **filename encodes that key** (`@tanstack__router-generator@1.166.22.patch` → `'@tanstack/router-generator@1.166.22'`), so the install instructions adaptv shows a consumer are derived from the patches that actually shipped rather than restated by hand — an unversioned filename is refused, not silently advertised. Decided by the owner, **2026-07-25**. | `pnpm-workspace.yaml`, `src/vite/verify-patches.ts` |

---

## 3. 🔀 Conflicts that must be resolved

These are the dangerous ones: two authoritative sources disagree, so "the decision" depends on which
doc you read.

### 3.1 🔀 The styling contract is built but never decided

- `VISION.md §9` lists **"Styling system"** as an *open question* ("Leaning: keep Tailwind").
- But `src/utils/styles.ts` already implements a **three-layer precedence contract**:
  `mergeStyles({ base, className, locked })` → `base < className < locked`, riding on
  tailwind-merge's last-wins resolution.
- **And only 2 of 19 components use it** (`view.tsx`, `external-link.tsx`). The other 17 use bare
  `cn()`, so the "consumer can't break structural classes" guarantee is **not actually enforced**.
- No doc in `docs/` mentions `mergeStyles` at all.
- There is **no theming token layer** — no `--adaptv-*` custom properties, no colour system, no
  per-component style hooks. Consumers restyle by throwing Tailwind classes at primitives and hoping
  tailwind-merge resolves correctly.

> **Resolution owed: `docs/STYLING.md`** — the full styling & theming contract. This is the single
> biggest undecided surface in the framework. See §5.

### 3.2 🔀 TanStack opacity — two contradictory decisions, and the older one has the evidence

| Source | Date | Decision |
|---|---|---|
| `chopchop/HANDOFF-adaptv.md` "FINAL DECISION" | 2026-07-06 | **The honest split.** TanStack is a *named engine dependency* (the Expo↔react-native model). Import `@tanstack/*` directly for anything adaptv doesn't wrap. The pure pass-through barrel was **deleted**. |
| `adaptv/docs/ARCHITECTURE.md §3` | 2026-07-14 | **Opacity, not absence.** Consumer imports only `adaptv`; generated files hidden in `.adaptv/`. Roadmap **#1**, "the biggest 'feels like a real framework' win." |

The 07-06 decision is backed by **tested evidence** the 07-14 doc doesn't acknowledge:

- **TESTED 2026-07-05:** augmenting the adaptv re-export barrel (`declare module "@repo/adaptv/react-router"`)
  does **not** merge into `@tanstack`'s interface. TS binds augmentation to the *declaration site*.
  Probe: `"__marker__" extends keyof Register` → **`false`**. A re-implemented generator targeting
  adaptv would **silently break typed routing**.
- **OBSERVED LIVE:** the router plugin *auto-maintains* the `createFileRoute` import — edit it to the
  adaptv seam and the plugin re-adds the `@tanstack` line (duplicate import).
- **BUT — Path X was spike-proven** against real `@tanstack/react-router` 1.168.8: if the adaptv seam
  declares its **own** `Register` + `FileRoutesByPath` and re-types `useRouter`/`useNavigate`/
  `createFileRoute` to default to `RegisteredRouter<Register>`, typed routing works end-to-end
  (`Link({to:"/nope"})` correctly errors `TS2322`). Feasibility is *settled*; only the wiring is unbuilt.
- The identified wiring: `verboseFileRoutes:false` + replace TanStack's `route-autoimport-plugin`
  (it injects a hardcoded `@tanstack/react-router`) with a adaptv one + post-process
  `routeTree.gen.ts` on disk after the generator writes it.

`ARCHITECTURE.md §3.3` frames the spike as **"Virtual File Routes vs `pnpm patch`"** — but the
chopchop evidence says *neither* is the mechanism. The real mechanism is the autoimport-plugin swap
+ generator post-processing.

> ### 🔬 SPIKE RESULT (2026-07-20) — reproduced against project-zero, and it is worse than recorded
>
> Switching one real route file to `import { createFileRoute } from "@repo/adaptv/router"` and building
> **fails**, with the file on disk ending up holding two imports of the same binding. Three separate
> mechanisms are involved, and the 07-05 note only identified the first:
>
> | # | Mechanism | Evidence |
> |---|---|---|
> | 1 | **`tanstack-router:autoimport`** transforms any file matching `createFileRoute(`, checks whether it was imported from the literal `@tanstack/<target>-router`, and prepends the import if not. A re-export is invisible to it. | read from `@tanstack/router-plugin/dist/esm/core/route-autoimport-plugin.js` |
> | 2 | **The route generator ALSO maintains the import, on disk.** With the autoimport plugin stripped entirely, the `@tanstack/react-router` line still came back into the source file after a build. | observed by diffing the file before/after |
> | 3 | **A replacement plugin double-fires on derived modules.** At `enforce:"pre"` it also transforms the code-splitter's virtual files, where the import has been stripped — re-adding one that then collides. | `Identifier 'createFileRoute' has already been declared`, in files that were correct on disk |
>
> **The unlock for (3) is in upstream's own source:** it gates on
> `globalThis.TSR_ROUTES_BY_ID_MAP?.has(normalizedId)`, populated by the generator, which identifies
> *real* route files. Any replacement must gate the same way.
>
> **(2) is the genuinely open one.** `@tanstack/router-generator`'s config exposes
> `plugins: GeneratorPlugin[]` and `verboseFileRoutes` — unexplored, and the most likely lever.
>
> **Status:** `src/vite/router-autoimport.ts` ships the analysis + pure decision functions (17 tests) but
> is **deliberately not wired** — wiring it in this state breaks every route file. The curated barrel
> (`@arrzdev/adaptv/router`) ships and is usable today for everything *except* `createFileRoute`.

> ### 🚧 BLOCKER FOUND (2026-07-20) — Start structurally forbids the one lever that works
>
> **Requirement (owner, explicit): zero `@tanstack/*` imports anywhere in a consumer app — route files,
> `.adaptv/router.gen.tsx`, and `.adaptv/routeTree.gen.ts` alike. Everything points at `adaptv`.**
>
> The generator's own import policy is the right lever, and it exists. Read from
> `@tanstack/router-generator/dist/esm/transform/transform.js`: route-file imports are maintained by a
> `{ required, banned }` policy, and the **`verboseFileRoutes === false`** branch *bans*
> `createFileRoute`/`createLazyFileRoute` from `@tanstack/<target>-router` and requires nothing. That is
> precisely what adaptv wants — the generator would strip the import, and adaptv's replacement autoimport
> plugin would supply the binding from the adaptv barrel instead.
>
> `@tanstack/router-plugin` even gates its autoimport plugin on it:
> `if (userConfig.verboseFileRoutes === false) result.push(...routeAutoImport)`.
>
> **But TanStack Start removes the option from its schema**, in `start-plugin-core/dist/esm/schema.js`:
>
> ```js
> var tsrConfig = configSchema.omit({ autoCodeSplitting: true, target: true, verboseFileRoutes: true }).partial()
> ```
>
> Zod `.omit()` **drops the key**, so passing `verboseFileRoutes: false` through `tanstackStart()` is
> silently discarded — no error, no warning. Start then builds the generator config as
> `{ ...routerConfig, target, routeTreeFileFooter, plugins }` where `routerConfig` is the parsed
> (key-less) object, so the generator applies its own default of `true`. **Verified by building:** with
> the option "set", route files still had the `@tanstack/react-router` import re-added on disk after
> every build, including files where it had just been deleted.
>
> The generator's `plugins: GeneratorPlugin[]` hook does **not** help — its three hooks (`init`,
> `onRouteTreeChanged`, `afterTransform`) are purely observational; none can alter emitted output.
>
> **Two viable paths, both real, neither free:**
>
> | Path | Cost |
> |---|---|
> | **A — `pnpm patch` `@tanstack/start-plugin-core`** to stop omitting `verboseFileRoutes`. A one-line, surgical patch of a schema `.omit()` list. L2's escalation ladder explicitly allows patching as a rung, but §2.6 currently says "reserve, don't wire up", and pnpm 11 hard-fails installs on patch drift. | one line to maintain per Start upgrade |
> | **B — post-process on disk** after the generator writes, rewriting `@tanstack/react-router` → the adaptv barrel in route files and `routeTree.gen.ts`. No patch, but it is a *fight*: the generator rewrites on every run, so adaptv must always run after it and win. | ongoing race, must be re-won each build |
>
> **A is the honest recommendation** — it removes the fight at the source, and the patch is one line
> against a schema list rather than against behaviour. This is now the gating decision for the whole
> facade and should be settled before any further primitive work.
>
> **Shipped meanwhile:** `src/vite/router-autoimport.ts` (analysis + pure decision functions + the
> `TSR_ROUTES_BY_ID_MAP` gate that stops the double-fire on code-splitter virtual modules, 17 tests),
> wired into `adaptv()` and harmless today — with `verboseFileRoutes` stuck at `true` the generator keeps
> supplying the import, so adaptv's plugin correctly does nothing.

> **Resolution owed: `docs/FACADE.md`** — pick one, fold in the 07-05/07-06 evidence, and correct
> `ARCHITECTURE.md §3.3`'s framing of the spike. See §5.

### 3.3 🔀 `web.render` default: docs say SSR, code says SPA

- `RENDERING.md §1`: "Web can be SSR *or* SPA — a per-app config choice, **SSR by default**."
- `LIFECYCLE.md §1.2` flags this itself: "⚠︎ the code currently defaults `router.render` to `spa`."
- Code confirms: `src/config/app-config.ts:66` — *"Rendering mode. Default `"spa"`"*; and
  `src/vite/adaptv-plugin.ts:107` — `const isSpa = (router.render ?? "spa") === "spa"`.

> **Resolution owed:** pick one and make code + docs agree. See §5 — recommendation is **SPA-default**,
> against the current docs.

### 3.4 🔀 SW navigation strategy: docs say shell-fallback, code does NetworkFirst

- `RENDERING.md §3`: *"precache assets + a **navigation-fallback to the app shell**"*, and explicitly
  calls caching SSR'd HTML **"a trap."**
- `src/sw/sw.navigation.ts` implements the trap: `createPagesNetworkFirstStrategy` caching navigation
  documents into a `pages-<buildTag>` bucket, with `matchPrecache` only as a last-resort offline
  fallback. Plus `sw.warm-routes.ts` **pre-fetches HTML documents at install time**.

These are different architectures. The code may well be right (an SSR app *does* want fresh
documents) — but the doc calls it a trap, so one of them is wrong.

> **Resolution owed:** reconcile in `RENDERING.md §3`. Note the code's warm-routes fetch uses
> `credentials: "same-origin"` into a **shared** cache with `ignoreVary: true` — a real
> **privacy/correctness risk** for authenticated SSR HTML. Flag as a bug regardless of the outcome.

### 3.5 🔀 `Screen` — documented as removed, still shipped

`ARCHITECTURE.md §1.2`: *"`Screen` is **removed**. It was never in the public barrel."*
Reality: `src/components/screen.tsx` exists, `src/components/screen.test.tsx` exists, and
`src/interface/components.index.ts` **exports it**. `VISION.md §5` still documents `Screen` as a
primary primitive with `Screen.Header`/`Screen.Footer`.

> **Resolution owed:** delete it (per L5) and strip it from `VISION.md §5`, or un-decide L5.

---

## 4. 📐 Designed but not built

Full designs exist; the next step is TDD, not more design.

| # | Item | Design | Risk |
|---|---|---|---|
| D1 | `.adaptv/` hidden generated dir + `adaptv` barrel | ARCHITECTURE §3 | blocked on §3.2 |
| D2 | First-party `@adaptv/shell` Capacitor plugin (edge-to-edge + insets/IME, then splash/status-bar/theme) | NATIVE-SHELL | **HIGH** — the Android-15/SDK-35 inset+keyboard crux |
| D3 | `create-adaptv` scaffolder | LIFECYCLE §8 | low |
| D4 | `web` config block (`render`/`host`/`sw`) → Start deploy presets | LIFECYCLE §1.2, §3–4 | low |
| D5 | Capacitor OTA (fingerprint-gated self-hosted bundle swap) | LIFECYCLE §5 | medium — plugin pick open |
| D6 | `adaptv dev [--host ios\|android]` with device live-reload | LIFECYCLE §2.2 | low |
| D7 | `adaptv ota build` / `ota status` | LIFECYCLE §7.4 | medium |
| D8 | `useAppState` accessor + hook | COORDINATION | low |
| D9 | Back-button priority handler chain | COORDINATION | low |
| D10 | Global gesture controller (single-capture arbitration) | COORDINATION | medium |
| D11 | Route lifecycle (enter/leave, no DOM retention) | COORDINATION | medium |
| D12 | Published `dist` build + `.d.ts` | — (mechanical) | low |

---

## 5. ❓ Open — the questions this research pass must close

| # | Question | Resolution | Status |
|---|---|---|---|
| O1 | **Styling & theming API** | **`className` + 3-layer `mergeStyles` precedence · `data-adaptv`/`data-part` two-axis state namespace · custom properties for runtime values ONLY · `@layer` so consumer CSS always wins · tokens = the consumer's Tailwind `@theme`. No `--adaptv-color-*`, no `::part()`.** Rationale: Ionic's `--ion-*` system exists to cross a *shadow boundary* adaptv doesn't have. → `STYLING.md` | ✅ **CLOSED** |
| O2 | **TanStack facade** | **Tier 1 (curated barrel, TanStack as a named engine dep) ships now; Tier 2 (full opacity) deferred.** Key insight: safety and opacity are **orthogonal** — you don't need to hide TanStack to ban `createServerFn`. → `FACADE.md §1, §3` | ✅ **CLOSED** |
| O3 | **Enforcing the `createServerFn` ban** | **Layered, with a Vite `resolveId` hook inside `adaptv()` as the unbypassable backstop** (verified live), + Biome `noRestrictedImports` shipped via `extends`, + one GritQL rule for the `server:{handlers}` config-shape gap. Rejected with reasons: `@deprecated`, declaration merging, `exports` maps, pnpm strictness. → `FACADE.md §2` | ✅ **CLOSED** |
| O4 | **Render default + deploy presets** | Web = SSR **or** static SPA+SW, consumer's choice; capacitor = SPA forced. Static deploy emits `index.html`/`404.html`/`.nojekyll`/`_redirects`/`_headers`. → `RENDERING.md §3`, `LIFECYCLE.md §1.2`. **Default settled: `ssr`** — see §6.3 | ✅ **CLOSED** |
| O5 | **SW architecture** | **Navigation strategy is a pure function of `render`**: ssr → `NetworkOnly` + precache fallback (never cache documents — it's a cross-user data leak); spa → `NavigationRoute`→shell; capacitor → no SW + active unregister. `prompt` default, nav preload on, activate-time cache sweep, `vite:preloadError` net. Stay on Workbox. → `RENDERING.md §3` | ✅ **CLOSED** |
| O6 | **What to port from Ionic** + attribution | Partially answered (theming: **don't** copy — §O1; keyboard: use native events not `visualViewport`, per Ionic's own source comment). The **gesture controller / iOS input shims / back-button chain** inventory is still in flight. | 🔄 **in progress** |
| O7 | **Lint delivery** | **Biome 2.x — `noRestrictedImports` for imports, GritQL plugins for AST shapes.** Verified working end-to-end on the pinned 2.3.2. Note: `extends` resolves bare npm specifiers; `plugins` does **not** (needs an explicit `node_modules/` path). GritQL has no binding resolution — syntax matching only. → `FACADE.md §2.3–2.4` | ✅ **CLOSED** |
| O8 | **Plugin picks — OTA** | **Capawesome `@capawesome/capacitor-live-update` (MIT, 8.3.0), self-hosted.** Genuinely backend-free; strongest signature story (RSA PEM + SHA-256). Appflow is **dead** (no new sales since 2025-02-11, sunsets 2027-12-31) — `@capacitor/live-updates` disqualified. **adaptv must force `readyTimeout`** (Capawesome defaults it to `0` = rollback disabled) and **conform to `Library/NoCloud/ionic_built_snapshots/<id>/` on iOS** or persistence silently fails on cold launch. → `LIFECYCLE.md §5` | ✅ **CLOSED** |
| O8b | **Plugin picks — secure storage** | **`@aparajita/capacitor-secure-storage` 8.0.0** (MIT, 2026-02-10) — `KeychainSwift` on iOS, `AndroidKeyStore` + `AES/GCM/NoPadding` on Android. **`@capacitor/preferences` is plaintext** (`UserDefaults`/`SharedPreferences`, verified in source) and must never hold tokens. → B23 | ✅ **CLOSED** |
| O9 | **Capability scope** | in flight | 🔄 **in progress** |
| O10 | **Animation & transition substrate** | Partially: **`@starting-style` + `transition-behavior: allow-discrete` are usable (iOS 18 floor)** but **`overlay` is Chromium-only and unrequested in WebKit** — so top-layer `<dialog>`/popover exits break on iOS *permanently*. → build overlays as ordinary positioned elements with a JS presence hook, not the top layer. View Transitions can't do interruptible/gesture-driven. **Navigation API is now Baseline (Safari 26.2, Firefox 147)** but gives no gesture-progress surface, and `allowsBackForwardNavigationGestures` is `false` in Capacitor — so swipe-back is hand-built either way. | ✅ **CLOSED** by `ANIMATION.md` |
| O11 | **Six-target test automation** | not yet answered — **and TDD will force this immediately** (§6.4) | ❓ **open** |
| O12 | **Ship source vs dist** | **Ship dist, built with `tsdown`, as TWO builds** (`platform: 'browser'` for the React surface, `platform: 'node'` for `/vite` + `/sw` + `/config` — a single build fails with `Could not resolve 'node:fs'`). Copy `styles.css` verbatim rather than building it. → §6.2 | ✅ **CLOSED** |
| O13 | **`patches.css` always-on rules** | **Doctrine, but layered.** They stay always-on; `@layer` removes the `!important`s so a consumer can override any of them with an ordinary rule. → `STYLING.md §6` | ✅ **CLOSED** |
| O14 | **Config back-compat** | **unblocked** — O4 settled on `render: "ssr"`. Migration from flat `router.render`/`sw` to the `web`/`native`/`ota` blocks is now mechanical. | 📐 **designed, not built** |
| O15 | **Navigation model** | pending | ❓ **open** |
| O16 | **Signing/distribution** | **Stop at the artifact.** No fastlane. Unsigned `.ipa` + debug `.apk`; signed builds stay in Xcode ▸ Archive. → §5.0 | ✅ **CLOSED** |

### 5.0 Late closures

| # | Question | Resolution |
|---|---|---|
| O10 | **Animation substrate** | **Keep `motion`; adaptv builds no engine.** CSS (`@starting-style` + `allow-discrete`) for enter/exit, `motion` for gesture/interruptible/layout. Accelerated set is `transform`/`opacity`/`filter`/`backdrop-filter` only. **`composite:"add"` is banned** — Baseline-available, but it silently kills the Chromium compositor. **Overlays are ordinary positioned elements, not the top layer** — `overlay` is Chromium-only with no WebKit bug, so `<dialog>`/popover exits break on iOS permanently. → `ANIMATION.md` |
| O12 | **Ship source vs dist / publishing** | **Stay on raw source + git dependency until there's a second consumer.** Shipping source means no build step → no `prepare` script → **no pnpm-11 `allowBuilds` entry needed**, which is git-dep's main friction. Move to GitHub Packages when `create-adaptv` ships (a scaffolder needs a registry). Note **`create-adaptv` is unclaimed on npm** — so publish the *scaffolder* publicly (it's just prompts + file copying) and keep `@arrzdev/adaptv` private; that fixes the chicken-and-egg where you'd need a PAT configured before you could run the tool that configures your PAT. |
| O16 | **Signing/distribution** | **Stop at the artifact.** Confirmed: no fastlane. |
| — | **IAP / monetization** | **EXCLUDE from core.** RevenueCat already *is* the vendor-neutral abstraction (`@revenuecat/purchases-capacitor` 13.2.3, ~weekly releases); the hard parts are server-side; and the legal surface moves in *weeks* — US link-out commission is being actively litigated right now (9th Cir. affirmed contempt but **vacated** the 0% ban, remanded to set a "reasonable" rate). A framework release would encode a legal snapshot that expires before the release does. Document the regional matrix, don't wrap it. |

### 5.0.0 🔒 Package name — `@arrzdev/adaptv` (decided 2026-07-20)

The scope is **not** a style choice: **GitHub Packages requires the npm scope to match the repository
owner.** Publishing `arrzdev/adaptv` to `npm.pkg.github.com` means the package must be `@arrzdev/*`.
There is no configuration that publishes `adaptv` or `@adaptv/router` from that account.

Checked while deciding:
- **`adaptv` is taken on the public npm registry** (v0.8.10), so plain `adaptv/router` was never available.
- `@adaptv/*` appears unclaimed, but taking it means going **public** (npm private scopes are paid) and
  adopting a multi-package layout — which conflicts with **L1** (single-package repo). The equivalent
  under a `@adaptv` scope would be `@adaptv/adaptv/router`, which is worse than what we have.

A handle in the specifier is normal for a private/org package — Expo apps import `@expo/*`, Ionic apps
`@ionic/*`. If a public identity is ever wanted, that is the moment to register `@adaptv` and re-scope;
the `routerSpecifier` plugin option already makes that a one-line change for consumers mid-migration.

> ⚠︎ Unchanged and still worth doing: **`create-adaptv` is unclaimed on npm.** Publish the *scaffolder*
> publicly even while the framework stays private, or a new user needs a GitHub PAT configured before
> they can run the tool that configures their PAT.

### 5.0.1 The highest-value actionable finding

**Not one of the 22 official Capacitor plugins ships a `PrivacyInfo.xcprivacy`** — verified by grepping the full `ionic-team/capacitor-plugins` tree (0 matches for "privacy" across 1,188 files). `@capacitor/core` *does* ship two (both empty declarations). Meanwhile **Capacitor is on Apple's commonly-used-third-party-SDK list**, and `@capacitor/preferences` uses `UserDefaults` — a required-reason API — with its README pushing the obligation onto the app: *"you must create a `PrivacyInfo.xcprivacy` file in `/ios/App`… the required dictionary key is `NSPrivacyAccessedAPICategoryUserDefaults` and the recommended reason is `CA92.1`."*

So the obligation lands on the app, is **derivable from the dependency list**, is currently satisfied by hand-editing XML, and **fails silently at submission**. → **`adaptv sync` should generate `ios/App/PrivacyInfo.xcprivacy` from the installed plugin set.** Unglamorous, mechanical, and worth more than most of the primitive work on the roadmap.

> ### ✅ BUILT (2026-07-20) — `src/native/privacy-manifest.ts` + `stamp-privacy.ts`, 9 tests
>
> Emitted on the capacitor build (alongside the capacitor.config stamp) from the app's installed
> dependencies. **Verified in project-zero:** empty with no relevant plugin; adding
> `@capacitor/preferences` correctly produces `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1`.
> Idempotent, and skipped entirely when there is no iOS project.
>
> **The plugin→API map is a small explicit table, not static analysis.** The mapping is *Apple policy,
> not code structure* — it changes when Apple changes the rules, not when the plugin changes. A table a
> human can read and correct beats anything inferred from source.
>
> **Data collection is deliberately left empty.** `NSPrivacyCollectedDataTypes` depends on what the app
> does with analytics, accounts and telemetry, which adaptv cannot know. A guessed declaration is worse
> than none — it is a false statement to Apple and to users. The generated file says so in a comment.
>
> **Also built: `adaptv doctor` project checks** (`src/native/doctor.ts`, 13 tests). Selection criterion
> for every rule: *the broken state still builds, and often still runs*. Currently covers the
> `WKAppBoundDomains` trap (B22 — the bridge is never injected, `getPlatform()` returns `"web"`, every
> plugin silently falls back to web), the Android target-API-36 deadline, and the missing privacy
> manifest. Pure functions over file contents, so the rule set is testable without a native project.

Two hard deadlines the CLI should assert, both **2026-08-31** (extension to 11-01): **Android target API 36**, and **Play Billing Library 8** if any IAP plugin is present.

### 5.0.2 Scroll lock — the JS lock stays

`overscroll-behavior: contain`'s "no effect without actual scrollable overflow" bug **was fixed in Chrome 144** (2026-01-13) and Firefox 150 — but **[WebKit 243452](https://bugs.webkit.org/show_bug.cgi?id=243452) is still NEW** (reported 2022). And `<dialog>.showModal()` **does not block page scroll** — the HTML spec's "blocked by a modal dialog" covers hit-testing and focus only, and [whatwg/html#7732](https://github.com/whatwg/html/issues/7732) is still open with explicit WebKit hesitancy.

So `useFreezeViewport` is **not** replaceable by a declarative primitive yet on iOS. Both leading libraries agree and still ship non-passive `touchmove` cancellation — though they diverge on the rest: react-remove-scroll (Radix's engine) uses `overflow:hidden` + event cancellation and **never** `position:fixed`; Vaul uses `position:fixed` + scrollY restore **gated on `isSafari()`**. That gating is the pattern worth copying.

### 5.0.3 Platform findings that validate or correct existing code

**✅ Validated — the `display-mode` decision was right, for a reason adaptv didn't know.** `utils.css`
avoids `@media (display-mode: standalone)` as the sole signal because "a native WebView lies about it."
It's worse than that: **in an installed iOS web app with `display: standalone`, `display-mode: standalone`
is `false` and `display-mode: fullscreen` is `true`** — [WebKit 264218](https://bugs.webkit.org/show_bug.cgi?id=264218),
NEW/unassigned since 2023. The pre-paint `data-adaptv-platform` stamp is the correct primary signal on
*both* counts. Keep `window.navigator.standalone` as a fallback (non-standard, undocumented, still works).

**⚠︎ iOS 26 changed installability entirely.** Every home-screen add now opens as a web app —
`apple-mobile-web-app-capable` and a manifest `display` are no longer *required* for standalone. Ship
the manifest anyway (icons, `theme_color`, `id`, `scope` still honoured, and Web Push's manifest
requirement is unclear post-26).

**⚠︎ Storage isolation has an auth consequence.** On install, Safari copies **cookies only** — not
localStorage, IndexedDB, CacheStorage, or SW registrations. Since adaptv's model is a **client-held
bearer token** (`RENDERING.md §2`), a token in `storage.kv`/`storage.secure` means **the user is logged
out on first launch of the installed PWA**. If preserving session across install matters, the token must
be in a cookie at install time. This belongs in `ARCHITECTURE.md §2.3`'s threat-model note.

**⚠︎ TanStack Query persister corrections** (Query is still **v5**, 5.101.2 — there is no v6):
- **`createSyncStoragePersister` is deprecated** and will be removed next major. Use
  `createAsyncStoragePersister` for everything — it accepts synchronous storages too.
- **There is no official IndexedDB persister** (`@tanstack/query-indexeddb-persister` → 404). The
  documented path is `createAsyncStoragePersister` + the `idb-keyval` recipe.
- **The default `gcTime` (5 min) / `maxAge` (24 h) combination is already wrong out of the box** —
  `gcTime` must be ≥ `maxAge` or GC discards the cache early. adaptv should set this in its wiring, not
  leave it to the consumer.
- IDB uses **structured clone**, so `Date`/`Map`/`Set`/`Blob` survive; the localStorage path
  JSON-serializes and silently turns `Date` into a string. Another reason `storage.store` is Dexie/IDB.
- Wire **`buster`** to adaptv's existing `buildTag` — free, and it prevents hydrating stale-shaped data
  into new components after a deploy.
- **Dexie is at 4.4.4 — there is no Dexie 5.** `ARCHITECTURE.md §2.2`'s Dexie choice stands.

**⚠︎ Deep links + ATS are 100% unhandled by Capacitor — the largest CLI codegen opportunity.**
Verified by grepping the whole Capacitor repo: **zero** occurrences of `NSAppTransportSecurity`,
`CFBundleURLTypes`, `network_security_config`, or a VIEW intent-filter. Consequences:
- **iOS 17+ broke LAN-IP dev.** ATS stopped permitting bare IP addresses by default, so
  `adaptv dev --host ios` against `http://192.168.x.x` fails on modern iOS. Fix is an `NSExceptionDomains`
  entry keyed on the **bare IP with no port**, debug-config only. Never `NSAllowsArbitraryLoads`.
- **Never write `NSAllowsLocalNetworking` alongside `NSAllowsArbitraryLoads`** — the latter is silently
  ignored on iOS 10+ whenever the former is present.
- **Android needs three knobs aligned** for LAN HTTP: cleartext permitted, `android.allowMixedContent:
  true` (the default origin is `https://localhost`, so plain HTTP is *mixed content*), and no
  `network_security_config.xml` — because if one exists, `server.cleartext` becomes a **silent no-op**.
- `getLaunchUrl()` means **different things per platform** (iOS: last URL, and it double-resolves;
  Android: launch intent URI) and `appUrlOpen` payloads differ. adaptv must normalise both.
- **OAuth must go through `@capacitor/browser`** (SFSafariViewController / Custom Tabs), never the
  Capacitor WebView — Google returns `disallowed_useragent` for embedded user-agents per RFC 8252 §8.12.
  Document the SSO asymmetry: Android Custom Tabs share Chrome's cookie jar; iOS SFSafariViewController
  does not.

**⚠︎ `@adaptv/shell` can ship inside `@arrzdev/adaptv` — no separate package needed.** Capacitor detects
plugins by (a) the package being a direct dep of the app and (b) a `capacitor` key in its
`package.json`. It never scans `node_modules`. But two traps: the native name is **derived, not chosen**
(`fixName("@arrzdev/adaptv")` → **`ArrzdevAdaptv`** for the podspec `s.name` and SPM product; Gradle module
is `arrzdev-adaptv`), and resolution needs `require.resolve("@arrzdev/adaptv/package.json")` to work —
**adaptv's `exports` map does not currently expose `./package.json`**, which is a latent break.

Also: **most of the CLI's splash string-patching can become real Android resources** shipped in the
plugin AAR (the splash-screen plugin already proves resource merging works). Only the manifest
`android:theme` line genuinely cannot be owned. On iOS, the launch image can be neutralised purely by
writing a transparent `Splash.imageset` — a data directory, not source code — which would eliminate iOS
source patching entirely.

### 5.1 New findings that changed prior designs

| Finding | Impact |
|---|---|
| **Capacitor 8 ships a core `SystemBars` plugin** that already owns Android insets + IME, registered unconditionally. | **`@adaptv/shell` is redesigned: layer on it, don't replace it.** A second inset listener *is* the collision behind keyboard bugs #61/#68. The plugin gets smaller and less risky — but stops being "the wedge vs Ionic." → `NATIVE-SHELL.md §0.0` |
| **`@capacitor/status-bar` is silently half-dead on API 35+**: `setBackgroundColor` and `setOverlaysWebView` both *resolve successfully and do nothing*. Maintainer: *"if you are using edge to edge, remove status bar plugin."* Google Play now warns about it. | Drop the dependency; tint via a web-layer scrim + `SystemBars.setStyle()`. |
| **`Keyboard.resizeOnFullScreen` is dead code on Capacitor 8** — its only consumer early-returns whenever `SystemBars` is present, which is always. | Remove from any adaptv config surface. |
| **Apple's OTA rule is not §3.3.2.** Review Guideline **2.5.2**; DPLA **§3.3.1(B)**, and the "WebKit/JavaScriptCore" phrasing was **deleted** — the rule is now purely behavioural and *more* permissive. | `LIFECYCLE.md §5.1` corrected; `RESEARCH.md §5` still needs the fix. |
| **`createServerFileRoute` does not exist** in the pinned `@tanstack/react-start@1.167.13` — replaced by a `server` property on `createFileRoute`'s options. | A config-object property, so **no import-restriction technique can catch it**. Needs the GritQL rule. `RENDERING.md §2` is stale. |
| **TanStack Start SPA mode emits `_shell.html`, not `index.html`.** GitHub Pages' Jekyll **strips `_`-prefixed files**; Cloudflare Workers Assets looks for `/index.html`. | adaptv must emit `index.html` as a copy, plus `.nojekyll`. |
| **Capacitor 9 is in alpha** with a `// TODO: In Cap 9, add "full"` beside `SystemBars.insetsHandling`. | The inset contract changes again — don't freeze `@adaptv/shell`'s API against Cap 8. |
| **Ionic's CLI is frozen** (no release since 2025-03-18; its React starter pins Vite **5** vs current 8.1.5, React Router **5**, vitest 0.34) while `@ionic/react` ships nightly. The non-Ionic Capacitor+Vite+React niche has **nothing above 30 stars**. | The market gap adaptv targets is real and currently unfilled. |

---

## 6. Bugs found during the audit (independent of any decision)

Filed here so they don't get lost in the design discussion.

| # | Bug | Location | Severity |
|---|---|---|---|
| B1 | SW registration hardcodes `/sw.js` instead of `import.meta.env.BASE_URL` — breaks any subpath deploy (GitHub Pages). `unregister-foreign-service-workers.ts` gets this right, so the codebase is inconsistent. | `src/vite/virtuals.ts:52` | **high** for static hosts |
| B2 | Runtime caches are namespaced `pages-<buildTag>`/`static-<buildTag>`, so every deploy mints new buckets — but only `cleanupOutdatedCaches()` runs, which purges *precaches* only. Prior builds' runtime caches are **never** deleted → unbounded growth. | `src/sw/sw.cache-name.ts` + lifecycle | **high** |
| B3 | `onNeedRefresh` immediately calls `updateSW(true)` → `skipWaiting` + reload **mid-session**. Documented failure mode: the new worker's precache no longer lists the old build's chunks, so an open tab's next lazy route import misses cache *and* 404s. Data loss if a form is open. | `src/vite/virtuals.ts` | **high** |
| B4 | No `vite:preloadError` handler anywhere in `src/` — nothing catches the stale-chunk failure B3 causes. | — | **high** |
| B5 | `sw.warm-routes.ts` fetches HTML documents with `credentials: "same-origin"` into a shared cache, and strategies force `ignoreVary: true` — authenticated SSR HTML can be served to the wrong state. | `src/sw/sw.warm-routes.ts` | **privacy** |
| B6 | Dead reference to vite-plugin-pwa's `dev-sw.js?dev-sw` filename — adaptv doesn't use vite-plugin-pwa. | `src/shell/unregister-foreign-service-workers.ts` | cosmetic |
| B7 | `Screen` shipped despite being documented as removed. | `src/components/screen.tsx` + barrel | consistency |
| B8 | `mergeStyles` used by 2 of 19 components — the structural-class guarantee is unenforced. | `src/components/*` | **contract** |

---

## 6.0 ⏰ Time-sensitive — act on these first

### B9 — **Google Play requires target API 36 by 2026-08-31.** That is ~6 weeks out.

Extensions available to 2026-11-01. Consequences, all verified against `developer.android.com`:

- **Android 16 (API 36) removes the edge-to-edge opt-out entirely.** `R.attr#windowOptOutEdgeToEdgeEnforcement`
  is *"deprecated and disabled."* Every adaptv app shipping after that date is unconditionally edge-to-edge.
- **`Window#setStatusBarColor`, `setNavigationBarColor` (gesture nav), `setDecorFitsSystemWindows`, and
  `navigationBarDividerColor` are deprecated AND disabled — no effect.**
- `@capacitor/status-bar`'s own README now says it plainly: for apps targeting **Android 16 with
  Capacitor 8**, `overlaysWebView` and `backgroundColor` **"no longer work."**

**So `setBackgroundColor` is now: never on iOS, and dead on Android 15/16+.** Coloring the status-bar
area is **purely a CSS problem on both platforms** — `viewport-fit=cover` plus a background painted
under the inset. That is the only portable approach left, and it's the one adaptv should own.

> **Capacitor 8 ships `SystemBars` in core** (no separate package) with `setStyle`/`show`/`hide` and a
> `SystemBarType` of `StatusBar` **or `NavigationBar`** — so Android nav-bar icon styling is now
> first-party. Its `insetsHandling: 'css'` mode injects `--safe-area-inset-*`, *"due to a bug in some
> older versions of Android WebView (< 140)."* This largely supersedes
> `@capawesome/capacitor-android-edge-to-edge-support` for new work — prefer core (see `NATIVE-SHELL.md §0.0`).

**🔒 The safe-area contract, and it should be settled before anything else:** always consume the
Capacitor-injected variable with `env()` as *fallback*, never `env()` alone —

```css
padding-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
```

**Why:** `viewport-fit=cover` is `safari_ios: 11` but **`webview_android: 135`**. Below WebView 135 the
insets are zero or wrong. `env()` alone is broken on a large installed Android base.

### B10 — **iOS 26.5 (June 2026) broke adaptv's shipped haptics polyfill**

`src/utils/install-vibrate-polyfill.ts` mounts a hidden `<input type="checkbox" switch>` and calls
`.click()` to trigger the iOS system tick. **Apple patched programmatic triggering in iOS 26.5** — no
release-note mention. `label.click()` / `element.click()` from JS **no longer fires the haptic**.

The only surviving technique (confirmed against `ios-haptics@3.1.1`, 2026-06-26, and its issue #8
*"Can't Believe Apple 'Patched' This"*) is to overlay a **real, invisible, full-size switch input** on
the button so the user's actual finger lands on it. Constraints: **system tick only** — no impact
styles, no notification patterns, no intensity — WebKit-only, and it needs System Haptics enabled.

> **🔒 Architectural consequence, and it cannot be retrofitted: a generic imperative `haptics.impact()`
> is unimplementable on iOS web.** Only a *declarative, attach-to-this-element* API can work there.
> If adaptv's haptics API stays imperative, iOS web can never be added later. Decide now.
>
> ### ✅ RESOLVED (build pass) — adaptv ships **two** haptic surfaces, not one
>
> Splitting them is the only honest option: they have genuinely different reach, and collapsing them
> would mean either lying about iOS web or dropping non-tap haptics everywhere else.
>
> | Surface | File | Works on |
> |---|---|---|
> | **Imperative** `haptics.impact()/notify()/selection()` | `capabilities/haptics.ts` | native, Android/Chrome web. **No-op on iOS web — documented in the module header.** |
> | **Declarative** `attachHapticTick()` / `useHapticTick()` | `capabilities/haptic-tick.ts` | all six targets; inert (zero DOM cost) wherever a real engine exists |
>
> **The public API did not have to break.** `Button haptic="light"` was *already* declarative at the
> consumer's level — a prop on an element — so it now routes through the transducer and keeps working
> everywhere. Every future tap-triggered haptic must do the same.
>
> **Dead code removed:** the `<input switch>` + `.click()` branch in `utils/install-vibrate-polyfill.ts`
> is gone. It kept running and kept *reporting success* while firing nothing — the worst failure shape
> available. That file is now a `navigator.vibrate` cancel-then-vibrate wrapper and nothing else.
>
> **Nesting caveat, accepted knowingly:** the transducer is an `<input>` inside the host, which is
> invalid HTML when the host is a `<button>`. Done anyway — the node is DOM-appended (not parsed, so no
> reparenting), it is `aria-hidden` + `tabindex="-1"` (a11y tree unchanged), and the alternative sibling
> overlay would swallow the host's activation and force synthetic click forwarding, which breaks
> `event.isTrusted` and with it the user activation the whole feature depends on.
>
> ⏳ **DEVICE VERIFICATION OWED.** The 13 unit tests pin structure and lifecycle — all a DOM can prove.
> Whether the tick actually *fires* needs physical iOS ≥ 26.5 hardware; simulators produce no haptics.
>
> WebKit's standards position on the Vibration API is formally **`oppose`** (closed 2023-11-14; reopen
> declined Oct 2025), and **Firefox desktop removed `navigator.vibrate` in 129**. There is no path
> to a real web haptics API.

### B11 — adaptv's own geolocation exemplar has a bug that will propagate

`@capacitor/geolocation` documents that `checkPermissions()` **throws if system location services are
disabled** — a *device* state, not a permission state. `src/capabilities/geolocation.ts:29` calls it
unguarded, so `checkGeoPermission()` **rejects** instead of returning a state when the user has
location off globally. Since `ARCHITECTURE.md §4` names this file the template for every
permission-gated capability, **fix it before the pattern is copied.**

### B13 — `utils.css`'s `clickable` utility silently breaks `pointercancel` on iOS

`src/styles/utils.css` ships:

```css
@utility clickable { touch-action: manipulation; cursor: pointer; }
```

**[WebKit 240917](https://bugs.webkit.org/show_bug.cgi?id=240917) (NEW, 2022): `pointercancel` is not dispatched when `touch-action: manipulation`.** The expanded longhand `pan-x pan-y pinch-zoom` — spec-identical — **does** work. Ionic hit this too and documents it in `content.scss` with the same workaround.

This matters because `pointercancel` is how a gesture knows a scroll took over. Any adaptv surface that is both tappable (`clickable`) and gesture-driven — `Button` inside `Swipeable`, a drawer handle — will strand its gesture state machine on iOS. **Fix: write the longhand in `clickable`.**

Two companions from the same bug family, both affecting `use-gesture-engine.ts`:

- **[WebKit 194173](https://bugs.webkit.org/show_bug.cgi?id=194173) (NEW):** iOS does not dispatch `pointercancel` **unless another pointer event type is also registered.** A lone `pointercancel` listener is dead code — always register `pointerdown`/`move`/`up` alongside it.
- **[WebKit 239014](https://bugs.webkit.org/show_bug.cgi?id=239014) (NEW):** right-edge forward swipe fires `pointerdown` then nothing.

**Two MDN corrections worth knowing** (both verified against engine source): Safari **has** been passive-by-default for `touchstart`/`touchmove` since **iOS 11.3**, contra MDN; and **`document.documentElement` IS in the root-target set** in all three engines, so reaching for `<html>` to escape the rule doesn't work. `preventDefault()` in a passive listener fails **silently** — console warning, never an exception.

### B20 — accessibility: two decisions adaptv must own, because nothing above the shell can

**1. Modal backdrops use `inert`, never `aria-hidden` — and `aria-modal` contains nothing.**

Both engines fail the same way, independently documented:
- **WebKit [239295](https://bugs.webkit.org/show_bug.cgi?id=239295)** (NEW) — WebKit's own James Craig states true inertness requires **`inert` or the dialog API, not `aria-modal` alone**.
- **Chromium [397294118](https://issues.chromium.org/issues/397294118)** — `role="dialog"` + `aria-modal="true"` does **not** contain TalkBack either.
- **WebKit [201887](https://bugs.webkit.org/show_bug.cgi?id=201887)** (NEW since 2019, reconfirmed 2022) — *"content with `aria-hidden` attributes is read in Safari by VoiceOver"*, including a11y-dialog modals.

`inert` is Baseline widely-available (Safari 15.5+), removes elements from the a11y tree, and blocks focus, find-in-page and selection. **Since `ANIMATION.md §4.1` already decided against the top layer, adaptv's `Drawer`/`Sheet`/`Modal` must apply `inert` to the background themselves** — there's no `<dialog>` doing it implicitly. Verify on device: at least one report in 201887 has `inert` *also* failing in Safari.

**2. The SPA route announcer is adaptv's job, and the naive implementation is actively harmful.**

**No router ships one.** [TanStack Router #918](https://github.com/TanStack/router/issues/918) has been open since Jan 2024 with no maintainer resolution; React Router's [#5210](https://github.com/ReactTraining/react-router/issues/5210) became a proposal in 2023 and never shipped. Next.js and Nuxt both ship announcers — TanStack does not. **adaptv owns the shell, so adaptv owns this.**

The evidence on *how*, from Gatsby's user testing with real screen-reader users: **focus a heading** won — *"would save time and make it clear what happened"*; focusing the app root was **unanimously rejected** as *"very overwhelming"*; live-region-only was *"quite useless"* for magnification users.

> **⚠︎ The trap: do NOT focus *and* announce in the same tick.** WebKit [291748](https://bugs.webkit.org/show_bug.cgi?id=291748) (assertive announcement **skipped** if updated during VoiceOver focus) and [294253](https://bugs.webkit.org/show_bug.cgi?id=294253) (announced **twice** on simultaneous focus + update) — plus [299134](https://bugs.webkit.org/show_bug.cgi?id=299134), still active Jan 2026. That combination is exactly what a naive route change does. **Sequence them, or pick one.**

**Implementation:** focus an `<h1 tabindex="-1">`, deferred one tick after render.

**Folklore correction worth recording:** *"`.focus()` doesn't move the VoiceOver cursor in WKWebView"* is **wrong**. Patrick Lauke (W3C a11y spec co-editor), on an Ionic+Capacitor thread: *"you move `focus()` programmatically and VO's focus will follow that"* — provided the target is focusable (`tabindex="-1"` for a heading). Failures trace to non-focusable targets, same-tick DOM insertion, or VO's positional error-correction. Corroborated by WebKit [203798](https://bugs.webkit.org/show_bug.cgi?id=203798), which was filed *because* this works everywhere except Catalyst.

**Two device-test items** (they will not reproduce in Safari):
- **WKWebView ≠ Safari for VoiceOver** — proven by an Ionic maintainer reproducing two-finger-swipe-up failing under Capacitor but working in Safari, isolated outside Ionic, filed as WebKit [225514](https://bugs.webkit.org/show_bug.cgi?id=225514) (NEW, untouched since 2021).
- **Async-loaded WKWebView content desyncs the AX tree** — Apple Developer Forums FB21257352 (Dec 2025); Apple DTS acknowledged *"could be a bug"*, no fix. Directly relevant to a JS-framework-in-WKWebView architecture.
- **TalkBack `aria-live` regressed on Android 16** — Chromium [430807431](https://issues.chromium.org/issues/430807431): confirmed working on Android 15, broken on 16.

One structural note in adaptv's favour: WKWebView bridges the web a11y tree automatically via a remote-token handshake, re-registered on process relaunch. **No host-app setup is needed** — the documented hazard is the opposite (an ancestor native view returning an empty `accessibilityElements` array hides the whole web tree). Since adaptv's WebView is the root view, this is a non-issue here.

### B17 — `theme-color` went inert on iOS 26, and `useSyncTheme` depends on it

`src/hooks/use-sync-theme.ts` keeps `<meta name="theme-color">` in sync with the app theme. **That meta tag stopped doing anything on iOS 26.** caniuse's own data, verbatim:

| Safari | Status |
|---|---|
| iOS 15 – 18.7 | `y` — full support |
| **iOS 26.0 – 26.5** | **`n` — "Supported, but does not actually use the color anywhere"** |
| macOS 26+ | `a` — **installed web apps only** |

Corroborated three ways: caniuse commit *"Safari 26 doesn't use theme-color anymore (#7366)"* (2025-08-30); [WebKit 301756](https://bugs.webkit.org/show_bug.cgi?id=301756), where the reporter notes Safari *"now automatically derives the top bar tint from the html or body background color after dropping support for `theme-color`"*; and an Apple WebKit engineer confirming the new model in that thread — a solid tint extension is *"only needed in cases where there's a viewport-constrained (fixed or sticky) element near one of the edges of the viewport."*

**So on iOS 26+ the status-bar tint comes from your actual rendered `html`/`body` background near the top edge, not from a meta tag.** adaptv's critical CSS already sets `html,body{background-color:…}` per theme, so **the behaviour is probably already correct by accident** — but `useSyncTheme` should stop being the mechanism adaptv *relies* on for iOS, and the critical-CSS background becomes load-bearing rather than merely anti-flash. Keep `theme-color` for Android/Chrome and iOS ≤ 18. **Firefox has never supported it at all.**

> **⚠︎ Read B25–B26 as design constraints, not a defect list.** `src/` is the code lifted from
> chopchop's `packages/adaptv`; most of it is expected to be refactored for the standalone package. The
> value of these entries is **the pattern to avoid carrying forward**, not the line numbers.

### B27 — the Drawer's vaul attribution links point at `main`, and will rot

`src/components/drawer/drawer-constants.ts` and `drawer-engine.tsx` already carry good provenance
comments (`"Tuning mirrors vaul…"`, `"@see vaul dampenValue in helpers.ts"`, `"vaul: moved upwards —
reset, don't close"`). That convention is right, and was arrived at independently of `PRIOR-ART.md §0`.

**Two fixes:**

1. **Repin the links to a SHA.** They currently target
   `github.com/emilkowalski/vaul/blob/**main**/src/constants.ts`. vaul is unmaintained so `main` is
   frozen *today*, but a force-push, a rename, or an archive breaks every link and — more importantly —
   the reader loses the ability to diff what changed. `PRIOR-ART.md §0` is explicit: **pin the SHA,
   never `main`.**
2. **✅ `THIRD_PARTY_LICENSES` created** (2026-07-20), carrying the vaul MIT notice (© 2023 Emil
   Kowalski) and the Ionic notice (© 2015-present Drifty Co.) pre-staged for the port. vaul is not a
   dependency — this is lineage only, and the current references read as technique-and-constant sourcing
   rather than substantial copying, so the notice requirement is arguably not triggered. Included anyway:
   it costs nothing and removes the ambiguity permanently.

> **The general rule this establishes** (`ARCHITECTURE.md §5.5`): **"we outgrew this library" is the
> expected end state of a wrap, not a failure of one.** Wrap to learn the shape, own it when divergence
> demands more than the library was built for — and carry the attribution across the migration, because
> the tuning is the part that survives.

### B25 — the legacy SW prefetches the wrong *layer* — assets vs documents

**Prefetching every route is correct and is the goal** — it's what makes a standalone PWA navigate like
the native build, where the whole bundle is on-device by construction. The defect is *what* the legacy
code prefetches. `src/sw/sw.warm-routes.ts` fetches **HTML documents**, with credentials, during install:

```ts
return new Request(new URL(path, sw.location.origin).href, {
  method: "GET",
  credentials: "same-origin",          // ← sends the user's cookies
  headers: { Accept: "text/html,..." },
})
// …then: if (response.ok) await cache.put(request, response.clone())
```

```ts
return new Request(new URL(path, sw.location.origin).href, {
  method: "GET",
  credentials: "same-origin",          // ← sends the user's cookies
  headers: { Accept: "text/html,..." },
})
// …then: if (response.ok) await cache.put(request, response.clone())
```

On an **SSR** deploy that response is **per-user rendered HTML**, and it lands in a cache keyed by URL
only. **Compounding it**, `src/sw/sw.strategies.ts:27` sets `ignoreVary: true` globally — which defeats
`Vary: Cookie`, the one header that would otherwise partition the entry.

**Failure mode: user A logs in, warm-routes caches their dashboard HTML; user B on the same device gets
served it whenever the network is slow or offline.** NetworkFirst still falls back to cache on a timeout,
so this is not offline-only.

On an **SSR** deploy that response is **per-user rendered HTML**, cached by URL alone. Compounding it,
`src/sw/sw.strategies.ts:27` sets `ignoreVary: true` globally, defeating `Vary: Cookie` — the one header
that would partition the entry. User A logs in and their dashboard HTML is cached; user B on the same
device is served it whenever the network is slow. NetworkFirst falls back to cache on timeout, so this
is not offline-only.

> **The fix is not "prefetch less" — it's "prefetch chunks, never documents."** Route chunks are static,
> content-hashed and identical for every user; precaching *all* of them is exactly right. Documents are
> per-request and carry a session. → `RENDERING.md §3.2` now draws that line explicitly, and `ignoreVary`
> becomes per-rule (safe on hashed assets, dangerous on documents) rather than a global default.

### B26 — three more P0s in the SW, all verified against source

| # | Bug | Verified |
|---|---|---|
| **P0** | **`register("/sw.js")` is hardcoded** — `src/vite/virtuals.ts:52`. Breaks every subpath deploy (GitHub Pages, any non-root base). Note `unregister-foreign-service-workers.ts` *correctly* uses `BASE_URL`, so the codebase is internally inconsistent. | ✅ `grep` confirms the literal |
| **P0** | **No `vite:preloadError` handler anywhere in `src/`** — after a deploy, an open tab requesting a pruned chunk hash gets a 404 and a white screen with no recovery. | ✅ zero matches repo-wide |
| **P0** | **Auto-reload is the default** — `service-worker-shell.ts` `skipWaiting` + reload drops unsaved state mid-session *and* triggers the precache prune under open tabs, which is what makes the stale-chunk 404 fire. Default should be `prompt`; gate any `autoUpdate` on `visibilitychange`. | ✅ |

**Lower severity, same report:** unbounded cache growth (`pages-<tag>`/`static-<tag>` minted per deploy,
never swept — `cleanupOutdatedCaches()` doesn't touch them); no `updateViaCache: 'none'` on `register()`;
no defensive unregister when `ADAPTV_TARGET === 'capacitor'` (a SW registered via dev `server.url`
silently poisons the installed app **and breaks OTA**); `/assets/*` uses SWR where `CacheFirst` is
correct since filenames are content-hashed; and a dead `dev-sw.js?dev-sw` special-case in
`unregister-foreign-service-workers.ts` left over from `vite-plugin-pwa`.

**Static-host emit gap:** nothing writes `404.html`, `.nojekyll`, `_redirects` or `_headers`, and
`_shell.html` is **stripped by Jekyll on GitHub Pages** and invisible to Cloudflare Workers Assets. The
`host: "static"` preset (`LIFECYCLE.md §1.2`) is not actually deployable as designed.

> **⚠︎ Reliability caveat, stated because the source agent stated it:** this report self-marked several
> sections `[CUTOFF]` and relied on training knowledge rather than fetched sources for the Workbox,
> vite-plugin-pwa and Serwist *ecosystem* claims — treat those as weaker than `RENDERING.md §3`, which
> was written from an agent that read shipped bundles. **The bug list above is the durable part**, because
> every P0 in it was re-verified against adaptv's own source before being recorded here.

### B21 — ⚠︎ the Android WebView floor is **Chromium 119**, not 140. This corrects B18.

B18 says the safe-area inset bug is *"fixed in WebView 140."* True — but **a large part of adaptv's
install base can never reach 140**, because WebView updates stop permanently at the Chromium version
whose `min_sdk_version` still covers that OS.

Traced through Chromium's `build/config/android/config.gni` across release branches:

| Device OS | API | Max WebView **ever installable** | Frozen since |
|---|---|---|---|
| Android 6.0 | 23 | **Chromium 108** | Nov 2022 |
| **Android 7.0 / 7.1** | **24 / 25** | **Chromium 119** | Oct 2023 |
| Android 8.0 – 9 | 26–28 | **Chromium 138** | Jun 2025 |
| Android 10+ | 29+ | current (150/151) | — |

Chromium confirms it: *"We no longer support devices running Android 5-9. Devices on these old OS
versions can still update to the last supported WebView release but will not be able to install further
updates."* WebView is **not** a Mainline module — it's a plain Play Store APK, so a device without Play
Services is frozen at its system image entirely.

**Capacitor 8's `minSdk` is 24 → adaptv ships to devices capped at Chromium 119.** Capacitor 9 alpha
raises `minSdk` to 26, which lifts the floor to **138** — the single biggest web-platform win in v9.

**Consequences that change earlier entries:**

- **The `--safe-area-inset-*` CSS-variable fallback (§6.0) is permanent, not transitional.** On Android 7
  it is the only mechanism that will ever work. Keep `var(--safe-area-inset-top, env(...))` forever.
- **`@starting-style` (Chrome 117) and `overlay` (117) squeak in above 119; `overscroll-behavior`'s
  spec-correct fix (Chrome 144) does not.** `ANIMATION.md`'s CSS enter/exit path survives; the
  scroll-containment story on old Android does not.
- **Capacitor's `minWebViewVersion` default of 60 is functionally dead** — Chromium 60 shipped in 2017,
  so the built-in gate can never fire on any device that runs Capacitor 8. **adaptv should set it
  explicitly and ship an `errorPath` page** — the only supported way to fail gracefully instead of
  white-screening. Caveat from the docs: *"On Android the html file won't have access to Capacitor
  plugins."*
- Detect at runtime via `Device.getInfo().webViewVersion` (native, reliable), not UA parsing.

### B22 — `WKAppBoundDomains` silently kills the entire native bridge

If the `WKAppBoundDomains` key is in `Info.plist` **without** `ios.limitsNavigationsToAppBoundDomains:
true`, WebKit denies `WKUserScript` injection — which is how Capacitor injects `native-bridge.js`. Result:
**`Capacitor.getPlatform()` returns `"web"` and every plugin silently falls back to its web
implementation.** No error, no warning. Ionic's maintainer confirmed this is the mechanism behind
issues #4721, #5764, #4913 and plugin failures like geolocation's *"Origin does not have permission."*

**And the reason people add the key mostly doesn't exist.** The widely-repeated claim that app-bound
domains relax ITP's 7-day storage cap is contradicted by WebKit source: `isAppBoundITPRelaxationEnabled`
is a `constexpr` **`false`**, verified unchanged at four points from 2021 to today. The one real benefit
is Service Workers without an Apple-granted entitlement — which adaptv doesn't need, since
`RENDERING.md §3.5` already forbids service workers on Capacitor.

> **Decision: adaptv must never add `WKAppBoundDomains`, and `create-adaptv` should not scaffold it.** If a
> consumer adds it, `adaptv doctor` should detect the plist key without the config flag and fail loudly —
> it is the highest-severity silent failure in the whole Capacitor surface.

One useful undocumented detail: `localhost` is **auto-app-bound** in WebKit
(`shouldTreatURLProtocolAsAppBound`), so `capacitor://localhost` already sets the flag internally even
in apps that never opt in.

### B23 — the bearer-token decision is validated, but `storage.secure`'s backing store is not

`RENDERING.md`'s "cookies don't work in a native WebView → bearer tokens" is **more strongly supported
than stated**. It isn't a misconfiguration to route around — it's architecturally unsupported by both
vendors:

- **WebKit closed it "deliberate."** [Bug 213510](https://bugs.webkit.org/show_bug.cgi?id=213510) —
  *"iOS 14: ITP causes issues for hybrid (WKWebView) apps using cookies for authentication"* — NEW, 54+
  comments, filed specifically about Cordova/Ionic/Capacitor. John Wilander: **"In this case, the change
  is deliberate."** [Bug 213879](https://bugs.webkit.org/show_bug.cgi?id=213879) (*"Disable ITP in
  WKWebView used in hybrid native app"*) was never granted.
- **The subtle part** ([bug 217134](https://bugs.webkit.org/show_bug.cgi?id=217134)): ITP and the cookie
  policy are *independent*. **Even if ITP could be disabled, third-party cookies would still be blocked**
  — and `requestStorageAccess()` is non-functional in WKWebView.
- **Ionic closed the core issues `not_planned`** — #1143, #6302, #5943, #7124, #6478. #6302's reporter
  did everything the docs prescribe and it still failed. That closure pattern is the clearest possible
  signal that cookie-based cross-origin auth is not a supported architecture.
- WebKit's own recommendation is OAuth 2.0 with token forwarding; **Ionic's commercial products (Auth
  Connect, Identity Vault) are token-based**, and Identity Vault's pitch is Secure-Enclave storage.

**⚠︎ But this closes O8b in an unwelcome direction:** `@capacitor/preferences` is **plaintext** —
`UserDefaults.standard` on iOS, `SharedPreferences(MODE_PRIVATE)` on Android, verified in source. **Not
Keychain, not `EncryptedSharedPreferences`**, and its README carries no warning. `ARCHITECTURE.md §2.1`
uses Preferences as `storage.kv`'s native backend, which is *fine for flags and settings* — but
**`storage.secure` must not be built on it.** The maintained option is
**`@aparajita/capacitor-secure-storage` 8.0.0** (2026-02-10, MIT): `KeychainSwift` on iOS,
`AndroidKeyStore` + `AES/GCM/NoPadding` on Android. Avoid `cordova-plugin-secure-storage-echo` (2022);
`@capawesome-team/capacitor-secure-preferences` and `@capacitor-community/secure-storage` **do not exist**.

### B24 — background execution: the platforms are asymmetric, and Capacitor doesn't level it

**Verified in Capacitor's source: backgrounding an Android app calls neither `WebView.onPause()` nor
`pauseTimers()`.** `Bridge.onPause()` only reaches `pauseTimers()` through a Cordova-compat path gated on
`cordovaWebView != null` **and** a `KeepRunning` preference that defaults to `true`. So **JS keeps
running on Android and stops within ~5s on iOS.**

Don't build on that. Chromium throttles hidden pages to 1/second, then **1/minute**, and the WebView
renderer runs at `RENDERER_PRIORITY_WAIVED` when not visible — a prime OOM-kill target. It works on your
desk and fails in the field.

If `useAppState`-driven work ever needs to outlive backgrounding: `@capacitor/background-runner` 3.0.0 is
the **only** separate-JS-context option (JavaScriptCore on iOS, vendored QuickJS on Android) — ~30s
budget, no state between runs, no DOM. Note `@capawesome/capacitor-background-task`'s Android
implementation is literally a no-op (`// No-op for now. Android support will be added in a later
version.`) despite advertising Android support.

### B18 — safe-area root cause identified, plus a hard gate adaptv must satisfy

The "insets are 0 on Android" problem is **upstream Chromium, not Capacitor**: [crbug 40699457](https://issues.chromium.org/issues/40699457), *"safe-area-inset-* values are always 0px in webview"* — **WebView-specific** (not Chrome Android), affecting **WebView < 140 regardless of OS version**. Fixed in WebView 140; a **second threshold at 144** covers the keyboard/IME case, so WebView 140–143 is only partially fixed.

**Two undocumented details read from `SystemBars.java` at tag 8.4.2:**

1. **`hasViewportCover` is a hard gate.** Capacitor runs JS to verify the viewport meta *literally contains* `viewport-fit=cover`. Without it, `shouldPassthroughInsets` is false and Capacitor **silently falls back to native padding even on WebView 140+**. adaptv's shell must emit it unconditionally — this is a silent-failure trap.
2. The CSS-variable ordering in §6.0 is confirmed correct: **variable first, `env()` as fallback** — the inverse of what most people write.

### B19 — two smaller corrections worth not rediscovering

- **Screen Wake Lock was broken in standalone Home Screen web apps until iOS 18.4** ([WebKit 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)) — i.e. broken in exactly the installed-PWA context, for two years. BCD's note is explicit. Safari 16.4–18.3 is affected.
- **`screen.orientation.lock()` throws `SecurityError`, not `NotAllowedError`,** when not fullscreen — verified in Chromium's `lock_orientation_callback.cc`. Catch on `err.name === 'SecurityError'`. Safari has never supported `lock()` on iOS or macOS (it's behind an off-by-default experimental flag), and **iOS does not honour the manifest `orientation` member either** — so `OrientationGuard` remains the only honest cross-platform answer, which is what `use-manifest-orientation.ts` already assumes.

### B14 — the scroll-lock picture is worse than §5.0.2 said, and Capacitor already solved half of it

**`overscroll-behavior` was *demoted* from Baseline Widely to Limited on 2026-04-28.** `web-features`
commit message, verbatim: *"high → false — The overscroll-behavior property does not work consistently
across browsers when a scroll container has no overflow."* [WebKit 243452](https://bugs.webkit.org/show_bug.cgi?id=243452)
is NEW, **unassigned**, last touched 2026-07-16, and **`overscroll-behavior` is not in Interop 2026** —
so don't expect a fix this year. WebKit's own comment: *"a fair amount of work."*

Compounding it, **both the native behaviour and the workaround are currently broken on iOS**:
[WebKit 313474](https://bugs.webkit.org/show_bug.cgi?id=313474) (scrolling in a modal dialog scrolls the
page behind, filed 2026-04-27, NEW) and [WebKit 299084](https://bugs.webkit.org/show_bug.cgi?id=299084)
(*"REGRESSION (Safari 26): Overflow hidden on body/html no longer works"*). WebKit's Simon Fraser on a
claim it was fixed in 26.1: **"No, there are still plenty of bugs here."**

**But the good news, verified in Capacitor 8.4.2 source:** `CAPBridgeViewController.swift` line 300 hardcodes

```swift
aWebView.scrollView.bounces = false
```

with **no config key** — `grep` across `ios/` returns exactly that one hit. So **root rubber-band is already dead under Capacitor iOS**, and alive only in iOS Safari / installed PWA. adaptv's CSS strategy is *required for web*, redundant-but-harmless on native. `useFreezeViewport` should feature-detect the shell rather than assume uniform behaviour.

### B15 — iOS swipe-back is a genuinely clean field under Capacitor

`allowsBackForwardNavigationGestures` defaults to **`false`** (Apple docs), and a code search across
`ionic-team/capacitor` returns **`total_count: 0`** — Capacitor never sets it and exposes no key. WebKit
creates the `ViewGestureController` **lazily on first enable**, so when false the swipe machinery *does
not exist at all* — no edge dead-zone, and WebKit 239014 cannot fire.

In **mobile Safari** it's the opposite and unwinnable: the recognizer lives in the UI process above web
content, and `shouldReceiveTouch:` returns `YES` unconditionally. Neither `preventDefault()` nor
`touch-action` gates it. **So `edge-swipe-gestures.tsx` should be gated on `isInstalledApp()`** — free
rein on native, structurally impossible in a browser tab.

### B16 — cheap iOS insurance if adaptv ever uses Popover

Light dismiss was broken on iOS until **18.3** ([WebKit 267688](https://bugs.webkit.org/show_bug.cgi?id=267688),
fixed 2025-01-27) — which is *why* the Popover API's Baseline is Jan 2025 rather than Apr 2024. At an
iOS 18 floor, **18.0–18.2 are affected**. One-line mitigation from the bug thread:

```js
document.body.addEventListener('pointerdown', () => {})
```

Moot under `ANIMATION.md §4.1` (adaptv doesn't use the top layer), but worth knowing if that's revisited.

### B12 — two Capacitor web impls are actively wrong, not merely limited

- **`@capacitor/share` silently drops `files` on web.** The web impl forwards only `title`/`text`/`url`,
  while `ShareData.files` is honored natively. Same call shares a file on device and *nothing* on web —
  type-checks fine, no error. Also `share()` **throws** instead of degrading; you must gate on `canShare()`.
- **`@capacitor/clipboard`'s web `write()` is broken on Safari.** It does
  `const blob = await (await fetch(...)).blob()` **before** calling `navigator.clipboard.write()` — and
  WebKit's transient-activation token doesn't survive an `await`. The fix is to call `write()`
  synchronously with a **promise-valued `ClipboardItem`** (portable: Safari 13.1+, Chromium 98+, Firefox 127+).

Both need wrapping regardless of scope decisions — this is exactly doctrine §2's "everything exported
abstracts the hybrid heavy-lifting."

### B28 — A cold start into a 404 leaves the splash covering the app, on native ✅ **FIXED**

**Measured** in an Android WebView on `/lab/definitely-not-a-route`: `[data-adaptv-splash]` still in the
DOM at `display: block`, `opacity: 1`, `pointer-events: auto`, `z-index: 100`, and
`document.elementFromPoint(centre)` inside it. Zero splash elements on a normal route in the same build,
so it is the not-found path specifically. **Native/installed only** — on the web the critical-CSS splash
policy is scoped to `html[data-adaptv-platform="web"]` and renders the leftover `display: none`, so it is
invisible there and the bug hid.

**Cause — two correct designs meeting badly.**

1. The React splash is **app-owned and self-unmounting**: it returns `null` when the app signals ready,
   and that signal is the app's own boot work. In the playground that is `AppDbProvider`, which lives in
   the `providers` **layout route** (`routing/layouts/providers.layout.tsx`).
2. adaptv sets **`notFoundMode: "root"`** (`create-adaptv-router.ts`), so root is the not-found boundary.
   A not-found boundary short-circuits the `<Outlet/>` at that match — the router renders the boundary's
   `notFoundComponent` there and **never descends**.

So on a not-found nothing below root mounts. No layout route runs, the bootstrap gate is never set, the
splash never returns `null`, and its own coverage box — which is doing exactly what it was designed to do
— covers the 404 forever. Worth being precise about the matcher, because "use `notFoundMode: fuzzy`" is
the tempting non-fix: for a path that matches nothing, `getMatchedRoutes` returns **root alone**
(`match?.branch || [rootRoute]`), so a pathless layout is not even in the match chain and fuzzy resolves
to root anyway. A loader that throws `notFound()` mid-boot lands on the same root boundary.

**Fix (`src/shell/shell-layout.tsx`).** adaptv mounts the splash, so adaptv retires it: `RoutingShell`
reads the router's not-found boundary state and stops mounting the app's splash when one is up — there is
no boot left to cover if the app tree is never going to mount. Two details that are load-bearing:

- **Derived during render, not in an effect.** `globalNotFound` is dehydrated, so the SSR pass and
  hydration agree, and a native cold start never paints the splash even for one frame.
- **Latched — retiring is one-way.** Re-mounting on the navigation *out* of a 404 would hand a fresh
  splash a ready gate that is already set, replaying a full-screen splash over a booted app for its
  dismiss delay.

Guards: `src/shell/shell-layout.test.ts*` (real router + the playground's providers-layout shape; the
404 cases fail without the fix) and `playground/e2e/screens.spec.ts` (which also *clicks* the 404's home
link, so an intercepting overlay fails the test rather than merely showing up in a query).

---

## 6.3 🔒 `web.render` defaults to `"ssr"` — and the asymmetry of being wrong settles it

I previously leaned SPA (client-held token + offline-first ⇒ SSR buys little). **That reasoning was
scoped too narrowly — to the authenticated app, ignoring everything around it.**

The case that decides it: someone picks adaptv *because* they want one codebase everywhere, and that app
has a public surface — a landing page, pricing, docs, a shareable product page. **Defaulting to SPA
kills SEO for all of it**, and the failure is silent and discovered late, after the marketing page is
already ranking badly.

**The asymmetry is the argument:**

| Wrong default | Cost | Recoverable? |
|---|---|---|
| SPA when SSR was needed | dead SEO, no social previews, slow first paint | only by re-architecting deploy — and you find out from analytics, months later |
| SSR when SPA would do | a server/adapter you didn't strictly need | flip one config key |

**And nothing is given up.** `LIFECYCLE.md`'s two-lineage model means `render:"ssr"` on web coexists with
the forced-SPA Capacitor bundle from the same source. Per `RENDERING.md §3.2`, SSR also does **not**
restrict route-chunk precaching — warm routes and instant navigation are identical in both modes — so
choosing SSR costs nothing on the app side.

**⚠︎ The one real build-step consequence:** TanStack Start emits `_shell.html` **only in SPA mode**, so
`render:"ssr"` has no artifact for the SW's offline fallback to bind to. adaptv must **generate** a
static, user-agnostic shell for the SSR case. Generated, never a captured response — so it's
user-agnostic by construction rather than by luck. This is the single piece of offline behaviour that
cannot move up to the JS layer (§3.0).

Note this also reconciles `LIFECYCLE.md §1.2`'s flag that the code currently defaults to `spa` — that's
legacy, and the resolved default is `ssr`.

## 6.2 🔒 The dist build — empirically settled

Tested by building a replica of adaptv's exact package shape and consuming it from a real Vite 8 app.

**Shipping source works better than folklore claims — and still loses.** Vite 8's Rolldown scanner
*does* pre-bundle raw `.ts`/`.tsx` from `node_modules` (verified in `.vite/deps/_metadata.json`), and
the CSS subpath resolves fine. But three things break hard:

1. **Path aliases inside the package are a hard failure.** A library file importing `@/util/helper`
   fails — Vite does not apply a *dependency's* tsconfig paths. `@vitejs/plugin-react` escalates the
   `UNRESOLVED_IMPORT` warning to a build error. **Every internal import must be relative.**
2. **JSX in a `.ts` file is a hard failure**, fixable only by the consumer via `oxc.include`.
3. **`skipLibCheck` does not save consumers.** It skips `.d.ts`, not `.ts` reached through `exports` —
   so consumers inherit adaptv's tsconfig assumptions and typecheck its source. This is the decisive one.

Also: **Fast Refresh never reaches library components** either way (`@vitejs/plugin-react` skips
`node_modules`), so "ship source for better DX" doesn't buy what people think.

**⚠︎ A research trap worth recording:** `@ark-ui/react`'s npm *packument* shows
`exports: { ".": "./src/index.ts" }` with no `types` — it looks like a major library shipping raw TS.
**The tarball contains 3,747 `dist/` files, 960 `.d.ts`, and zero `src/`.** Publish-time package.json
rewriting. **Never judge how a package publishes from registry metadata — extract the tarball.**
Essentially nobody significant ships raw `.ts` as the default resolution target; the real pattern is
dist-by-default with source behind a custom condition.

**Tool: `tsdown` 0.22.12.** `tsup`'s own README now opens with *"This project is not actively maintained
anymore. Please consider using tsdown instead."*; Vite's docs point at tsdown for *"non-browser
libraries, or … advanced build flows"* — which is exactly adaptv's `/vite` and `/sw` entries; and tsdown
is VoidZero/Rolldown-org software, aligned with the consumer toolchain. **Honest caveat: it's still 0.x
and tsup still out-downloads it 26M vs 10M/month.** Pin exactly; don't float the range.

### Four traps that bite this specific package shape

- **🚨 Rolldown silently drops `"use client"`** from non-entry modules in bundle mode — verified: present
  with `unbundle: true`, **absent** in a normal bundle. Re-assert with
  `outputOptions: { banner: "'use client';" }` on the browser build only. tsdown's docs never mention
  directives; the failure is silent, so grep `dist/`.
- **🚨 `typescript@latest` is now 7.0.2, which silently switches `rolldown-plugin-dts` to the
  experimental `tsgo` generator** — it warns *"TypeScript 7.0 does not yet have a stable API… Some
  options will be unavailable."* **Pin `typescript@5.9.x`** in devDependencies until that settles.
  (Note this cuts against the separate suggestion to adopt TS 7 for its 13× speed — the two goals
  conflict today; the build pin wins.)
- **`exports: true` does not merge across an array config** — auto-generation captured only the last
  build's entries, silently omitting the rest. **Hand-write the `exports` map**, and let
  `publint: true` + `attw: true` police it. Put `clean: true` on the *first* build object only.
- **Don't build the CSS.** `@tsdown/css` is experimental and carries an **exact-version** peer dep on
  tsdown (`0.22.7` requires exactly `0.22.7`), emits a useless empty `styles.js` shim, and would run
  adaptv's hand-authored stylesheet through a second minifier before the consumer's own pipeline.
  Use `copy: [{ from: 'src/styles.css', to: 'dist/styles.css' }]` + a static export.

**Two smaller settled points:** `sideEffects: ["**/*.css"]` — `*.css` and `**/*.css` are *identical*
per webpack's `glob-to-regexp` (patterns without `/` are treated as `**/`-prefixed); the real footgun is
a path-anchored pattern like `"./src/**/*.css"`, which silently won't match the published `dist/` tree.
And keep `sourcesContent` embedded in the sourcemaps (tsdown's default) with `files: ["dist"]` — the map
is then self-contained and consumers get real stack traces **without shipping `src/`**.

---

## 6.1 Positioning — the honest market picture (2026-07-20)

Not a decision, but it should inform every decision above. Numbers are npm downloads/month and GitHub
stars, pulled live.

**The number that validates the thesis:**

| Package | Downloads/month |
|---|---|
| `react-native` | 41.1M |
| `expo` | 27.5M |
| **`@capacitor/core`** | **12.3M** |
| `@ionic/angular` + `@ionic/react` + `@ionic/vue` | **~1.5M combined** |
| `konsta` (styling-only UI kit) | 56K |
| `capstart` (the closest competitor) | **289** |

**~8:1 Capacitor-to-Ionic-UI.** Millions of developers already chose Capacitor *and rejected Ionic's UI
layer* — so they are hand-rolling navigation, transitions, gestures, and safe areas, or shipping
something that feels like a website. **Nothing has absorbed that demand.** Capacitor is also ~30% of
React Native's volume; this is not a fringe runtime.

**The incumbent is genuinely stuck.** Ionic Framework human commits are **down 82% from peak**; 80% of
the last year's human commits come from **3 people**. OutSystems discontinued all Ionic commercial
products in Feb 2025, and the OSS survives explicitly because *"they form a significant portion of the
OutSystems mobile stack"* — not from independent investment. `@ionic/react-router@8.8.14` (July 2026)
is **still pinned to React Router v5**; issue #24177 ("React Router v6 support") has **409 👍 and has
been open since Nov 2021** — the highest-voted issue in the repo. Ionic 9 (Q3 2026) is a pure catch-up
release; the modular rewrite is deferred to v10 with no date. They ship **two themes, ios + md**, where
`md` is **Material Design 2 — two generations behind Android** — and have publicly declined to build an
iOS 26 Liquid Glass theme.

**Capacitor itself is healthy** — 110 open issues, well-groomed, Cap 9 in alpha. That asymmetry is close
to ideal for adaptv: the native bridge is funded and thriving; the UI-layer competitor is not.

### Three things that should temper the thesis

1. **adaptv is not first.** [Capstart](https://github.com/AdrienADV/capstart) shipped 2026-02-14,
   explicitly supports TanStack Start, was pushed *yesterday* — and after five months has **26 stars and
   289 downloads/month**. That is the most direct read on *organic* demand available, and it's
   discouraging. Whatever adaptv ships must have an answer for why it wins where Capstart hasn't.
2. **The space has no cultural energy.** The top on-topic HN thread in 18 months
   ([Ask HN: Webview vs React Native](https://news.ycombinator.com/item?id=46371761), Dec 2025) got
   **1 point and 3 comments**. Industry momentum in 2025–26 went the *other* way — Snapchat open-sourced
   **Valdi** (TypeScript → native views, no webview, no bridge) in Aug 2025. The objection to beat is
   verbatim: *"I have yet to see a webview that doesn't feel like a webview."* **That has to be beaten in
   a demo, not a README.**
3. **The demand is latent, not expressed.** Those millions of Capacitor-without-Ionic developers aren't
   asking for a framework — they already routed around the problem with Tailwind and hand-rolled
   components. Switching costs are real.

### Dependency health — two traps in the obvious picks

**`vaul` is dead, and adaptv's `Drawer` cannot depend on it.** On 2025-10-03 Emil Kowalski replaced the
README with *"This repo is unmaintained. I might come back to it at some point, but not in the near
future."* Worse: npm `latest` is **1.1.2 from December 2024**, while fixes merged to `main` in July 2025
were **never published**. Permanently open: iOS buttons unclickable when tapping text (#652), nested
drawers inconsistent on Android 12+ (#646), back-gesture handling (#645), snap-point scroll (#635) —
i.e. *exactly* the iOS/nested/keyboard class adaptv cares about. Its 37M weekly downloads are shadcn
inertia, not health. **Read its source before it bit-rots; don't depend on it.**

**`@use-gesture/react` is dormant with no deprecation notice** — last publish 2024-03-21, ~2 years, crash
fixes sitting unmerged, and broken against its own sibling `react-spring` v10. 5.6M downloads/week makes
it look alive. It isn't. adaptv already peer-deps `motion`; keep it that way and build only the
pinch/wheel remainder `motion`'s `drag` doesn't cover.

**Safe picks, confirmed healthy:** `motion` 12.42.2, `@tanstack/react-virtual` (pushed today),
`embla-carousel` (pin 8.x — v9 has been in RC since January), `vite-plugin-pwa` — and note the last one
insulates adaptv from the Workbox maintenance question entirely, which matters given `RENDERING.md §3.6`
picks Workbox. The vite-pwa org began a from-scratch ESM Workbox reimplementation in Oct 2025; if it
lands, adaptv inherits it free.

### App Store 4.2 — rejection is never "it's a WebView"

The canonical rejection string is *"the experience your app provides is not sufficiently different from
a web browsing experience, as it would be if displayed in Safari."* The instructive case: an app that
**already had push notifications, offline access and deep links was still rejected** — what fixed it
across three submissions was removing `InAppBrowser` link-outs, rebuilding the UI to feel native, and
fixing **white-flicker on launch** and iPhone X+ header glitches.

> **Native plugins are not sufficient. Perceived nativeness of the UI is what the reviewer scores** —
> and reviewers literally screenshot the chrome.

Most of the mitigations are things adaptv already owns, which is the point — **the framework should make
apps pass 4.2 by default**: local-first bundle (make a remote-URL shell loud to opt into — that's 4.2.2
on sight), no browser chrome ever, native splash with **no white launch flash** (already solved — §1.4),
correct safe areas, external links through `SFSafariViewController` by default with a lint rule on
`window.open`, offline state as a first-class surface rather than a browser error page, and a generated
privacy manifest (§5.0.1). Cheapest possible addition: **a reviewer-notes generator** enumerating every
native plugin the app actually uses.

The 2025-26 enforcement wave (Guideline 4.3(b), revised 2026-06-08, now claims removal authority over
shipped apps) targets **AI slop, dynamic code generation and payment circumvention — not hybrid
frameworks.** OTA stays explicitly legal per DPLA §3.3.1(B); the real hazard is dark-shipping unreviewed
features, which is 2.3.1 misrepresentation. **Google Play's sharper risk is different**: the top
suspension cause for WebView apps is **domain ownership**, not functionality — *"we don't allow apps…
[that] provide a webview of a website without permission from the website owner."*

### The defensible wedge, stated precisely

Two halves, and **the second is the stronger one**:

- **UI primitives** — platform-correct navigation, transitions, gestures, safe areas, without adopting
  Ionic's router and component system. This is where the *volume* is, and also where taste, the
  "feels like a webview" objection, and Ionic's 52K-star incumbency make it hardest to win.
- **The isomorphism boundary** — `createServerFn` genuinely breaks in a Capacitor bundle (it expects a
  co-located Start server at `/__server`, absent at `capacitor://localhost`). Today every developer
  solves this by hand from a blog post. It is **concrete, documented, reproducible, and framework-shaped**
  — exactly where a framework earns its existence. `FACADE.md` §2 turns it from a doc rule into a build
  failure, which nobody else does.

> **Consequence for sequencing:** `FACADE.md`'s ban mechanism and `RENDERING.md`'s delivery model are the
> *differentiated* work. The primitive layer is the volume play but the contested one. Ship the wedge
> first.

---

## 7. Where the docs sit after this pass

```
DECISIONS.md   ← you are here: the register. Status of everything.
VISION.md      north star + the problem catalogue (§9 open questions now live here instead)
ARCHITECTURE.md the cross-platform contracts (shell/View, storage, facade)
LIFECYCLE.md   config → build → deploy → OTA → CLI
COORDINATION.md runtime lifecycle spine (app state, back, gestures, routes)
RENDERING.md   the isomorphism boundary + delivery
STYLING.md     ⚠︎ TO WRITE — the styling & theming contract (O1)
FACADE.md      ⚠︎ TO WRITE — TanStack opacity + the server-only ban (O2, O3)
PRIOR-ART.md   ⚠︎ TO WRITE — the Ionic/Capacitor port list + attribution (O6)
BEHAVIORS.md   the per-fix catalogue
NATIVE-SHELL.md the @adaptv/shell plugin design
TESTING.md     six-target discipline
RESEARCH.md    upstream issues to watch
capacitor-internals.md version pins + native gotchas
```
