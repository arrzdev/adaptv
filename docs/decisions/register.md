# adaptv — the decision register

> **The single answer to "what's decided and what isn't."** Every architectural call the framework
> rests on, with a status, the evidence behind it, and where the full design lives.
>
> Statuses: **🔒 LOCKED** (decided, don't re-litigate) · **📐 DESIGNED** (fully specced, not built) ·
> **🔀 CONFLICTED** (two docs/code disagree — must be resolved) · **❓ OPEN** (genuinely undecided).
>
> Started **2026-07-20**. This doc supersedes the scattered "decisions" sections that used to live
> in `HANDOFF.md` (deleted 2026-08-30, see git history — session handoffs are not repo artifacts, and it had drifted
> to being wrong on twelve counts including a **reversed** locked decision) and in `VISION.md §9`.

---

## 0. How to read this

`README.md` answers *"what's built"* and [`../roadmap/README.md`](../roadmap/README.md) answers
*"what isn't."* This doc answers *"what's settled."* They are
different questions and were being conflated: several things are **built but never decided** (the
styling contract), and several are **decided but contradicted elsewhere** (TanStack opacity).

A decision is only LOCKED when (a) it's written down here, (b) no other doc or code contradicts it,
and (c) the rationale survives being asked "why not the opposite?"

---

## 1. Codebase state — the audit (2026-07-20)

Verified by reading the tree, not by trusting the docs.

> ⚠︎ **This section is a point-in-time snapshot and is kept for its *reasoning*, not its numbers.**
> Every count below is from 2026-07-20. As of **2026-08-30** `src/` holds **240** non-test source
> files (372 including tests) and `pnpm test` is **2542 tests / 164 files**. Read §1.3 (patches) and
> §1.4 (splash) for *why* those subsystems are shaped the way they are — that reasoning is not
> recorded anywhere else. Do not read the tables as a current inventory.

### 1.1 What's actually in `src/` (145 files, as of 2026-07-20)

| Area | Files | Reality vs README |
|---|---|---|
| `components/` | 20 exported primitives + tests | **Ahead of the README.** `Input`, `TextArea`, `Checkbox`, `Switch`, `WheelColumn`, `EdgeSwipeGestures`, `OrientationGuard`, `PwaSplashOverlay`, `NotFound` all exist and are exported — the README lists several as "not done." |
| `capabilities/` | 9 (haptics, keyboard, network, status-bar, geolocation, splash, browser, native-theme) | matches |
| `hooks/` | 32 modules, **22 exported** (`interface/hooks.index.ts`) | ahead — the capability hooks (`useShare`, `useClipboard`, `useDevice`, `useOrientation`, `useKeepAwake`, `useInsets`, `useAppState`, `useBackHandler`, `useHapticTick`) landed after this audit, `useNetworkStatus` became `useIsOffline`, and `useGlobalFpsSentinel` was **deleted** with the gpu-boost mechanism (`docs/design/performance-boost.md §9.1`). The 10-module gap between the two counts is deliberate: `useCaretRepaint` and `useSuppressTextMagnifier` are mounted by the shell and are private *as exports* while running on every app (`docs/research/component-surface.md §8.2`). |
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

A fourth row, **GPU layer promotion on FPS drop** (`patches.gpuBoost` +
`hooks/use-global-fps-sentinel.ts` + `html[data-gpu-boost] .hardware-boosted`), was **deleted, not
disabled** — the config field, the sentinel and the utility are all gone. `docs/design/performance-boost.md §9.1`
records what landed and why; `styles/utils.test.ts` now asserts the *absence* of every trace, so the
mechanism cannot come back by accident. One nuance worth keeping: the port of Ionic's static
`body { transform: translateZ(0) }` (still ranked 1 in `docs/decisions/prior-art.md §1`) was **considered and
deliberately skipped**, not forgotten. A transform on `body` makes it the containing block for
`position: fixed` descendants, and `Drawer` portals its backdrop and panel into `document.body` as
exactly that — but `body` is `h-dvh`, which tracks the **dynamic** viewport while fixed positioning
resolves against the **layout** viewport. They differ by the URL-bar delta, which is precisely where
the drawer's geometry lives.

Then the `ui` block — three rules that are the CONSUMER'S call rather than doctrine, each resolved
pre-paint in `utils/platform.ts` (`UI_STAMPS`) into a boolean-presence attribute on `<html>`, so the
stylesheet stays one static artifact with no build matrix and no flash:

| Rule | Config flag (`"app" \| "all" \| "off"`, default `"app"`) | Stamp |
|---|---|---|
| Global `user-select: none` (with `input`/`textarea`/`[contenteditable]` always exempt, and a `selectable` utility to opt back in per element) | `ui.noSelect` | `html[data-adaptv-no-select]` |
| `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` | `ui.hideScrollbars` | `html[data-adaptv-hide-scrollbars]` |
| `a[href] { -webkit-touch-callout: none }` — iOS's long-press link-preview sheet | `ui.touchCallout` | `html[data-adaptv-no-touch-callout]` |

And the genuinely **unflagged doctrine** in `patches.css`, which fixes things that are *broken* rather
than merely different, so nobody wants the alternative: the hover-stickiness fix on touch
(`@custom-variant hover`, which also excludes `:focus`), the `active:` repoint onto `data-pressed`,
the autofill yellow-background kill, `-webkit-tap-highlight-color: transparent` on anchors (the other
half of the callout rule, and deliberately *not* configurable — the grey flash duplicates the press
feedback adaptv already draws), the caret-mute hook, and `type=search` decoration removal.

> ✅ **RESOLVED — the question this section used to leave open is answered, and in both directions.**
> It asked whether the always-on rules become flags or are declared doctrine; the split above is the
> answer. Two corrections to what it assumed along the way:
>
> - The `!important`s it quoted (`* { user-select: none !important }`,
>   `* { scrollbar-width: none !important }`) are **gone**. Cascade layers made them unnecessary, and
>   `docs/decisions/styling.md §6.0.1` now *bans* `!important` inside adaptv's layer — an important declaration in a
>   layer declared before `utilities` inverts layer order and becomes the single strongest author
>   declaration on the page. Exactly one survives, the autofill `box-shadow`, and it fights a UA
>   stylesheet, which is the only exemption.
> - The **native focus-ring reset is no longer blanket.** It was `:focus` flat, justified by "package
>   components replace it with focus-visible rings" — which only ever covered adaptv's own primitives,
>   leaving a consumer's plain `<button>` with no visible focus indicator on any target, keyboard
>   included. That is **WCAG 2.4.7 Level AA**, so it is broken rather than a preference and gets no
>   knob. It is now `:focus:not(:focus-visible)` — "focused, but the UA decided this focus does not
>   deserve an indicator", i.e. a click or a tap — plus a shipped replacement,
>   `:where(:focus-visible) { outline: 2px solid var(--adaptv-ring, currentColor) }`.

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
- **Handoff:** `launchShowDuration`/`launchAutoHide` hold the OS splash; `useSplashHandoff` waits for a
  painted frame, calls `hideNativeSplash()`, waits out its fade → no gap, no double-splash — and then
  hands the React splash `revealedAt`, so its minimum visible time is time the user actually had it (B32).
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
| L1 | **Single-package repo.** Root *is* the framework. Promote to `packages/*` only when the native plugin or `create-adaptv` need separate publishing. | this table |
| L2 | **No hard forks.** Rent stable cores, own the seams. Escalation ladder: re-export barrel → `.adaptv/` → `pnpm patch` → vendor one module → replace a layer. | ARCHITECTURE §0.6 |
| L19 | **`pnpm patch` is a first-class tool, not a last resort.** When a dependency structurally blocks something adaptv needs, patching it is the *correct* move for a framework built on other libraries — not a smell to be avoided. Supersedes §2.6's "reserve, don't wire up" for `pnpm patch` specifically. Decided by the owner, 2026-07-20. | §2.6a below |
| L3 | **Isomorphic-only.** No `createServerFn`, no server routes, no server-only request/cookie reads. Loaders/`beforeLoad` are *Router* features and are allowed. **Ban server-only calls, not loaders.** | RENDERING §2 |
| L4 | **Edge-to-edge is always on**, never a toggle. The consumer picks which edges a surface pads (`View safe=…`), never whether edge-to-edge happens. | ARCHITECTURE §1.4 |
| L5 | **Frame owned above the route; one `View`, no `Screen`.** RN's navigator model — the shell seeds a full-viewport slot and stretches its child; `View` is a dumb-correct `flex-col` box. Root-ness never comes from DOM sniffing. | ARCHITECTURE §1 |
| L6 | **Behavior is props, presentation is `className`.** `<View scroll="y">`, not `className="overflow-y-auto"`. | VISION §2.2 |
| L7 | **Guardrails teach, never mutate.** Catch misuse with a build-time error + dev-only runtime warning — never silently rewrite consumer code. | VISION §2.3 |
| L8 | **One config source.** `adaptv.config.ts` generates the manifest, `capacitor.config`, native projects, splash, icons, theme. No second config file. **Icons are the worked example (2026-07-28):** ONE directory (`icons`), read ONCE (`src/vite/icon-set.ts`), measured rather than name-parsed, and derived into all three surfaces — web manifest, head links, native launcher art. The three used to compute it separately and had drifted: the manifest took only `android-*` names and trusted the size written in them, the head hardcoded twenty `/favicons/*` links regardless of the config key or whether the files existed, and only the native side actually looked. An app with no usable art wears **adaptv's own mark**, never Capacitor's stock icon, and `adaptv icons <image>` produces the whole set from one image. | VISION §2.5 |
| L9 | **Reactive → hook, imperative → API.** Live watches are hooks over a `subscribe`/`get` accessor (so non-React consumers can subscribe); one-shot reads are async fns. | VISION §2.6 |
| L10 | **Storage = three tiers** under `storage`: sync `kv` (MMKV model), async `store` (blob KV, **not** an ORM), async `secure` (Keychain/Keystore native; **best-effort, not secure, on web**). | ARCHITECTURE §2 |
| L11 | **Hybrid primitives push the platform branch to the lowest layer.** The accessor is the only hybrid file; it returns native-*accurate data*, not machinery. Geometry is DOM-free and unit-tested. | ARCHITECTURE §4 |
| L12 | **`target:capacitor` is absolute** — always `render:"spa"` + `sw:false`, regardless of config. Only the CLI sets it. | LIFECYCLE §3.1 |
| L13 | **Native OTA is self-hosted** on the app's own web deploy (no Appflow/Capgo backend), `nativeFingerprint`-gated, applied next launch, resume-triggered, watchdog rollback. Own the policy, rent the swap. | LIFECYCLE §5 |
| L14 | **Two build lineages that never cross.** The native client bundle materialises only under `ADAPTV_TARGET=capacitor`. A web build can never ship the native bundle. *(The directory was `dist-capacitor/` when this was written; it is **`.adaptv/web`** today — `src/vite/capacitor-config.ts` `CAPACITOR_WEB_DIR`. `dist/` now means only "what a host deploys".)* | `docs/design/lifecycle.md §0`, `§6` |
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

> ✅ **All five conflicts opened here are now closed** (audited 2026-08-30). §3.1 below is kept
> because its content is the styling contract's origin story. The other four were still flagged 🔀
> months after they were settled, which is the failure mode this section exists to prevent — so they
> are deleted rather than left reading as live disagreements:
>
> | Was | Question | Resolved by |
> |---|---|---|
> | §3.2 | TanStack opacity — two contradictory decisions | **Shipped and mechanically enforced.** `src/vite/route-tree-opacity.ts`, `src/vite/router-autoimport.ts`, `src/vite/thunk-specifiers.ts`, `bin/lib/opacity.mjs` (+ `opacity.test.mjs`). The spike evidence lives on in [`facade-and-opacity.md`](facade-and-opacity.md); the doctrine is **L20** in §2. |
> | §3.3 | `render` default: docs say SSR, code says SPA | **`"ssr"`.** [`rendering-and-delivery.md §1`](rendering-and-delivery.md) + `src/config/web-config.ts` (`render: config.render ?? "ssr"`). |
> | §3.4 | SW navigation: docs say shell-fallback, code does NetworkFirst | **Preload-or-network with a deadline, then the precached shell.** `src/sw/sw.navigation.ts`, [`../design/rendering.md §3.3`](../design/rendering.md). |
> | §3.5 | `Screen` — documented as removed, still shipped | **Removed.** No `Screen` export in `src/interface/components.index.ts`. |

### 3.1 ✅ The styling contract is built, decided, and enforced

- `VISION.md §9` lists **"Styling system"** as an *open question* ("Leaning: keep Tailwind").
- But `src/utils/styles.ts` already implements a **three-layer precedence contract**:
  `mergeStyles({ base, className, locked })` → `base < className < locked`, riding on
  tailwind-merge's last-wins resolution.
- ✅ **All primitives now use it** (bug **B8**, closed 2026-07-29). A primitive with nothing
  structural passes `locked: undefined` *explicitly*, so the omission reads as a decision, and
  `src/components/style-precedence.test.tsx` asserts both halves on every one — a class that must
  win and a class that must lose. The migration immediately caught a shipped bug: `WheelColumn`
  carried `"scrollable-y overscroll-contain"`, and since `overscroll` is a registered conflicting
  group, tailwind-merge dropped `scrollable-y` **entirely** — the wheel had no `overflow-y: auto`.
- ✅ `mergeStyles` also merges the **inline-style** channel (`baseStyle < style < lockedStyle`),
  because inline `style` is its own cascade origin and beats every layer — so the `data-*` escape
  hatch does not protect against it. → `docs/decisions/styling.md §2.1`.
- ✅ Documented: `docs/decisions/styling.md` is the contract, and `VISION.md §9`'s open question is closed by it.
- There is **no theming token layer** — no `--adaptv-*` custom properties, no colour system, no
  per-component style hooks. Consumers restyle by throwing Tailwind classes at primitives and hoping
  tailwind-merge resolves correctly.

> ✅ **Resolved by `docs/decisions/styling.md`** — the full styling & theming contract, decided 2026-07-20 and
> extended since (Tailwind as a hard requirement §0.1, the inline-style tier §2.1, the closed
> six-variant list §5, the auto-injected `@layer` statement §6.0.2).

---

## 4. 📐 Designed but not built

Full designs exist; the next step is TDD, not more design.

> **Re-audited against `src/` on 2026-08-30.** Nine of these twelve have shipped. A "designed, not
> built" row that has in fact been built is worse than no row at all — it sends a reader looking for
> work that is finished. **The two that remain live are D2 and D3, and they now live in
> [`../roadmap/`](../roadmap/README.md), which is the single not-done list.** The table is kept as
> the record of what was designed up front and what that design turned into.

| # | Item | Design | Status (2026-08-30) |
|---|---|---|---|
| D1 | `.adaptv/` hidden generated dir + `adaptv` barrel | `../design/architecture.md §3` | ✅ **shipped** — `src/vite/adaptv-dir.ts`, `route-tree-opacity.ts`, `router-autoimport.ts`; enforced by `bin/lib/opacity.mjs` |
| D2 | First-party `@adaptv/shell` Capacitor plugin (edge-to-edge + insets/IME, then splash/status-bar/theme) | `../roadmap/native-shell-plugin.md` | 📐 **still live, and the design is stale.** Capacitor 8's core `SystemBars` already owns Android insets + IME, so the premise changed — **redesign before implementing** (`§0.0` of that doc). **HIGH** risk. |
| D3 | `create-adaptv` scaffolder | `../roadmap/create-adaptv.md` | 📐 **still live.** Low risk. |
| D4 | `web` config block (`render`/`host`/`sw`) → Start deploy presets | — | ❌ **withdrawn.** The config went *flat* instead: [`rendering-and-delivery.md §2`](rendering-and-delivery.md) deletes `web.host`, and `src/config/types.ts` records that the service worker is not configurable at all, so there is no `sw` block either. |
| D5 | Capacitor OTA (fingerprint-gated self-hosted bundle swap) | `../design/ota.md` | ✅ **shipped** — `src/ota/` (policy, updater, ledger, manifest-signing, native-fingerprint, store-release) + `src/vite/{ota-emit,ota-zip,ota-config-module}.ts` + `adaptv keys ota` |
| D6 | `adaptv dev [--host ios\|android]` with device live-reload | `../design/lifecycle.md §2.2` | ✅ **shipped** — see [`positioning.md §2`](positioning.md) for the LAN-IP path as built |
| D7 | ~~`adaptv ota build` / `ota status`~~ | — | ❌ **withdrawn** — the channel is emitted by `vite build`, and OTA-vs-store-release is derived, not declared |
| D8 | `useAppState` accessor + hook | `../design/coordination.md §1` | ✅ **shipped** — `src/capabilities/app-state.ts`, `src/hooks/use-app-state.ts` |
| D9 | Back-button priority handler chain | `../design/coordination.md §2` | ✅ **shipped** — `src/capabilities/back-chain.ts`, `src/hooks/use-back-handler.ts` |
| D10 | Global gesture controller (single-capture arbitration) | `../design/coordination.md §3` | ✅ **shipped** — `src/capabilities/gesture-controller.ts` + three consumers (`Drawer`, `Swipeable`, edge-swipe) |
| D11 | Route lifecycle (enter/leave, no DOM retention) | `../design/coordination.md §4` | ✅ **shipped** — `src/hooks/use-screen-lifecycle.ts`. ⚠︎ **but it is missing from `src/interface/hooks.index.ts`**, so a consumer cannot reach it — see the open item in [`../roadmap/README.md`](../roadmap/README.md). |
| D12 | Published `dist` build + `.d.ts` | [`dist-build.md`](dist-build.md) | ✅ **built and verified** (`tsdown.config.ts`, `pnpm build:check`, `scripts/verify-dist.mjs`). Only the **cutover** is outstanding → [`../roadmap/dist-cutover.md`](../roadmap/dist-cutover.md). |

---

## 5. ❓ Open — the questions this research pass must close

| # | Question | Resolution | Status |
|---|---|---|---|
| O1 | **Styling & theming API** | **`className` + 3-layer `mergeStyles` precedence · `data-adaptv`/`data-part` two-axis state namespace · custom properties for runtime values ONLY · `@layer` so consumer CSS always wins · tokens = the consumer's Tailwind `@theme`. No `--adaptv-color-*`, no `::part()`.** Rationale: Ionic's `--ion-*` system exists to cross a *shadow boundary* adaptv doesn't have. → `docs/decisions/styling.md` | ✅ **CLOSED** |
| O2 | **TanStack facade** | **Tier 1 (curated barrel) shipped 2026-07-20; Tier 2 (full opacity) shipped 2026-07-25 with L20** — route files import from `@arrzdev/adaptv/router`, the consumer's `package.json` names no `@tanstack/*`, and the CLI's output is held to the same line by `bin/lib/opacity.mjs`. The 07-20 deferral of Tier 2 is recorded in the facade doc as history. Key insight, still true: safety and opacity are **orthogonal** — you don't need to hide TanStack to ban `createServerFn`. → `docs/decisions/facade-and-opacity.md §1, §3.3`, §3.2 above | ✅ **CLOSED** |
| O3 | **Enforcing the `createServerFn` ban** | **Layered, with a Vite `resolveId` hook inside `adaptv()` as the unbypassable backstop** (verified live), + Biome `noRestrictedImports` shipped via `extends`. The `server:{handlers}` config-shape gap is closed by a transform-hook scan inside the same plugin (`findServerRouteHandlers`) — the GritQL rule designed for it was never shipped, and there is no `plugins/` directory. Rejected with reasons: `@deprecated`, declaration merging, `exports` maps, pnpm strictness. → `docs/decisions/facade-and-opacity.md §2` | ✅ **CLOSED** |
| O4 | **Render default + deploy presets** | Web = SSR **or** static SPA+SW, consumer's choice; capacitor = SPA forced. Static deploy emits `index.html`/`404.html`/`.nojekyll`/`_redirects`/`_headers`. → `docs/design/rendering.md §3`, `docs/design/lifecycle.md §1.2`. **Default settled: `ssr`** — see [`rendering-and-delivery.md §1`](rendering-and-delivery.md) | ✅ **CLOSED** |
| O5 | **SW architecture** | **Navigation strategy is a pure function of `render`**: ssr → preload-or-network + precache fallback (never cache documents — it's a cross-user data leak); spa → `NavigationRoute`→shell; capacitor → no SW + active unregister. `serviceWorkerUpdate: "auto"` default, nav preload on **under ssr and off under spa** (it is a matched pair — `enable()` in activate *and* a handler that reads `event.preloadResponse`; enabled-but-unread costs two renders per navigation), activate-time cache sweep, `vite:preloadError` net. Stay on Workbox. → `docs/design/rendering.md §3` | ✅ **CLOSED** |
| O6 | **What to port from Ionic** + attribution | Partially answered (theming: **don't** copy — §O1; keyboard: use native events not `visualViewport`, per Ionic's own source comment). The **gesture controller / iOS input shims / back-button chain** inventory is still in flight. | 🔄 **in progress** |
| O7 | **Lint delivery** | **Biome 2.x — `noRestrictedImports` for imports, GritQL plugins for AST shapes.** Verified working end-to-end on the pinned 2.3.2. Note: `extends` resolves bare npm specifiers; `plugins` does **not** (needs an explicit `node_modules/` path). GritQL has no binding resolution — syntax matching only. → `docs/decisions/facade-and-opacity.md §2.3–2.4` | ✅ **CLOSED** |
| O8 | **Plugin picks — OTA** | **Capawesome `@capawesome/capacitor-live-update` (MIT, 8.3.0), self-hosted.** Genuinely backend-free; strongest signature story (RSA PEM + SHA-256). Appflow is **dead** (no new sales since 2025-02-11, sunsets 2027-12-31) — `@capacitor/live-updates` disqualified. **adaptv must force `readyTimeout`** (Capawesome defaults it to `0`, which disables rollback *and* `autoBlockRolledBackBundles`), and its value is bounded from below by the two-clock ordering in `docs/design/ota.md §5.4` — the rollback timer starts at plugin `init()`, not at document load. **The `Library/NoCloud/ionic_built_snapshots/` conformance is the plugin's own and already correct** (`LiveUpdate.swift:11`, "DO NOT CHANGE") — an earlier draft wrongly listed it as adaptv's job. **Two patches are adaptv's** (`patchedDependencies`, → `docs/design/ota.md §5.5`): resolve `rollback()`'s target to the last known-good instead of the embedded bundle, and make the version-changed branch drop the bundle pointer — without it, the first launch after every store release runs the pre-update OTA bundle against the new native layer (§5.3). → `docs/design/ota.md §5` | ✅ **CLOSED** |
| O8b | **Plugin picks — secure storage** | **`@aparajita/capacitor-secure-storage` 8.0.0** (MIT, 2026-02-10) — `KeychainSwift` on iOS, `AndroidKeyStore` + `AES/GCM/NoPadding` on Android. **`@capacitor/preferences` is plaintext** (`UserDefaults`/`SharedPreferences`, verified in source) and must never hold tokens. → B23 | ✅ **CLOSED** |
| O9 | **Capability scope** | in flight | 🔄 **in progress** |
| O10 | **Animation & transition substrate** | Partially: **`@starting-style` + `transition-behavior: allow-discrete` are usable (iOS 18 floor)** but **`overlay` is Chromium-only and unrequested in WebKit** — so top-layer `<dialog>`/popover exits break on iOS *permanently*. → build overlays as ordinary positioned elements with a JS presence hook, not the top layer. View Transitions can't do interruptible/gesture-driven. **Navigation API is now Baseline (Safari 26.2, Firefox 147)** but gives no gesture-progress surface, and `allowsBackForwardNavigationGestures` is `false` in Capacitor — so swipe-back is hand-built either way. | ✅ **CLOSED** by `docs/decisions/animation.md` |
| O11 | **Six-target test automation** | not yet answered. Real today: CI runs **four** web-only gates (typecheck, biome, biome:playground, vitest) and the native matrix is local-only. → [`../roadmap/open-questions.md`](../roadmap/open-questions.md) | ❓ **open** |
| O12 | **Ship source vs dist** | **Ship dist, built with `tsdown`, as TWO builds** (`platform: 'browser'` for the React surface, `platform: 'node'` for `/vite` + `/sw` + `/config` — a single build fails with `Could not resolve 'node:fs'`). Copy `styles.css` verbatim rather than building it. → [`dist-build.md`](dist-build.md) | ✅ **CLOSED** |
| O13 | **`patches.css` always-on rules** | **Doctrine, but layered.** They stay always-on; `@layer` removes the `!important`s so a consumer can override any of them with an ordinary rule. → `docs/decisions/styling.md §6` | ✅ **CLOSED** |
| O14 | **Config back-compat** | ❌ **Withdrawn, twice over.** The shape it would have migrated *to* was withdrawn (D4: the config went flat, `web`/`host` deleted → [`rendering-and-delivery.md §2`](rendering-and-delivery.md)), and the *migration itself* is the kind of thing adaptv does not carry: it is unpublished, so there is no install holding the old shape, and the code says so where a shim would go (`src/config/app-config.ts` `ROUTER_BUILD_KEYS`, `bin/lib/cli-parse.mjs`). An old key is deleted, never accepted alongside the new one. [`../roadmap/open-questions.md`](../roadmap/open-questions.md) already recorded this row as withdrawn; it was still reading as pending here. | ❌ **WITHDRAWN** |
| O15 | **Navigation model** | pending | ❓ **open** |
| O16 | **Signing/distribution** | **Stop at the artifact.** No fastlane. Unsigned `.ipa` + debug `.apk`; signed builds stay in Xcode ▸ Archive. → §5.0 | ✅ **CLOSED** |
| O22 | **Overlays — render or delegate?** | **Render. One overlay engine plus thin presets for alert, action sheet, toast, spinner and progress.** Decided by the owner, **2026-09-09**. The measurement that decided it: under `delegate` the web tier is `window.confirm`, and on both engines (iOS 26 simulator Safari, Pixel 10 emulator WebView) that is one string, two fixed buttons, no title, no third choice and no destructive styling — so a screen needing any of those has **no** web path. Delegating therefore does not replace the rendered engine, it adds a second implementation and a second accessibility model beside one adaptv must ship anyway. Two supporting facts: `BackPriority.Overlay` cannot hold an OS-owned dialog (the OS dismisses it before the app hears the press), so delegating puts the most modal thing in the app outside the mechanism that orders modality; and `Drawer` already supplies the overlay engine, gesture arbitration and positioning. **Rejected: delegate**, for the web tier above. **Also rejected: the render-except-Android-toast split** — defensible on the merits (Android's toast is a real affordance outside the app window and outlives navigation, which a rendered one cannot) and it was put to the owner explicitly, but a single engine across all six targets won over a per-platform exception. **The cost is accepted, not discovered:** accessibility for the five overlays is adaptv's work and is to be priced into the item. → [`../roadmap/open-questions.md`](../roadmap/open-questions.md) O22 | ✅ **CLOSED** |

### 5.0 Late closures

| # | Question | Resolution |
|---|---|---|
| O10 | **Animation substrate** | **Keep `motion`; adaptv builds no engine.** CSS (`@starting-style` + `allow-discrete`) for enter/exit, `motion` for gesture/interruptible/layout. Accelerated set is `transform`/`opacity`/`filter`/`backdrop-filter` only. **`composite:"add"` is banned** — Baseline-available, but it silently kills the Chromium compositor. **Overlays are ordinary positioned elements, not the top layer** — `overlay` is Chromium-only with no WebKit bug, so `<dialog>`/popover exits break on iOS permanently. → `docs/decisions/animation.md` |
| O12 | **Ship source vs dist / publishing** | ❌ **This closure is superseded — see the O12 row in §5 above and [`dist-build.md`](dist-build.md).** It read *"stay on raw source + git dependency until there's a second consumer"*, which the repo has since reversed: `tsdown.config.ts` exists, `pnpm build:check` verifies the output, and `package.json` `publishConfig` points at GitHub Packages. The one part still worth keeping is the constraint on the scaffolder, which has moved to [`../roadmap/create-adaptv.md`](../roadmap/create-adaptv.md): **`create-adaptv` is unclaimed on npm** — publish the *scaffolder* publicly (it is just prompts + file copying) and keep `@arrzdev/adaptv` private, which fixes the chicken-and-egg where you would need a PAT configured before you could run the tool that configures your PAT. |
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
> Generated from the app's installed dependencies. **Verified in project-zero:** empty with no
> relevant plugin; adding `@capacitor/preferences` correctly produces
> `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1`. Idempotent.
>
> #### ⚠︎ Amended (2026-08-13) — it was written, and it never shipped
>
> Two bugs, found together, both invisible for the same reason: this feature's whole premise is that
> a missing manifest fails **silently**, and every check anyone had was of adaptv's own filesystem.
>
> **1. It was never in the `.ipa`.** Xcode copies what `project.pbxproj` *declares*. The Capacitor
> template's `Resources` build phase lists six items and this was never one of them, so the file sat
> in `.adaptv/ios/App/App/` and no build ever picked it up — while `adaptv doctor`, which checks
> `existsSync`, reported it green. Confirmed by unzipping the `.ipa`: `Payload/App.app/` had
> `Capacitor.framework`'s and `CapacitorCordova.framework`'s privacy manifests, and none of the
> app's own. `stamp-privacy.ts` now registers it in the project too (file reference + build file +
> the `Resources` slot + the `App` group), and **throws** if it cannot find those anchors — a silent
> skip there would reproduce the exact failure the module exists to prevent. → the general rule:
> *a generated file is not a shipped file; verify inside the built `.app`/`.apk`.*
>
> **2. It ran at the wrong time — twice over.** The stamp used to live in `adaptv()`'s
> `target === "capacitor"` branch. On a first build in a fresh checkout it ran *before*
> `cap add ios`, found no destination, and silently no-opped; on a warm build the web bundle is
> fingerprint-cached, so Vite never starts and it did not run at all. `doctor` told the dev to
> "run `adaptv build ios`, which regenerates it" — advice that could not work the first time it
> was needed. It now runs from the CLI's `preparePlatform`, the one definition of "ready to sync",
> which is after the scaffold and outside the build cache. The old "no iOS project → return null"
> branch is gone: that silence *was* the bug, so the precondition throws instead.
>
> **3. And it was scanning the wrong dependency list.** Found while verifying the fix: the `.ipa` now
> contained a manifest, and the manifest declared **nothing** — on an app whose `Frameworks/`
> directory holds `CapacitorPreferences.framework`. `resolveRequiredReasons` read the *app's*
> `package.json`, which by design names `@arrzdev/adaptv` and no `@capacitor/*` at all (L20 — adaptv
> owns the plugins, the consumer installs none). So every adaptv app would have shipped an empty
> `NSPrivacyAccessedAPITypes` while linking a binary that reaches `UserDefaults`. That is worse than
> the original bug: not a missing declaration but a **false** one, the exact failure this generator
> was written to avoid. `doctor`'s missing-manifest rule was keyed off the same list and was dead
> code for the same reason — it could not fire on any real app. The bundled set now lives in
> `src/native/plugins.ts` and both read it (`linkedDependencies`), and `checkPrivacyManifest` gained
> an iOS-project gate so a web-only app is not told to fix a submission it will never make.
>
> **Verified end to end in project-zero**, all three: wiped `.adaptv/`, first build ⇒ manifest
> present at `Payload/App.app/PrivacyInfo.xcprivacy` inside the `.ipa`, declaring
> `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1`; warm rebuild ⇒ still four pbxproj entries,
> not eight; deleted the manifest ⇒ `doctor` reports it (it never could before) and the fix it
> prints actually restores it.
>
> **The plugin→API map is a small explicit table, not static analysis.** The mapping is *Apple policy,
> not code structure* — it changes when Apple changes the rules, not when the plugin changes. A table a
> human can read and correct beats anything inferred from source.
>
> **Data collection is deliberately left empty.** `NSPrivacyCollectedDataTypes` depends on what the app
> does with analytics, accounts and telemetry, which adaptv cannot know. A guessed declaration is worse
> than none — it is a false statement to Apple and to users. The generated file says so in a comment.
>
> ### ⚠️ CORRECTED (2026-08-07) — it was deriving from the wrong list
>
> "From the app's installed dependencies" was the bug, not the feature. **adaptv owns Capacitor**,
> so `@capacitor/device` and `@capacitor/preferences` are *adaptv's* dependencies and appear
> nowhere in the consumer's `package.json`. Every manifest adaptv had ever generated therefore
> declared **nothing**, while the binary shipped two required-reason APIs — the silent-at-submission
> failure this feature exists to prevent, reproduced by the feature itself. The verification in the
> note above passed because it added `@capacitor/preferences` to the *app*, which no real app does.
> `adaptv doctor`'s matching rule was gated on the same list and so never fired either.
>
> Now three tiers, in `stamp-privacy.ts`: **(1)** adaptv's own bundled `@capacitor/*` set, read from
> adaptv's manifest so a plugin added to adaptv is covered with no second list; plus the app's own
> deps and its `plugins` registrations. **(2)** the plugin's own `PrivacyInfo.xcprivacy` if it ships
> one — Apple's actual third-party-SDK mechanism, more authoritative than adaptv's table and correct
> without an adaptv release. **(3)** `privacy` in `adaptv.config.ts`, the escape hatch: unlisted
> plugins' APIs, `NSPrivacyTracking`, tracking domains, and `NSPrivacyCollectedDataTypes`.
>
> **Tier 3 is not a nicety.** The file is regenerated on every build, so "data collection must be
> declared by you" — which the generated file said, in a file marked *do not edit* — had nowhere to
> be declared. adaptv still never *infers* collection; it renders what the app states.
>
> The doctor rule is now unconditional for any iOS project (`hasPrivacyManifest` is left `undefined`
> when there is no project, so web-only apps stay quiet).
>
> **Two more failures a real `preview ios` found, both invisible to every test:**
>
> - **It was never written on a first run.** The Vite plugin stamps during the capacitor web
>   build, which happens BEFORE `cap add` creates the project — so the stamper found no
>   `.adaptv/ios/App` and skipped. The file appeared only on a second build: correct on the
>   machine that had built twice, missing on CI and on a fresh clone. The CLI now stamps too
>   (`stampIosPrivacyManifest`, after the project exists), and must pass `adaptvRoot` explicitly
>   because `load-ts.mjs` bundles the module into a `data:` URL where `import.meta.url` cannot
>   locate adaptv.
> - **It was never bundled.** Xcode copies a file into the `.app` only if the target's Resources
>   build phase lists it, and nothing listed this one. Generated, committed, visible — and absent
>   from the binary Apple receives. `mergePbxprojResource` now declares it (build file, file
>   reference, Resources phase, and the navigator group), with stable ids so re-running is a
>   no-op. **Verified in the installed simulator bundle**, not just on disk.
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
bearer token** (`docs/design/rendering.md §2`), a token in `storage.kv`/`storage.secure` means **the user is logged
out on first launch of the installed PWA**. If preserving session across install matters, the token must
be in a cookie at install time. This belongs in `docs/design/architecture.md §2.3`'s threat-model note.

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
- **Dexie is at 4.4.4 — there is no Dexie 5.** `docs/design/architecture.md §2.2`'s Dexie choice stands.

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
| **Capacitor 8 ships a core `SystemBars` plugin** that already owns Android insets + IME, registered unconditionally. | **`@adaptv/shell` is redesigned: layer on it, don't replace it.** A second inset listener *is* the collision behind keyboard bugs #61/#68. The plugin gets smaller and less risky — but stops being "the wedge vs Ionic." → `docs/roadmap/native-shell-plugin.md §0.0` |
| **`@capacitor/status-bar` is silently half-dead on API 35+**: `setBackgroundColor` and `setOverlaysWebView` both *resolve successfully and do nothing*. Maintainer: *"if you are using edge to edge, remove status bar plugin."* Google Play now warns about it. | Drop the dependency; tint via a web-layer scrim + `SystemBars.setStyle()`. |
| **`Keyboard.resizeOnFullScreen` is dead code on Capacitor 8** — its only consumer early-returns whenever `SystemBars` is present, which is always. | Remove from any adaptv config surface. |
| **Apple's OTA rule is not §3.3.2.** Review Guideline **2.5.2**; DPLA **§3.3.1(B)**, and the "WebKit/JavaScriptCore" phrasing was **deleted** — the rule is now purely behavioural and *more* permissive. | `docs/design/ota.md §5.1` corrected; `../decisions/prior-art.md §12.2` still needs the fix. |
| **`createServerFileRoute` does not exist** in the pinned `@tanstack/react-start@1.167.13` — replaced by a `server` property on `createFileRoute`'s options. | A config-object property, so **no import-restriction technique can catch it**. Needs the GritQL rule. `docs/design/rendering.md §2` is stale. |
| **TanStack Start SPA mode emits `_shell.html`, not `index.html`.** GitHub Pages' Jekyll **strips `_`-prefixed files**; Cloudflare Workers Assets looks for `/index.html`. | adaptv must emit `index.html` as a copy, plus `.nojekyll`. |
| **Capacitor 9 is in alpha** with a `// TODO: In Cap 9, add "full"` beside `SystemBars.insetsHandling`. | The inset contract changes again — don't freeze `@adaptv/shell`'s API against Cap 8. |
| **Ionic's CLI is frozen** (no release since 2025-03-18; its React starter pins Vite **5** vs current 8.1.5, React Router **5**, vitest 0.34) while `@ionic/react` ships nightly. The non-Ionic Capacitor+Vite+React niche has **nothing above 30 stars**. | The market gap adaptv targets is real and currently unfilled. |

---

## 6. Bugs found during the audit (independent of any decision)

Filed here so they don't get lost in the design discussion.

| # | Bug | Location | Severity |
|---|---|---|---|
| B1 | ✅ **CLOSED** — the worker is registered at `import.meta.env.BASE_URL + "sw.js"` with `updateViaCache: "none"`, the same base `unregister-foreign-service-workers.ts` uses (`da4ced8`, #1). No test pins the base. | `src/vite/virtuals.ts` | **high** for static hosts |
| B2 | ✅ **CLOSED** — `default-worker.ts` passes its build tag to `registerServiceWorkerLifecycle`, which sweeps every `static-`/`pages-`/`documents-` bucket from another build on activate and leaves foreign caches alone (`da4ced8`, #1); pinned by `sw.lifecycle.test.ts`, `sw.navigation-policy.test.ts` and `playground/e2e-sw/update.spec.ts`. | `src/sw/sw.lifecycle.ts` + `sw.navigation-policy.ts` | **high** |
| B3 | ✅ **CLOSED** — nothing reloads mid-session: under `serviceWorkerUpdate: "auto"` (the default) a waiting worker is applied only at the next cold launch, and under `"prompt"` only when the app calls `applyServiceWorkerUpdate()` (`da4ced8`, #1 made `prompt` the default; `310f7ba`, #59 gave it this shape; → `docs/design/rendering.md §3.4`). Pinned by `virtuals.test.ts`, `playground/e2e-sw/update.spec.ts` and `update-prompt.spec.ts`. | `src/vite/virtuals.ts` | **high** |
| B4 | ✅ **CLOSED** — `installPreloadErrorRecovery` listens for `vite:preloadError`, reloads once per session, and is armed by both `registerPwaServiceWorkerRuntime` and `shell-layout.tsx`, which renders the offline UI when the guard is spent (`da4ced8`, #1); pinned by `preload-error-recovery.test.ts`. | `src/shell/preload-error-recovery.ts` | **high** |
| B5 | ✅ **CLOSED** — `sw.warm-routes.ts` is deleted, the worker has no write path for documents, and `ignoreVary` is on only for content-hashed assets (`da4ced8`, #1); pinned by `sw.strategies.test.ts` and `playground/e2e-sw/registration.spec.ts`. → B25 | `src/sw/sw.navigation.ts` + `sw.strategies.ts` | **privacy** |
| B6 | ✅ **CLOSED** — the `dev-sw.js?dev-sw` special case is gone; the file matches only `sw.js` under `BASE_URL` (`da4ced8`, #1). | `src/shell/unregister-foreign-service-workers.ts` | cosmetic |
| B7 | ✅ **CLOSED** — `src/components/screen.tsx` is gone and appears in neither barrel; `VISION.md §5` documents the removal and the reason (the frame is owned above the route). | — | consistency |
| B8 | ✅ **CLOSED** — every primitive routes through `mergeStyles` with an explicit `locked`, asserted per-primitive in `style-precedence.test.tsx`. → §3.1 | `src/components/*` | **contract** |

---

## 6.0 ⏰ Time-sensitive — act on these first

### B9 — Google Play requires target API 36 by 2026-08-31 ✅ **FIXED**

**Shipped 2026-09-02.** The Android project adaptv generates targets API 36, and adaptv owns that
number rather than inheriting it. It had in fact been there all along: the pinned `@capacitor/cli`
template (**L21** pins it exact) already writes `compileSdkVersion = 36` and `targetSdkVersion = 36`
into `.adaptv/android/variables.gradle`, so every project adaptv scaffolded met the deadline by
inheritance — and nothing in adaptv knew it. Now `src/native/android-sdk.ts` holds
`ANDROID_SDK_LEVELS = { compile: 36, target: 36 }` as the single source, and `stampAndroidSdkLevels()`
writes both into `variables.gradle` on **every** Android prepare — the freshly scaffolded project and
the one that already existed alike (both branches of `capAddIfMissing` in `bin/lib/native.mjs`,
through `writeIfChanged`, so an unchanged file is not rewritten). That is the difference between
inheriting and owning: a project scaffolded by an older template, or a later requirement bump in
adaptv, reaches an existing `.adaptv/android` instead of waiting for the dev to delete it. A test
extracts the real template from the pinned tarball and asserts that its pin is at or above adaptv's
requirement and that the stamp is a no-op on it — so a template bump that lowers the level, or a
requirement bump the template has not caught up to, fails in the suite rather than on Play.

**The doctor check was dead on adaptv's own project.** `checkAndroidTargetSdk` in
`src/native/doctor.ts` warned on a `targetSdk` below 36 — but doctor fed it
`.adaptv/android/app/build.gradle`, which says only `targetSdkVersion rootProject.ext.targetSdkVersion`.
No digits, so the regex never matched, `null` came back, and the warning could not fire on any project
adaptv generated; its tests only ever saw synthetic strings. Doctor now reads `variables.gradle`
(`readAndroidTargetSdk()`; the input is `androidVariablesGradle`, the old one deleted), and the test
that would have caught this feeds it the real `app/build.gradle` text and asserts `null`. The check
stays as a guard for the window between a level lowered by hand and the next Android prepare, which
raises it again; it is no longer the only thing standing between the app and the deadline.

**Device result.** Measured on an Android 17 emulator (API 37.1, edge-to-edge enforced, Pixel 10
image), reading the installed APK's `targetSdkVersion` and the injected `--safe-area-inset-*` over CDP:

`adaptv build android` on a probe copy of the playground (Android 17 emulator, API 37, WebView 149,
1080×2424 at 420 dpi): `aapt dump badging` on the `.apk` reads `targetSdkVersion:'36'`,
`compileSdkVersion='36'`, `sdkVersion:'24'`; `dumpsys package` on the installed app agrees
(`targetSdk=36`). Over CDP, with the running `assets/index-*.js` matched against the APK's own copy
first, `--safe-area-inset-top` is `54px` and `--safe-area-inset-bottom` is `24px`, `innerHeight` is
`923` on a 923-pt panel — the WebView spans the whole screen, both bars are transparent over the
app's own `rgb(10, 10, 12)`, and the status-bar icons are light on dark. A `variables.gradle`
lowered to 35 by hand is raised back to 36 on the next `build android` and the APK targets 36
again; `doctor` names it in between.

A **physical** API-36 panel is still owed — the system-bar treatment on real glass →
[`../roadmap/owed-device-verification.md`](../roadmap/owed-device-verification.md) row 7.

Consequences, all verified against `developer.android.com` and still true platform facts:

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
> `@capawesome/capacitor-android-edge-to-edge-support` for new work — prefer core (see `docs/roadmap/native-shell-plugin.md §0.0`).

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
> | **Imperative** `haptics.impact()/notify()/selection()` | `capabilities/haptics.ts` | native, Android/Chrome web, iOS web before 26.5. **Reports success and fires nothing on iOS 26.5+ web — documented in the module header.** |
> | **Declarative** `attachHapticTick()` / `useHapticTick()` | `capabilities/haptic-tick.ts` | all six targets; inert (zero DOM cost) wherever a real engine exists |
>
> **The public API did not have to break.** `Button haptic="light"` was *already* declarative at the
> consumer's level — a prop on an element — so it now routes through the transducer and keeps working
> everywhere. Every future tap-triggered haptic must do the same.
>
> **The `<input switch>` + `.click()` branch was removed here, then restored in `2c134c9` (#39)** by
> owner decision, so haptics stays one imperative hook. It is live in `utils/install-vibrate-polyfill.ts`:
> it fires the tick before iOS 26.5, and on 26.5+ it still *reports success* while firing nothing, which
> its header and `capabilities/haptics.ts` document.
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
location off globally. Since `docs/design/architecture.md §4` names this file the template for every
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

**Two MDN corrections worth knowing** (both verified against engine source): Safari **has** been passive-by-default for `touchstart`/`touchmove` since **iOS 11.3**, contra MDN; and **`document.documentElement` IS in the root-target set** in all three engines, so reaching for `<html>` to escape the rule doesn't work. `preventDefault()` in a passive listener fails **silently** — console warning, never an exception. `Slider` (`src/components/slider.tsx`) joins `Button`, `Swipeable` and the drawer handle in the family that depends on this: it registers all four pointer listeners so `pointercancel` reaches it on iOS and ends the drag, and its root uses the longhand `pan-y pinch-zoom`, never `manipulation`.

### B20 — accessibility: two decisions adaptv must own, because nothing above the shell can

**1. Modal backdrops use `inert`, never `aria-hidden` — and `aria-modal` contains nothing.**

Both engines fail the same way, independently documented:
- **WebKit [239295](https://bugs.webkit.org/show_bug.cgi?id=239295)** (NEW) — WebKit's own James Craig states true inertness requires **`inert` or the dialog API, not `aria-modal` alone**.
- **Chromium [397294118](https://issues.chromium.org/issues/397294118)** — `role="dialog"` + `aria-modal="true"` does **not** contain TalkBack either.
- **WebKit [201887](https://bugs.webkit.org/show_bug.cgi?id=201887)** (NEW since 2019, reconfirmed 2022) — *"content with `aria-hidden` attributes is read in Safari by VoiceOver"*, including a11y-dialog modals.

`inert` is Baseline widely-available (Safari 15.5+), removes elements from the a11y tree, and blocks focus, find-in-page and selection. **Since `docs/decisions/animation.md §4.1` already decided against the top layer, adaptv's `Drawer`/`Sheet`/`Modal` must apply `inert` to the background themselves** — there's no `<dialog>` doing it implicitly. Verify on device: at least one report in 201887 has `inert` *also* failing in Safari.

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

**So on iOS 26+ the status-bar tint comes from your actual rendered `html`/`body` background near the top edge, not from a meta tag.**

**Measured, not inferred.** The paragraph above used to end "probably already correct by accident". It was verified on an iOS 26.1 simulator with a probe page painting three *different* colours — one on `html`, one on `body`, one on the app's own content — and the meta tag set to a fourth that appeared nowhere else:

| Surface | iOS 18 | iOS 26.1 |
|---|---|---|
| meta `theme-color` | drives the top bar | **inert — the colour never appears anywhere on screen** |
| `html`/`body` background | anti-flash only | **drives both bands: the status bar AND the bottom home-indicator area** |
| app content painted to the edge | covered by the solid bar | **wins — the bars take the content's own edge pixels** |

Two consequences the citation alone did not give. First, it is **both** bands, not just the status bar — so the same paint answers the bottom of the screen too. Second, because content that reaches the edge wins over the shell, an app whose views cover the whole viewport controls the bars *with its own pixels*; the `html`/`body` paint is what shows in the safe-area bands the content leaves. iOS 18 is the exact opposite: the solid bar is painted over the content and only the tag moves it.

So the background paint is **load-bearing**, not merely anti-flash, and `useSyncTheme` writes both outputs deliberately — neither covers the whole matrix. Keep `theme-color` for Android/Chrome and iOS ≤ 18. **Firefox has never supported it at all.**

### B32 — the chrome tint leads its curve by **half a frame**, and that number was measured

`transitionChromeTint` (and so the drawer's dim) does not write the tint for *now*. It samples the
curve half a frame ahead. Recording the reason, because the constant looks arbitrary and the obvious
"fix" — rounding it to a whole frame, or deleting it — makes the thing it fixes come back.

**The problem.** Page pixels are composited by the *renderer*. The browser toolbar is painted by the
*browser process*, which only learns about the tag an IPC hop later. So a `theme-color` written during
frame N shows up part-way through the next one, while a compositor-driven `opacity` on the same curve
is already correct in frame N. Both were on one curve, started in the same task, within ~2–3 ms of each
other at the DOM — and the toolbar still visibly trailed the scrim. The user's report was exactly right:
*"chega-se a notar que o backdrop não é uma cena só"*. It read as a second thing chasing the backdrop.

**The measurement.** An iOS 18 simulator, 60fps `simctl io recordVideo`, with the toolbar and the scrim
sampled from the **same video frames** — the only way to compare two surfaces that no single API can
read together. Offsets taken in the time domain over the steep part of the open, three runs each:

| lead | median offset (+ = toolbar trails the scrim) |
|---|---|
| none | +13.9 +16.0 +11.0 ms |
| **half a frame** | **+1.3 −5.0 −0.1 ms** |
| a full frame | −10.0 −2.8 −13.0 ms |

Half, not one, because the toolbar's paint lands *inside* the frame after the write rather than at the
end of it. A full frame overshoots into visibly running ahead. The lead is a fraction of the last frame's
**measured** interval, so a 120Hz screen leads by its own 4.2 ms — capped at two 60Hz frames, because a
longer gap is a stall (a dropped frame, a backgrounded tab), not a refresh rate.

**What guards it, and what does not.** `playground/e2e/chrome-tint.spec.ts` asserts the tag stays locked
to the backdrop's own **curve**, frame by frame. It does **not** measure the half-frame lead, and an
earlier version of it that claimed to was wrong — it failed about one run in three, and instrumenting the
cadence ruled out the obvious culprit: 8.3 ms median frame, 8.5 ms p90, zero long frames on the failing
runs too. The confound is **start alignment**. The scrim's clock begins at a style flush and the tween's
begins when its JS runs; those land one or two frames apart, differently each time, which shifts the whole
offset series by a constant far larger than the 4 ms being looked for. Taking the lead back out and
comparing distributions settles it — medians of five opens:

| build | medians across runs |
|---|---|
| no lead | −0.047 −0.029 −0.015 −0.012 |
| lead | −0.014 −0.009 −0.005 −0.002 −0.002 −0.001 +0.001 +0.002 +0.003 |

They overlap, so **no threshold separates them** and one placed between two lucky runs would look like a
regression test while catching nothing. The lead is verified by the device capture above, which is the
surface that actually matters.

What the DOM *can* hold is the **shape**: a constant start offset shifts every sample equally, so it
cannot change how much the offsets vary across the moving window — and that variation is exactly the
difference between a tint on the scrim's curve and a tint doing something else. Healthy it sits at
0.011–0.013; a snap reads 0.46 and a wrong duration 0.16, both verified by deliberately breaking the
tween. The bound is 0.06, and the test survived six consecutive runs at load average 25 where the old one
failed two in three at load 3. It is chromium-only, and the reason is itself measured: on the first frame
that can observe the overlay's animation, Chromium reports `currentTime` 0.0 and WebKit reports 17.0, so
WebKit hands the scrim a frame of head start that exists only at the DOM. See B17 for why this whole
feature is an Android/Chrome + iOS ≤ 18 progressive enhancement in the first place.

### B30 — adaptv installs **no** runtime error boundary; runtime errors are the app's

A framework-level catch-all for render errors was built, tested, and then deleted. Recording why, because
it is the kind of thing that looks obviously missing to the next person who goes looking for it.

**Not `defaultErrorComponent`, and this is the part that is quietly wrong.** From the router's `Match.js`:

```js
const routeErrorComponent = route.options.errorComponent ?? router.options.defaultErrorComponent
const ResolvedCatchBoundary = routeErrorComponent ? CatchBoundary : SafeFragment
```

With no error component set anywhere, every match renders `SafeFragment` — **no boundary at all** — so a
render error bubbles past the whole match chain to the nearest boundary the *app* installed. That is not
an accident consumers tolerate; it is the behaviour they build on. The playground's `CatchBoundary`,
mounted in a providers layout route, works for exactly this reason. Setting `defaultErrorComponent` flips
every match to a real boundary and takes those errors one level too early — silently assuming error
handling the app already owns, with no error, no warning, and no way to notice beyond a boundary going
quiet. The root route's own `errorComponent` is worse still: the router wraps the root match's
`MatchInner`, which is what renders the document, so the fallback would replace `<html>` itself.

**Nor a plain React boundary inside the shell**, which is what actually shipped for a while. It was
strictly additive — React offers an error to the innermost boundary that can take it, so a consumer
boundary always won and this one saw only what escaped everything. It worked. It was still removed:

- **It is not adaptv's error to have an opinion about.** Only the app knows what belongs on the screen
  when one of its routes fails. A framework default that renders *something* there is a default that has
  to be un-chosen, and the appealing version of it is the one that quietly competes with the app's own.
- **It cost a public surface out of proportion to the floor it added.** `errorComponent` in config, a
  boundary component, a reset-key policy, and a second meaning for the same error screen — for a case the
  app is already expected to handle, and handles better.

What it protected against was React 19 unmounting the whole root on an uncaught error — a blank screen.
That is real, and the answer is one boundary in the app, which is the thing every app already writes.

**One trap worth keeping, for whoever writes that boundary:** clear it on the router's `loadedAt`, not on
`location.href`. The href changes when a navigation *starts*; clearing on it re-renders the children while
the outlet is still resolving the old match, which throws again — and by then the key has moved, so the
boundary re-arms against it and never recovers. `loadedAt` moves when a load *completes*. It is what the
router's own match boundaries key on, for the same reason. This was found by an end-to-end test, not by
reading the code.

What adaptv *does* own is the bundle that never executed, where there is no app code to have an opinion —
**B31**. → `docs/design/rendering.md §3.1.3`

### B31 — a sandbox does not survive a broken bundle; a build-time render does

The bundle that never executes — syntax error, 404 on the entry chunk, corrupt OTA bundle — is the case
no boundary can reach, because React never runs. The obvious answer is to isolate the error screen in an
iframe or some other sandbox. **It does not work, and the reason picks the design that does.**

A sandbox isolates the *execution scope*: fresh globals, clean context. But you still have to load a
script into it, and a script from a broken build is broken inside the sandbox too. The thing that has to
be isolated is the **build graph**, not the runtime. Once that is the framing, two options remain:

| | Prerender at build time | Second isolated bundle |
|---|---|---|
| Delivery | `react-dom/server` → HTML in the document | own vite input, own Preact, own ES target |
| Runtime cost | none | an eager bundle on every load |
| Robustness | only needs the document to have loaded | only as good as *its own* import graph |
| Gives you | markup | a live, interactive component |

**Prerender wins for this screen.** A title, a line of copy and a retry button do not need hooks; the
second bundle buys interactivity nobody uses here and adds a subtler failure mode — a consumer error
component that imports an app util re-enters the graph that is already broken, and nothing says so.

Implementation notes worth not rediscovering:

- **The whole thing is bundled, React included.** `loadAppConfig`'s `data:` URL trick only works for a
  bundle with zero static imports — a `data:` module has no parent path, so it cannot resolve a bare
  specifier. The generated entry therefore pulls the renderer *in* and exports the finished HTML string.
- **`react-dom/server` is CJS**, and esbuild's interop emits a `require`, which an ES module does not
  have. Fixed with a banner that builds one via `createRequire` rooted at the app. Without it the bundle
  dies on `Dynamic require of "util"`.
- **React must be forced to a single instance, resolved from the app.** The generated entry resolves
  `react` beside the *app*; adaptv's own screen resolves it beside *adaptv*. Under pnpm those are
  different stores even at an identical version, so the bundle gets two Reacts and the render dies on
  `Cannot read properties of null (reading 'useRef')` — one copy's hook dispatcher, read by the other. An
  esbuild `onResolve` plugin routes every `react`/`react-dom` specifier through a `createRequire` rooted
  at the app, exports maps and all. **Every unit test missed this**, because they all pass adaptv's own
  root as `appRoot`, where there is only one copy to find; the first real app build caught it, which is
  precisely what the loud warning below is for. The regression test now traps the app's
  `react/jsx-runtime` — the component's import, not the entry's, since only that one discriminates.
- **Tailwind is free**: `styles/index.css` already declares `@source "../**\/*.{ts,tsx}"`, so the
  classes are in the app stylesheet — a different file from the JS that broke.
- **The reveal policy is "only while the mount point is empty"**, which needs no boot flag and makes it
  impossible to replace a slow-hydrating SSR page with an error screen.
- **A failed prerender warns, never fails the build.** An app must still ship without its boot fallback.
- **The failure arrives as a `code` PROP, and adaptv's own screen never renders it.** `BOOT-LOAD` /
  `BOOT-THROW` / `BOOT-REJECT` / `BOOT-STALL`. The distinction earns its keep — `LOAD` is a deploy or CDN
  problem, `THROW`/`REJECT` mean the file arrived and its code is broken, `STALL` means it ran, raised
  nothing, and still never mounted — but whether to *show* any of that to a user is a product decision,
  so the framework hands it over and stays out of it. Also stamped on `<html data-adaptv-boot-failed>`
  for telemetry and e2e.
- **A prop is what forces four prerenders instead of one.** Static markup cannot be handed a prop at
  reveal time, so the component is rendered once per code and the watchdog reveals the matching copy.
  Identical renders — which is what a component that ignores `code` produces, adaptv's default included
  — collapse back to a single copy, so the mechanism is free to anyone not using it.
- **It works only because the value space is closed**, and that is the load-bearing condition. Four
  codes, four renders: exhaustive enumeration, not injection. `code` is therefore the *only* prop the
  fallback path can pass — `error`, `errorInfo` and `reset` are not enumerable (an infinity of messages
  and stacks, and a live function), so they are `undefined` there. A component that dereferences `error`
  unconditionally throws during the **build**, which is the right place to find out.
- **Any `<button>` in the fallback reloads; nothing is asked of the component.** Its `onClick` was never
  serialized, so something must wire the screen's only action. Requiring an opt-in attribute was the
  first design and the wrong one — a forgotten spread would produce a dead button at the exact moment a
  reload is the only way out, i.e. a silent failure (L7). The blanket rule is sound rather than lucky:
  in a document with no app JavaScript a button *has* no other reachable behaviour. Anchors navigate
  natively and are left alone. `bootErrorRetryProps` survives as the precision tool for a screen with a
  second button that must not reload.

**Where the line sits, and it is deliberate.** A route that fails, a throw nobody caught, data that is
not there — handling *those* well is the app's job, because only the app knows what to show instead.
adaptv owns the case the app never got to have an opinion about: the bundle that passed the build and
died on the first load, where the WebView is black and no app code has run. `boot-failure.test.ts` is
that scenario end to end — real prerendered component, real emitted document, real watchdog, entry script
killed. This is the *whole* of adaptv's error surface; the runtime side is B30, and B30 is a decision not
to have one.

✅ **Adjacent, now verified — and the reason it was safe was not the stated one.** `buildWeb` in
`bin/lib/native.mjs` copied `_shell.html` over `index.html` when it existed, which clobbers the emitted
shell and the fallback with it, on native. The note here used to say the build produces no `_shell.html`
so it never fires. **That is false.** Measured on the playground frontend at `render: "ssr"` built with
`ADAPTV_TARGET=capacitor`:

```
14:56:23.438744  index.html     ← shell-emit (adaptv's, with the fallback)
14:56:23.438848  404.html       ← static-host, same tick
14:56:24.788440  _shell.html    ← Start's prerender, ~1.35s LATER
```

The file **is** there, so the copy **did** fire on every native build. It was harmless only because the
two documents are currently byte-identical (`diff` clean) — Start's SPA shell round-trips adaptv's
document unchanged. That is a coincidence owned by a dependency, not an invariant: a Start bump, a
different adapter, or prerendering more than one page breaks it, and the breakage is silent and lands
exactly where it hurts most — the native target, where a corrupt OTA bundle is the failure the fallback
exists to catch (`docs/design/ota.md §5.4e`).

**Fixed by deletion.** `shell-emit` runs unconditionally and always writes `index.html`, so the copy was
vestigial as well as hazardous; `buildWeb` now requires `index.html` and never prefers `_shell.html`.
The rule it encodes: *adaptv generates its shell, so it never adopts someone else's.*

> Consequently the older blanket claim — "TanStack Start emits no HTML in this configuration" — is
> **stale** where it appears in `shell-emit.ts`'s docstring. It still holds for the Cloudflare-adapter
> measurement in `static-host.ts` (a different configuration), which is why adaptv generating its own
> shell remains load-bearing either way.

### B29 — the Android system NAV bar is browser/OS-owned on web + PWA; only native controls it

The recurring ask — *"make the bottom bar follow the app theme"* — is achievable on **native** and
nowhere else on Android, and that is a **platform ceiling, not an adaptv gap**. Verified exhaustively on
two emulators (Pixel 7 = Chrome/WebView 113; Pixel 10 = Chrome 149) with CDP + a repro that flips
`html`/`body` background + `color-scheme` + `theme-color` together, installed as a standalone PWA, against
device light/dark.

`theme-color` only ever colours the **top** bar; the bottom **nav** bar never follows the app:

| surface | top status bar | bottom nav bar |
|---|---|---|
| **Native (Capacitor)** | app theme (SystemBars icons + edge-to-edge) | **app theme** — bg painted under a transparent bar |
| Web · browser tab · Chrome 113 | `theme-color` | **device theme** (not edge-to-edge; `safe-area-inset-bottom` = 0) |
| Web · standalone PWA · Chrome 113 | `theme-color` | **opaque black** |
| Web · browser tab · Chrome 149 | browser's own | **app *background*** — but only while scrolled (the edge-to-edge "chin"); address-bar-visible reverts to the device |
| Web · standalone PWA · Chrome 149 (shortcut) | device theme | **device theme** — `theme-color`/bg ignored |

The decisive test: a RED app (`theme-color:#e60000`, red bg) still gets black/white system bars that flip
with the **device** theme, not the app. `theme-color` is a dead end for the nav bar — there is no
meta/manifest/CSS that colours it directly (*"no feature in PWA that allows specifying navbar colour
alone"*).

**The only mechanism that ever colours the nav bar is edge-to-edge** — the app draws under the bar and its
own background shows through. Native does this on **every version** (`setDecorFitsSystemWindows(false)` +
the inset listener, including old WebView < 140 where SystemBars injects zeros — see `docs/roadmap/native-shell-plugin.md` and
#30/#35). Chrome browser tabs do it partially from 135+ (the retracting "chin"); standalone WebAPKs do it
inconsistently. So the honest answer to a dev: **the browser owns its chrome. adaptv already sets every
page-level signal (`theme-color`, `color-scheme`, `html`/`body` bg, `viewport-fit=cover`) correctly, and
the INSTALLED app — the whole reason adaptv exists over a PWA — is where both bars follow the theme.** This
is why the status-bar lab page marks web/pwa as `absent`.

One caveat left unproven: the Google-APIs emulators can't mint real WebAPKs (`Install` degrades to a
home-screen shortcut, which is NOT edge-to-edge), so whether a *real* WebAPK on a physical device with
modern edge-to-edge Chrome tracks the app *background* under the nav bar is the single open question.
Everything else here is settled on-device.

> **⚠︎ Read B25–B26 as design constraints, not a defect list.** `src/` is the code lifted from
> chopchop's `packages/adaptv`; most of it is expected to be refactored for the standalone package. The
> value of these entries is **the pattern to avoid carrying forward**, not the line numbers.

### B27 — the Drawer's vaul attribution links point at `main`, and will rot

`src/components/drawer/drawer-constants.ts` and `drawer-engine.tsx` already carry good provenance
comments (`"Tuning mirrors vaul…"`, `"@see vaul dampenValue in helpers.ts"`, `"vaul: moved upwards —
reset, don't close"`). That convention is right, and was arrived at independently of `docs/decisions/prior-art.md §0`.

**Two fixes:**

1. **Repin the links to a SHA.** They currently target
   `github.com/emilkowalski/vaul/blob/**main**/src/constants.ts`. vaul is unmaintained so `main` is
   frozen *today*, but a force-push, a rename, or an archive breaks every link and — more importantly —
   the reader loses the ability to diff what changed. `docs/decisions/prior-art.md §0` is explicit: **pin the SHA,
   never `main`.**
2. **✅ `THIRD_PARTY_LICENSES` created** (2026-07-20), carrying the vaul MIT notice (© 2023 Emil
   Kowalski) and the Ionic notice (© 2015-present Drifty Co.) pre-staged for the port. vaul is not a
   dependency — this is lineage only, and the current references read as technique-and-constant sourcing
   rather than substantial copying, so the notice requirement is arguably not triggered. Included anyway:
   it costs nothing and removes the ambiguity permanently.

> **The general rule this establishes** (`docs/design/architecture.md §5.5`): **"we outgrew this library" is the
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
> per-request and carry a session. → `docs/design/rendering.md §3.2` now draws that line explicitly, and `ignoreVary`
> becomes per-rule (safe on hashed assets, dangerous on documents) rather than a global default.

### B26 — three more P0s in the SW, all verified against source

> **Closed 2026-09-13:** all three P0s and every lower-severity item below are fixed in the current
> source. `da4ced8` (#1) landed the `BASE_URL` registration with `updateViaCache: "none"`, the
> `vite:preloadError` net, the activate-time sweep of previous builds' runtime caches, `CacheFirst`
> for hashed assets, the defensive unregister on native (`destroyServiceWorkers()` behind
> `isNativePlatform()` in `src/shell/service-worker-shell.ts`, → `docs/design/rendering.md §3.5`) and
> the removal of the `dev-sw.js?dev-sw` case. It also stopped the mid-session reload; `310f7ba` (#59)
> replaced that code with `serviceWorkerUpdate`, which applies a waiting worker only at a cold launch
> (`auto`) or on the app's call (`prompt`). Each is closed in the §6 table (B1–B6). Nothing from this
> entry is still open.

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
static deploy path (`docs/design/lifecycle.md §1.2`) is not actually deployable as designed. *(Fixed: the files are
emitted for every `render: "spa"` build on the **web** target — the `target: "capacitor"` half of that
gate was itself a bug, and cost every native bundle three files it cannot use. §6.4.)*

> **⚠︎ Reliability caveat, stated because the source agent stated it:** this report self-marked several
> sections `[CUTOFF]` and relied on training knowledge rather than fetched sources for the Workbox,
> vite-plugin-pwa and Serwist *ecosystem* claims — treat those as weaker than `docs/design/rendering.md §3`, which
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
  spec-correct fix (Chrome 144) does not.** `docs/decisions/animation.md`'s CSS enter/exit path survives; the
  scroll-containment story on old Android does not.
- **Capacitor's `minWebViewVersion` default of 60 is functionally dead** — Chromium 60 shipped in 2017,
  so the built-in gate can never fire on any device that runs Capacitor 8. **adaptv should set it
  explicitly and ship an `errorPath` page** — the only supported way to fail gracefully instead of
  white-screening. Caveat from the docs: *"On Android the html file won't have access to Capacitor
  plugins."* ✅ **DONE 2026-07-31** — `minWebViewVersion: 111` (Tailwind v4's own minimum), and the page
  ships in production too. Deliberately BELOW the 113–118 ring bug, which is patched in CSS rather than
  gated around — see the ring entry at the end.
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
`docs/design/rendering.md §3.5` already forbids service workers on Capacitor.

> **Decision: adaptv must never add `WKAppBoundDomains`, and `create-adaptv` should not scaffold it.** If a
> consumer adds it, `adaptv doctor` should detect the plist key without the config flag and fail loudly —
> it is the highest-severity silent failure in the whole Capacitor surface.

One useful undocumented detail: `localhost` is **auto-app-bound** in WebKit
(`shouldTreatURLProtocolAsAppBound`), so `capacitor://localhost` already sets the flag internally even
in apps that never opt in.

### B23 — the bearer-token decision is validated, but `storage.secure`'s backing store is not

`docs/design/rendering.md`'s "cookies don't work in a native WebView → bearer tokens" is **more strongly supported
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
Keychain, not `EncryptedSharedPreferences`**, and its README carries no warning. `docs/design/architecture.md §2.1`
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

Moot under `docs/decisions/animation.md §4.1` (adaptv doesn't use the top layer), but worth knowing if that's revisited.

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

### B32 — The app's splash spends its minimum behind the OS splash, then flashes ✅ **FIXED**

**Symptom, as reported:** the OS splash (a flat colour, so it reads as a dead screen), then the app's own
splash for a blink, then the app — on a screen written to stay up for at least a second.

**Cause.** The splash is mounted and painted *underneath* the OS launch splash, deliberately: that
overlap is what makes the handoff seamless (§1.4). But it was mounted with **no props**, so the only
clock it could time itself against was its own mount — and mount is not when anyone sees it. Every
millisecond between mount and the OS splash lifting was spent counting down a minimum nobody was
watching. Same for CSS: a wordmark animation started at mount and was part-way through, or over, by the
time it was seen.

**Measured** on the playground (`preview android`, a 1s minimum, 100ms post-ready beat):

| | mount → visible | app ready | splash actually seen |
|---|---|---|---|
| Pixel (API 37, WebView 149) | 224–242ms | 48ms after mount | **~430ms** → now **1001–1002ms** |
| Pixel 7 (API 36, WebView 113, ~11s JS boot) | 368–423ms | 321ms after mount | **282ms** → now **1004–1008ms** |

The `ready` column is the shape of it: on a healthy device the app finishes booting **before its splash
is even visible**, so the dismiss timer had already expired and the splash was torn down almost as soon
as it appeared. The slower the boot, the *shorter* the splash — the opposite of what a splash is for. A
first launch that waits on an update (§5.4a) can push the gap to seconds, which is the reported case.

**Fix.** `hooks/use-splash-handoff.ts` owns the launch handoff and reports *when the splash went on
screen*, which `RoutingShell` hands down as `SplashScreenProps.revealedAt` (`Date.now()`, `null` until
then). Three parts, each load-bearing:

- **A painted frame before the OS splash lifts.** Two `requestAnimationFrame`s, not one — the first
  callback runs *before* the paint it precedes. `useEffect` alone does not have that guarantee (React
  flushes passive effects in a scheduler task that can land either side of the paint), and taking the OS
  splash off an unpainted WebView is the white flash `launchAutoHide: false` exists to prevent. Behind a
  400ms ceiling, so a WebView that never runs a frame callback under an opaque native view cannot leave
  an app that never launches.
- **`hideNativeSplash()` resolves on the fade, not on the bridge.** The plugin resolves `hide()` the
  instant it *dispatches* a 200ms fade (iOS literally `call.resolve()` after `UIView.transition`), so
  awaiting it reports the handoff ~200ms early. It is also never awaited: a hung bridge must not be able
  to strand the app behind its own splash.
- **Animations are held, not just timers.** Critical CSS pauses everything inside `[data-adaptv-splash]`
  until the handoff stamps `<html data-adaptv-splash-revealed>`. Absence is the paused state, so frame
  one is already correct with nothing written pre-paint. Verified on device over CDP: `paused` before the
  stamp, `running` after.

**What it is not.** adaptv does not own the minimum — the splash is still app-owned and still dismisses
itself by returning `null`. adaptv owns the only fact the splash cannot observe about itself, which is
whether anyone is looking at it.

Guards: `src/hooks/use-splash-handoff.test.tsx` (order: no hide before a painted frame, no reveal before
the OS splash is gone, the first-launch hold in front of both), `src/capabilities/splash.test.ts` (the
fade, and that a never-settling bridge call still resolves), `src/shell/critical-css.test.ts` (the hold
rule, keyed off the attribute the hook actually writes) and `src/shell/shell-layout.test.tsx`.

---

## 🚨 Android ships with 12 of adaptv's 13 native plugins missing (found 2026-07-30)

**Measured on two emulators, same debug APK.** Android 14 (SDK 34) and Android 17 (SDK 37):

| | Android 14 | Android 17 |
|---|---|---|
| WebView covers the screen | **no — 76 CSS px short** | yes |
| `--adaptv-inset-top` | **0px** | 54px |
| `--safe-area-inset-top` (Capacitor SystemBars) | **unset** | 54px |
| `env(safe-area-inset-top)` | 0px | 55px |

Edge-to-edge is **off** on Android ≤ 14, which contradicts `docs/design/architecture.md §1.4` ("not a toggle").
Android 15+ enforces edge-to-edge for `targetSdk ≥ 35` (the generated project targets 36), which is the
only reason this was never seen.

**Root cause — and it is much wider than the status bar.** Asking the bridge directly:

```
StatusBar.setStyle    → REJECTED: "StatusBar" plugin is not implemented on android
Haptics.impact        → REJECTED: "Haptics" plugin is not implemented on android
Preferences.get       → REJECTED: "Preferences" plugin is not implemented on android
App.getInfo           → REJECTED: "App" plugin is not implemented on android
Network.getStatus     → REJECTED: undefined
Device.getInfo        → ok
```

`capacitor.settings.gradle` includes exactly one plugin project, `capacitor-device` — the only
`@capacitor/*` package the **consumer app** declares. adaptv's own 12 are invisible to Capacitor's
Android resolver under pnpm. The generated paths give it away: `capacitor-device` resolves through the
app's `node_modules` (four levels up), `capacitor-android` through the workspace root (five). iOS is
unaffected — its Podfile lists all 15 pods, resolved out of the pnpm store, so the two platforms do not
share a discovery path.

**Why nothing caught it.** Every wrapper swallows the rejection — `enableEdgeToEdge` even carries
`.catch(() => {})` with the comment *"older plugin / unsupported — safe to ignore"*. So on Android the
app silently degrades to its web behaviour: no haptics, no native KV, no hardware back button, no
status-bar styling, and on ≤ 14 no edge-to-edge. There was no device coverage at all until this pass, and
the one emulator anybody would reach for (a recent Android) hides the most visible symptom.

**Not fixed here.** The fix is in project generation, not in the JS: adaptv has to make its own plugins
visible to the Android resolver rather than relying on the consumer to re-declare them. Two candidates
worth measuring — hoisting adaptv's `@capacitor/*` into the app's tree at generate time, or writing the
`include`/`implementation` entries into `capacitor.settings.gradle` / `capacitor.build.gradle` directly.
Whatever lands, the guard is a device smoke test: `Device.getInfo` is not evidence that the bridge works,
because `Device` is the one plugin that was never broken.

---

## 🚨 A cold start into a 404 leaves the splash covering the app, on native (found 2026-07-30)

`PwaSplashOverlay` self-unmounts when the app signals ready. On an unknown route it never does — the
element stays in the DOM for the life of the session. Measured in the Android WebView on
`/lab/definitely-not-a-route`:

```
display: block   opacity: 1   pointer-events: auto   z-index: 100
elementFromPoint(centre of screen) → inside [data-adaptv-splash]
```

The app is stuck on the launch screen with the 404 unreachable behind it. On a normal route the same
build reports zero splash elements, so it is the not-found path specifically.

**Invisible on the web**, which is why it survived: the critical-CSS splash policy is scoped to
`html[data-adaptv-platform="web"]`, so in a browser tab the leftover is `display: none` and covers
nothing. Every check anybody would run in a browser passes.

`playground/e2e/screens.spec.ts` carries it as a `test.fail()` — it stays visible in every run and flips
to a pass the moment the unmount is fixed. `/lab/screens` already described this exact failure in prose
("an overlay left mounted covers the app with an invisible full-screen element and swallows every tap");
nothing was checking it, and its own readout was reporting a false alarm in the other direction (it
sampled once on mount, while the splash was legitimately still up, so it said STILL PRESENT on every
cold load — fixed in this pass).

---

## 🚨 Nothing ever asked for edge-to-edge below Android 15 ✅ **FIXED** (found 2026-07-31)

The other half of the plugin-discovery entry above. That one ended *"and on ≤ 14 no edge-to-edge"*, and
read as a consequence of the missing plugins. It is not — it survives the fix. **Neither `SystemBars`
nor `BridgeActivity` ever touches the window.** `SystemBars` only *reports* insets; the one thing that
asked for the window was `@capacitor/status-bar`'s `setOverlaysWebView`, which is the deprecated
`setSystemUiVisibility` path Play Console flags, and which sets `LAYOUT_STABLE | LAYOUT_FULLSCREEN` with
no `LAYOUT_HIDE_NAVIGATION` — **the status bar, never the gesture bar.**

Measured on the `Pixel_7` AVD (API 34, WebView 113), one build per row:

| build | `innerHeight` / `screen.height` | `--safe-area-inset-top` | on screen |
|---|---|---|---|
| before the plugin fix | 839 / 915 | *unset* | `windowBackground` band, top **and** bottom |
| after the plugin fix | 891 / 915 | `0px` | under the status bar, nothing padding it |
| after this fix | **915 / 915** | **51px** | edge-to-edge, both bars, header clear of the clock |

**The fix is in project generation, not JS** — and that is principle 7 being obeyed, not bent. Its own
table puts insets at *"plugin reports raw numbers"* on the dumb-platform side and `View safe="…"` on the
React side; asking for the window and measuring it is the raw-numbers half, and there is no JS API that
does it. The generated `MainActivity` (`bin/lib/native.mjs`) calls
`WindowCompat.setDecorFitsSystemWindows(getWindow(), false)` in `onCreate`: both bars, API 21+, no
plugin to be registered, and it lands before the first inset dispatch rather than a frame or two into
boot. `enableEdgeToEdge()` stops calling `setOverlaysWebView` on Android; iOS keeps it.

**And adaptv now reports the insets itself on WebView < 140.** `SystemBars.shouldPassthroughInsets`
requires WebView ≥ 140, and below that it injects `0px` for all four **on purpose** — it assumes the page
is not drawing under anything. Once the page is, those zeros are the bug. So below 140 the generated
activity replaces SystemBars' listener (a View holds exactly one, and ours is installed after the bridge
loaded the plugin, so exactly one remains — this is not the two-listener collision behind
capacitor-keyboard#61/#68). At or above 140 it does not touch it and SystemBars keeps its whole
pipeline.

**B21 is why that branch is permanent, not transitional.** Android 7 caps at Chromium 119 and Android
8–9 at 138: those devices can *never* reach 140, so "SystemBars reports insets" is not a floor adaptv
can wait out. Verified on both ends — `Pixel_7` API 34 / WebView 113 (adaptv's listener) and `Pixel_10`
API 37 / WebView 149 (SystemBars' own, `innerHeight` 923 of 924, insets 54/24, unchanged).

The **status-bar colour** in the original report was the plugin fix, not this one: with
`@capacitor/preferences` missing, `adaptv-theme` never reached SharedPreferences, so `MainActivity` fell
back to the system night mode and a dark app got the light `windowBackground` band. It is moot now —
with the window edge-to-edge there is no band to be the wrong colour, and `windowBackground` is back to
being only the pre-first-paint mask it was designed as.

---

## 🚨 Tailwind v4's whole `ring-*` family is dead below Chromium 119 ✅ **FIXED** (found 2026-07-31)

Reported as "the borders aren't rendering" on the `Pixel_7` AVD — the checkbox outline and the task
field's hairline. They are not borders. They are `ring-1 ring-inset ring-border`, and **every `ring-*`
and `inset-ring-*` utility silently computes to `box-shadow: none`** on that WebView.

The CSS parses identically on both devices — same rule text, same `@property` registrations. It fails at
*substitution* time. Bisected on-device:

```
@property --pn { syntax: "*"; inherits: false; }   /* registered, NO initial-value */

var(--pn,)              →  113: whole declaration invalid   ·  149: ok
var(--pn, currentcolor) →  both ok
--pn: ; then var(--pn,) →  still invalid on 113
```

That empty fallback over a registered-but-uninitialised property is Tailwind v4's ring, verbatim:

```css
--tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor);
```

One invalid `var()` invalidates the whole `box-shadow`, which is why nothing paints rather than a partial
ring. On the tasks screen: 10 elements carrying a ring class, **0** painting. `shadow-*`, `opacity-*`,
`duration-*`, real `border-*` and `oklch()` are all fine on 113 — measured, not assumed.

**Pinned to the milestone.** Bisected across every Chrome-for-Testing build 113→119 (`--headless
--dump-dom`, mac-arm64), with 113 cross-checked against the real Android WebView 113 so the desktop
builds stand in for device ones:

| Chromium | 113 | 114 | 115 | 116 | 117 | 118 | **119** | 124 | 149 |
|---|---|---|---|---|---|---|---|---|---|
| `var(--x,)` | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ | **✓** | ✓ | ✓ |

**119 is the first working build — and B21's table says Android 7 is frozen at exactly 119.**

### 🔒 The fix is a CSS rewrite, NOT a version gate

The first cut of this entry gated at `minWebViewVersion: 119`. That was wrong, and the reason is worth
keeping: **a floor is what you ship when you cannot fix something.** Here it can be fixed, so gating
would have refused to boot on hardware adaptv renders correctly — for a bug adaptv is able to patch.

`vite/ring-shadow-fallback.ts` rewrites Tailwind's compiled output, unconditionally:

```css
/* was: --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + …) var(--tw-ring-color, currentcolor) */
.ring-1     { --adaptv-tw-ring: 0 0 0 calc(1px + …) var(--tw-ring-color, currentcolor);
              --tw-ring-shadow: var(--adaptv-tw-ring) }
.ring-inset { --tw-ring-shadow: inset var(--adaptv-tw-ring, 0 0 #0000) }
```

The carrier is **unregistered**, so the empty fallback disappears entirely. It stays a `box-shadow`, so
`ring` + `shadow` + `outline` remain three independent properties — which matters, because the
playground's own `text-input` carries `ring-1 … focus-within:outline-none` on one element, and a
`ring`→`outline` rewrite would have erased its ring precisely on focus. Unconditional is safe because
the rewrite is **byte-identical on browsers that were never broken** (measured on WebView 149, both
constructs side by side), so there is nothing to detect and no `@supports` that could see it anyway.

Measured on the `Pixel_7` AVD after the rewrite: **10 of 10 ringed elements painting**, up from 0.

Three traps found while building it, all now guarded by tests and comments in the file:

1. **`--adaptv-ring` / `--adaptv-ring-offset` were already taken** — they are adaptv's *public*
   focus-ring tokens (`patches.css`). Using them as carriers would have redefined the focus-ring colour
   as a box-shadow body on every ringed element, killing `:focus-visible` on **every** browser. Hence
   `--adaptv-tw-*`.
2. **`enforce` must be absent.** `pre` runs before `@tailwindcss/vite:generate:*` (also `pre`) and sees
   no utilities; `post` is too late — a clean build with `post` still emitted 4 `var(--tw-ring-inset,)`
   and zero carriers. Adding an `enforce` breaks the rewrite *silently*: CSS builds, tests pass, only an
   old WebView shows it.
3. **An invalid declaration does not fall back to the registered `initial-value` on these builds.** The
   first working version left `--tw-ring-offset-shadow: inset var(--adaptv-tw-ring-offset)` with the
   carrier unset; `--tw-ring-shadow` computed correctly, `--tw-ring-offset-shadow` computed to `""`, and
   the guaranteed-invalid value poisoned the whole `box-shadow` — ring right, page wrong. Every carrier
   reference now carries an explicit `, 0 0 #0000`.

**The floor stays, at 111** — Tailwind v4's own stated minimum, and still a large improvement on
Capacitor's unreachable default of 60. It closes B21's open recommendation ("set `minWebViewVersion`
explicitly and ship an `errorPath` page") without gating out anything adaptv can render.

**Why the page had to move to production, and why it branches.** Capacitor gives ONE `server.errorPath`
and routes both failures through it — `Bridge.loadWebView()`:

```java
if (!this.isMinimumWebViewInstalled()) {
    String errorUrl = this.getErrorUrl();
    if (errorUrl != null) { webView.loadUrl(errorUrl); return; }
    else { Logger.error(MINIMUM_ANDROID_WEBVIEW_ERROR); }   // ← falls through and boots anyway
}
```

So a floor with no `errorPath` is a **silent no-op**, which is what production would have been (only
`patchServerUrl` set one). And a floor with the *dev* `errorPath` would tell someone on WebView 113
"couldn't reach dev server" — a lie they would chase for an hour. The page therefore reads its own
Chromium major out of `navigator.userAgent` — no bridge needed, which matters because Android injects
none there — and branches before it looks at the dev server at all. Verified in Chrome 113 and 119
across both builds:

| build | Chromium | screen |
|---|---|---|
| dev | 113 | Update Android System WebView (needs 119, has 113) |
| dev | 119 | Couldn't reach dev server + reconnect spinner |
| prod | 113 | Update Android System WebView |
| prod | 119 | Couldn't load the app |

`major > 0` gates the whole check, so it can never fire on iOS, where there is no Chrome token and
WebKit ships with the OS.

**adaptv itself uses zero `ring-*` utilities** — every hit is in the consumer app's UI kit. This is not
an adaptv component bug; it is the framework refusing to ship onto a WebView where a mainstream Tailwind
family is silently dead.

### B33 — a route's `chromeTint` is read as **source**, at build time, and never off the route

A route can declare the colour the browser's chrome should take:

```tsx
export const Route = createFileRoute("/settings")({
  chromeTint: "#1e0033",
  component: Settings,
})
```

The obvious implementation reads the option off the matched route and writes the colour. It is wrong, and the reason is the only thing this feature is for: **a cold launch straight onto that route must not show the theme's colour for a frame first.** By the time a router exists to be asked, that frame is already on screen. So adaptv scans the route files at build time (`src/vite/route-tints.ts`), derives each route's URL path from its id, and inlines a `[pattern, colour]` table into the pre-paint head script. Verified by an e2e test that stalls every script request and reads the DOM while the app provably cannot have run.

Four consequences, each of which looks like an arbitrary restriction until you connect it to the line above.

**The value must be a literal.** A computed tint would typecheck, run, and do nothing on the one frame it exists for — a silent regression of exactly the flash the option removes. The build refuses it and names the file, the same doctrine `extractThunkSpecifier` already applies to config thunks. A top-level `const` in the same file is accepted, because naming the colour is the first thing anyone does and a binding the file declares is as static as the literal it holds; an imported one is not, and says so.

**The runtime reads the same table, not the option.** `useRouteTint` looks the leaf match's route id up in the build-time table. Reading the live option instead would give two sources that can disagree, and the disagreement would appear as the flash. One table, one answer.

**One colour, in both themes.** Not a `{ light, dark }` pair. A route that pins the chrome wants that chrome; a route that should follow the theme declares nothing and gets `themeColor` from `adaptv.config.ts`.

**No inheritance.** A route that declares nothing falls back to the app's **global** colours, never to whatever a layout above it wanted. A tinted section is one tint per route in it, which is more typing and exactly one rule to remember.

It drives **both** outputs — the meta tag and the `html`/`body` paint — for the reason in B17: neither covers the whole matrix, and a route tint that moved only the tag would do nothing at all on a current iPhone. Confirmed on an **iOS 26.1 simulator**, screenshots sampled at the same pixel column:

| route | top band | bottom band |
|---|---|---|
| `/lab/route-tint`, `chromeTint: "#0b6e4f"` | `#0b6e4f` | `#0b6d4e` |
| `/lab`, no tint | `#f5e6ff` | `#f3e4fc` (the app's light theme colour) |

Both bands, and the fallback lands on the theme rather than on the layout above.

**Not in scope, and deliberately.** The *animated* tint (`transitionChromeTint`, B32) still writes only the meta tag, so a drawer that dims the chrome does nothing on iOS 26+. Extending it to the shell background is a separate change with its own cost — a per-frame `style.backgroundColor` on `html` is a full-page repaint, which is a very different proposition from a meta write.
