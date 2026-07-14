# nativ — gaps, prior art & upstream to watch

What's **missing** from the nativ vision, the problems **Ionic / Capacitor already solved** (study them
before reinventing), and the **upstream issues / PRs / docs** worth tracking across Ionic, Capacitor,
TanStack Router, and TanStack Start.

> Rule while building nativ: before hand-rolling any cross-platform behavior (gesture, lifecycle, back,
> keyboard, insets), **check how Ionic/Capacitor did it and read their open issues** — they've hit the
> edge cases already. This doc is the index. Links are verified as of 2026-07.

---

## 1. Missing pieces of the vision

Beyond the README §status list, these are the conceptual gaps to design for:

- **Page/route lifecycle.** nativ has no "screen entered / left / will-leave" concept. Ionic keeps
  popped pages' behavior explicit (`ionViewWillEnter`/`DidEnter`/`WillLeave`/`DidLeave`) and **keeps
  pages in the DOM until popped**. With nativ's memory-history + warm-cache model, decide: do we expose
  enter/leave hooks? Keep prior screens mounted? This interacts with the singleton warm-cache fix.
- **App resume / background lifecycle.** Neither Ionic's page hooks nor React effects fire on
  home→app resume. nativ needs a first-class `useAppState` (`@capacitor/app` `resume`/`pause` +
  `visibilitychange` on web) — token refresh, refetch-on-resume, re-lock all hang off this.
- **Back-button as a priority handler chain.** A single `router.back()` isn't enough: an open
  drawer/modal must intercept back *before* navigation. Needs a priority-registered handler stack
  (overlays > nav > exit), like Ionic's `ionBackButton`.
- **Gesture arbitration.** Multiple gestures (drawer drag, swipeable row, scroll, edge-swipe) compete;
  only one should win. nativ handles each in isolation today — no shared arbiter. Ionic has a global
  gesture controller that grants a single "captured" gesture.
- **Android 15 / SDK 35 edge-to-edge + keyboard.** The current inset/keyboard approach will hit the
  known Android-15 breakage (see §3). Treat this as a real risk, not solved.
- **OTA for Capacitor.** Not built. The mechanism + safety (JS-only vs needs-native-build detection)
  is non-trivial — study the existing plugins rather than DIY from scratch (see §4).
- **Deployment target abstraction.** Web SSR presets (cloudflare/vercel/node/static) — keep TanStack
  Start precisely for this.
- **`.nativ/` generated dir + `nativ` re-export barrel.** Apps still import `@tanstack/*`. The
  generator override path exists (§2) — this is buildable, not blocked.

---

## 2. TanStack — refinements + the generator-hiding path

**createServerFn nuance (refines `RENDERING.md`).** TanStack Start's SPA mode *does* support server
functions — **but only because a SPA served from a host still has that host's server to RPC into.** A
**Capacitor** build is a static bundle with **no server at all**, so `createServerFn` has nothing to
call → still forbidden there. Also: SPA mode disables server-side execution of `beforeLoad`/`loader`
and SSR of route components, **except** root-route loaders, which run during shell prerender. So the
precise rule for nativ's *native* target stays: **no `createServerFn`, no server routes** — keep
loaders isomorphic.
- SPA mode: <https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode>
- Selective SSR: <https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr>
- Server functions: <https://tanstack.com/start/latest/docs/framework/react/guide/server-functions>
- RFC SPA enhancements (watch): <https://github.com/TanStack/router/discussions/3394>
- Prerender data in SPA: <https://github.com/TanStack/router/discussions/6402>

**Hiding the router (the `.nativ/` + barrel plan is feasible).** The generator matches routes by the
exported `Route` identifier from `createFileRoute`, but **Virtual File Routes** (`__virtual.ts`) let you
*completely override the generation convention and relocate the generated files* — the supported hook
for emitting into `.nativ/` and controlling what's imported. `autoCodeSplitting` + `codeSplitGroupings`
are the knobs for the chunking nativ wants. If the `createFileRoute` symbol must be re-exported as
nativ's own, that's the one spot for a `pnpm patch` of `@tanstack/router-generator`.
- Virtual file routes: <https://tanstack.com/router/latest/docs/routing/virtual-file-routes>
- File-based routing API: <https://tanstack.com/router/latest/docs/api/file-based-routing>
- Automatic code splitting: <https://tanstack.com/router/latest/docs/guide/automatic-code-splitting>

---

## 3. Capacitor — prior art + known issues to study

- **Android 15 / SDK 35 edge-to-edge + keyboard overlap (HIGH RISK).** Android 15 changed how insets +
  window resize interact with the keyboard/system bars; `keyboard-resize` + `keyboard-offset` are no
  longer reliable, and inputs near the bottom get overlapped. Devices < API 35 need explicit layout
  margins to keep old behavior. **Read before hardening nativ's edge-to-edge/keyboard:**
  - Capacitor core issue — edge-to-edge < API 35 broken: <https://github.com/ionic-team/capacitor/issues/7951>
  - capawesome keyboard/edge-to-edge bugs: <https://github.com/capawesome-team/capacitor-plugins/issues/490> · <https://github.com/capawesome-team/capacitor-plugins/issues/428>
  - The community fix plugin (study its approach, or depend on it): <https://capawesome.io/docs/plugins/android-edge-to-edge-support/>
  - Config lesson from the field: `Keyboard` with `resizeOnFullScreen: false`; don't trust `resize:"ionic"`.
- **Version pinning.** Core vs official plugins vs Xcode/Swift toolchain — nativ already pins a
  known-good set; keep it (see `capacitor-internals.md`).

---

## 4. Ionic — problems already solved (study, don't reinvent)

- **Gesture controller.** `createGesture` from `@ionic/core` + the shared gesture-controller that lets
  only one gesture capture at a time (drag vs scroll vs swipe arbitration) — the reference for nativ's
  `Drawer`/`Swipeable` and the missing gesture arbiter.
  - Docs: <https://ionicframework.com/docs/utilities/gestures>
  - Source: <https://github.com/ionic-team/ionic/blob/master/core/src/utils/gesture/gesture-controller.ts>
- **Page lifecycle.** `ionViewWillEnter`/`DidEnter`/`WillLeave`/`DidLeave`, DOM retention until pop, and
  the gotcha that these **don't fire on app resume/background** — informs nativ's lifecycle design.
  - Docs: <https://ionicframework.com/docs/vue/lifecycle>
  - Lifecycle not fired navigating back: <https://github.com/ionic-team/ionic-framework/issues/29282>
  - Interrupted open/close lifecycle hooks: <https://github.com/ionic-team/ionic-framework/issues/27486>
- **Hardware back button as a priority handler chain.** `ionBackButton` with registered priorities so
  overlays intercept before nav pops — the model nativ's `useAndroidBackButton` should adopt.
  - <https://ionicframework.com/docs/developing/hardware-back-button>

---

## 5. OTA (Capacitor) — prior art for the live-update gap

Don't DIY the bundle-swap blindly. Study these, then decide wrap-vs-build:

- **Capgo** (`@capgo/capacitor-updater`) — remote JS/asset bundle updates; its CLI **detects when a
  bundle is OTA-safe vs needs a native build** (plugin/native change) — a pattern nativ must replicate.
  - <https://capgo.app/> · <https://github.com/Cap-go/capacitor-updater>
- **Capawesome Live Update plugin** — alternative: <https://capawesome.io/plugins/live-update/>
- **`@capacitor/live-updates`** (Appflow) — the first-party/commercial option.
- **App Store rule (Apple §3.3.2):** OTA limited to **JavaScript + assets**, no native-code/behavior
  change; Google Play more lenient but policy-bound. Native/plugin changes still need a store build.
  - <https://capgo.app/blog/capacitor-ota-updates-app-store-approval-guide/>

---

## 6. How to use this doc

- New cross-platform behavior? Grep this doc first; open the relevant Ionic source/issue.
- Before a Capacitor version bump or an Android/iOS SDK bump, re-check §3 for new breakage.
- When building OTA or the `.nativ/` router-hiding, start from §5 / §2 respectively.
- Keep this current — add issues/PRs as you hit them; prune ones upstream fixes.
