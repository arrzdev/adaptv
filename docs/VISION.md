# adaptv — the vision

> A cross-platform UI framework where you write **React with JS/HTML/CSS**, and the same code ships
> as a **desktop web app, an installable PWA, and native iOS/Android apps** — and *actually feels
> right on every one of them*, without per-platform babysitting.

This is the north star. This document is the map, not the changelog.

> ⚠︎ **The status sentence that used to sit here — "most of the primitive layer does not yet
> [exist]" — was written early and is no longer true.** The public component surface is 27 barrels
> (`src/interface/components.index.ts`) and the suite is 2542 tests across 164 files, as of
> **2026-08-30**. Aspiration below, current state in
> [`../README.md`](../README.md) and [`roadmap/README.md`](roadmap/README.md); this file deliberately
> carries neither, so it cannot go stale again.

---

## 1. The objective (abstractly)

Every team that wants "one app, everywhere" faces the same fork:

- **React Native / Expo** — write JS, render to *native views*. Great native feel, but you leave the
  web platform behind: a second rendering model, Metro, native modules, `StyleSheet`, and the web is a
  bolted-on afterthought (`react-native-web`).
- **Just a website / PWA** — write for the DOM, wrap it. You keep the entire web ecosystem, but you
  inherit every place the web *doesn't* behave like an app: safe-areas, keyboard, scroll physics,
  gestures, back navigation, splash, permissions, offline.

**adaptv takes the second fork and refuses its downsides.** The render target stays the DOM (so the
whole React/CSS/web ecosystem just works). Native capability comes through **Capacitor as a thin
seam**. And on top sits a layer of **primitives that are correct-by-construction** — a `View` that
can't scroll wrong and is edge-to-edge by default, a `Button` with real press physics and
haptics, capability APIs that transparently pick browser / polyfill / native. The developer writes
ordinary React; adaptv makes it behave like a native app on six targets.

It's **Expo's ambition with Capacitor's mechanism** — and, unlike Expo, the web is not a second-class
target, it's the *primary* one.

### Where it sits (know the neighbors)

| | Render model | Native seam | React-idiomatic? | Correctness opinion |
|---|---|---|---|---|
| **Expo / RN** | native views | native modules | RN-flavored | strong, but not web |
| **Ionic** | web components | Capacitor | weakly | adaptive styling, not "can't-break-it" |
| **Tamagui** | RN + web | RN | yes | strong, but RN-anchored |
| **adaptv** | **DOM** | **Capacitor** | **yes (TanStack-native)** | **correct-by-construction** |

adaptv's wedge is the empty cell: **React/DOM-first, opinionated primitives that make the wrong thing
impossible, Capacitor for the native 10%.** Ionic is the closest existing thing and it's the thing to
beat on developer joy and correctness, not to copy.

---

## 2. Core principles (the doctrine)

1. **Correct by construction.** The ergonomic path is the correct path. If a behavior differs by
   platform (scroll, safe-area, keyboard, back), it's owned by a primitive or prop — never left to the
   consumer to get right per-platform.
2. **Behavior is props, presentation is className.** `<View scroll="y">`, not
   `className="overflow-y-auto"`. Layout/behavior that has cross-platform consequences goes through the
   typed prop surface; `className` is for looks.
3. **Guardrails teach; they never mutate.** We catch misuse with a **build-time lint error** and an
   optional **dev-only runtime warning** — never by silently stripping or rewriting the consumer's
   code at runtime. Magic that mutates user code is how frameworks lose trust.
4. **No runtime magic that rewrites user code; the frame is owned _above_ the route.** Root-ness comes
   from the framework-owned shell seeding a full-viewport, inset-aware slot (React Native's navigator
   model) — never from a primitive inspecting the DOM or mutating the consumer's tree. A dumb-but-correct
   `View` fills that frame; there is no `Screen`/`Page` at all. Predictability is a feature.
   (Mechanism: `docs/design/architecture.md §0.4`, §1.)
5. **One config source.** `adaptv.config.ts` is the single source of truth. It generates the web
   manifest, `capacitor.config`, the native project settings, splash, icons, theme — the consumer never
   hand-edits a second config.
6. **Reactive → hook, imperative → API.** Subscribed state is a hook (`useKeyboard`, `useNetwork`);
   fire-and-forget is a plain function (`haptics.impact()`, `share()`). One-shot reads are async
   functions; live watches are hooks.
7. **Web-safe first, native-enhanced.** Every capability has a graceful web/PWA implementation, then a
   native branch behind `isNativePlatform()`. Removing Capacitor must never break the web build.
8. **Platform-adaptive defaults, escape hatches available.** Edge-to-edge, momentum scroll, press
   feedback are *on by default* and *right per platform*; every one is overridable.
9. **Lean on the ecosystem.** Wrap TanStack Virtual, `motion`, TanStack Router, Dexie — don't
   re-implement solved problems. adaptv is the *cross-platform correctness layer*, not a NIH museum.
10. **Layout shift is a named enemy.** Content that moves after it is painted is the single loudest
    tell that an app is a web page. adaptv spends whatever is within its reach — abstractions,
    platform quirks, build-time work — to remove it, bounded only by what would ruin the developer
    experience. → §2.1.

---

## 2.1 🔒 Layout shift — the named enemy

Decided **2026-07-29**. Principle 10 gets its own section because it is the one principle that
routinely *loses* to a plausible-sounding shortcut, and the shortcut has to be recognisable.

**Why this and not "performance" generally.** Jank is a frame-rate problem and users forgive it;
a button that moves out from under a thumb mid-tap is a correctness problem and they don't. It is
also the failure mode that native apps structurally do not have — a native list reserves its cell
height before it draws — so every instance of it is adaptv failing at the thing adaptv exists for.

### The test a mitigation must pass

> **A mitigation that removes the shift in one case and fails silently in the others is worse than
> none, because it manufactures false confidence.**

The worked example, and the reason this section exists. Every primitive briefly shipped
`border border-transparent` in its `base` layer, so that
`className={selected ? "border-orange-500" : ""}` would swap a colour rather than add a width.
It was reverted the same day:

- It cancels the shift for a border of **exactly 1px**. A consumer writing `border-2` shifts anyway,
  and nothing tells them.
- It permanently and **invisibly** costs 2px of content box on every instance, because
  `box-sizing: border-box` is Tailwind's preflight default — so a control specified at 40px silently
  stops matching its design.
- It trades a conditional problem for a constant one.

The correct primitive for toggled emphasis is **`outline`**: it never participates in layout at any
width, and it follows `border-radius` in every engine adaptv targets. Same answer as the focus ring
(`docs/decisions/styling.md` §D), which is not a coincidence — `outline` exists precisely for decoration that must
not move anything.

### What this licenses

Because the enemy is named, these are **doctrine, not taste** — they are forced and abstracted, and
`ui: {}` does not get a knob for them (the alternative is not a different look, it is a broken one):

| Mechanism | What it prevents |
|---|---|
| `Image` reserving its box from `width`/`height` before the bytes arrive | the canonical CLS source |
| Build-time low-resolution placeholders for statically-imported images | a placeholder that is itself a shift when it swaps |
| `AvoidKeyboard` publishing `--adaptv-keyboard-height` rather than resizing | the keyboard reflowing the page under the caret |
| Safe-area insets resolved pre-paint (`var()`-before-`env()`, `crbug/40699457`) | chrome jumping once the real insets arrive |
| `--adaptv-keyboard-height` and the inset vars being **always defined** (`0px` at rest) | a `calc()` that collapses because a variable was absent |
| `List` virtualisation measuring rows rather than assuming them | rows resizing as they scroll into view |

### What it does not license

Principle 3 still holds: **guardrails teach, they never mutate.** adaptv does not rewrite the
consumer's markup to insert size attributes, and it does not silently wrap their elements. The lever
is the primitive and the build step, never their tree.

---

## 3. The problem space (the real scope)

The holy grail is hard because "the web in an app" diverges from "a native app" in dozens of specific,
nasty places. This is the catalog adaptv exists to solve — grouped, and deliberately longer than what's
obvious, because the long tail is the actual work.

### Layout & viewport
- **Safe areas** — notch, Dynamic Island, home indicator, camera cutout, rounded corners; `env(safe-area-inset-*)` is populated differently in browser tab (zero) vs standalone vs native WebView.
- **Edge-to-edge** — drawing under the status/nav bar. Native only (StatusBar overlay); PWA can't; the nav bar is system-owned on Android.
- **The `100vh` problem** — `vh`/`svh`/`lvh`/`dvh` divergence; iOS standalone cold-start ICB expansion (the "launch shift"); dynamic toolbars.
- **`viewport-fit=cover`, `initial-scale`, input zoom** (iOS zooms on <16px inputs), `user-scalable`.
- **Density & form factor** — DPR, tablets, foldables, desktop window resize, orientation/rotation lock, rotate guards.

### Scrolling (a whole discipline)
- Momentum / rubber-band overscroll; **overscroll chaining** to the page; single-axis locking (setting one axis flips the other to `auto`).
- Nested/independent scroll regions; the `min-h-0` flex-chain trap.
- Pull-to-refresh; infinite scroll; scroll restoration on back-nav; scroll anchoring; hide-on-scroll headers; scroll-into-view for focused inputs.
- Virtualized lists (perf on long lists, sticky headers, variable heights).

### Keyboard (the biggest divergence)
- Native pushes layout / resizes vs web `visualViewport` heuristics vs the `virtualKeyboard` API vs `@capacitor/keyboard` (real height + will-show/hide + easing).
- Avoidance (lift content above the keyboard), sticky footers/toolbars above the keyboard, caret staying visible, focus scroll-into-view, "Done/Next/Return" behavior, dismiss-on-scroll, accessory bars.
- The iOS WebKit **caret-repaint glitch** on transformed inputs; **double-tap magnifier loupe**; autocorrect/selection popovers that detach on scroll.

### Gestures & input
- Press feedback that native `:active` can't clear from JS and won't re-light on touch re-entry (→ a JS `data-pressed` engine).
- Swipe (row actions, dismiss), long-press, drag-reorder, pinch; pointer capture; touch vs pointer vs mouse unification; tap-delay; ghost clicks (the drawer backdrop bug).
- **Edge-swipe-back** conflicts with scroll-lock and with the OS gesture; `preventDefault` can't block iOS edge-swipe.

### Navigation & lifecycle
- Android hardware back; memory vs browser history; deep links / universal / app links; cold-start deep-link; route transitions; modal/sheet/tab stacking; "no URL bar in standalone → every screen needs an in-app affordance."
- App lifecycle: background/foreground/resume, `visibilitychange`, `pageshow`, re-auth on resume.

### Splash & launch
- OS splash (manifest/native) vs custom React splash; the **double-splash** on Android-PWA; holding the native splash until app-ready; cold-start paint gap; pre-paint theme/attribute stamping to avoid FOUC.

### Theming
- Dark/light, system sync, in-app override; `theme-color` meta (browser chrome), native StatusBar tint, splash background, nav-bar color; preventing a flash of the wrong theme before hydration (blocking head script).

### Capabilities & permissions
- Haptics, network status, share, clipboard, filesystem, camera/photos, push/local notifications, biometrics, contacts, geolocation, screen-orientation, app-shortcuts, badging.
- **Permission model divergence** — web `navigator.permissions` + prompt-on-use vs native OS dialogs + `checkPermissions`/`requestPermissions`; denied/blocked states; settings-redirect; rationale (Android).

### Data, offline & storage
- Shell-offline: service worker (web/standalone) vs on-device bundle (native) — auto-gated.
- Data-offline postures: fetch-and-fail / persisted-cache / local-first; connectivity accuracy (`navigator.onLine` vs `@capacitor/network`) feeding `onlineManager`.
- Storage: `localStorage` limits/eviction, IndexedDB, **secure storage** (Keychain/Keystore), cookies **don't work** in native Webview → bearer tokens.

### Networking & auth
- CORS (web) vs no-CORS (native); iOS **App Transport Security** blocks cleartext `http://`; timeouts; retry; certificate concerns.
- Auth: cookie-less bearer flow; OAuth redirect + **deep-link callback**; biometric unlock; token refresh on resume.

### Build, distribution & updates
> Full model + the hard **isomorphism boundary** (`createServerFn` cannot reach a native app): see **`docs/design/rendering.md`**. Owner's direction since 2026-09-14: server functions are a web feature, and the build of any artifact with no server (native, OTA, static) refuses with a report → `docs/roadmap/server-boundary.md`.
- One app → **SSR web** (default) + **static SPA** (native), auto per target; service worker on/off per target; **build-time env (`VITE_*`) is baked into the bundle**, so anything an app points at — a backend, an OTA channel — is chosen when the artifact is built, not when it launches, and each target's bundle carries its own answer.
- Code signing; unsigned `.ipa` for sideloading vs signed TestFlight/App Store; debug `.apk`.
- **OTA / live updates** — the bundle is a snapshot; JS/web-only updates can ship over-the-air (Capgo / `@capacitor/live-updates`, Apple 3.3.2); native changes need a store submission.
- **Version pinning hell** — Capacitor core vs plugins vs the SPM framework (`capacitor-swift-pm`) vs Xcode toolchain (prebuilt Swift binaries). adaptv should *own* a known-good version set so consumers never fight this.

### Performance
- Bundle size / code-splitting; first paint + hydration cost; 60fps gestures and transitions; GPU compositing (`will-change`), jank on low-end Android; memory; image decode.

### Rendering & platform quirks
- WebKit: text magnifier, caret repaint, autocorrect/selection overlays, elastic scroll, `100vh`, tap delay, input zoom.
- Chrome/Android: nav-bar color (system-owned), cutout letterbox, edge-to-edge enforcement (SDK 35), WebView version skew.
- Fonts: FOUT/FOIT, system font stacks, dynamic type / OS font scaling.

### Accessibility & i18n
- Focus management, VoiceOver/TalkBack, `prefers-reduced-motion`, dynamic type / font scaling, contrast, minimum tap targets (44/48px), RTL, locale-aware dates/numbers.

### Developer experience
- Testing across **six targets** (see `docs/guides/testing.md`); hot reload for web/standalone, rebuild for native; debugging the native WebView; surfacing device logs without manual handoff; **lint rules that enforce the correctness contract**; clear error messages.

That list is the moat. Nobody solves all of it well; adaptv's job is to solve it *once*, correctly, behind primitives.

---

## 4. Architecture (the layers)

```
adaptv.config.ts  ── single source of truth ─────────────────────────────┐
   │ generates: web manifest · capacitor.config · native projects · splash · icons · theme
   ▼
Build targets (vite plugin)                                             
   • web  → SSR + service worker         (pnpm build)                    
   • native → static SPA + no SW         (ADAPTV_TARGET=capacitor)        
   ▼
Shell (framework layer over TanStack Start)                             
   • root document, pre-paint theme/platform stamp, critical CSS         
   • splash policy, memory history, hardware back, status bar, safe-area 
   ▼
Primitives  ── the consumer-facing API ─────────────────────────────────
   View · Button · List · Link · Text · Image · Input · Offline        
   Swipeable · Drawer/Sheet · Modal · Tabs · AvoidKeyboard               
   ▼
Capabilities  ── platform-branching device access ─────────────────────
   hooks:  useKeyboard · useNetwork · useTheme · useGeolocationWatch     
   apis:   haptics · share · splash · clipboard · storage · biometrics   
   (web/PWA impl  +  native branch behind isNativePlatform())            
   ▼
Enforcement                                                             
   build-time lint rules · dev-only runtime warnings · types            
```

Platform truth lives in **one** place (`@repo/adaptv/utils`: `isNativePlatform` / `isInstalledApp` /
`getOS`), stamped pre-paint onto `<html data-adaptv-platform data-adaptv-os>` so CSS and primitives
resolve from the first frame. Nothing keys off `display-mode` (a native WebView lies about it).

---

## 5. Primitives (proposed APIs + examples)

> These are the target designs. Where something exists today it's noted. All examples are illustrative.

### `View` — the base box
Behavior via props. Scrolling, edge-fades, and safe-area are props, not classes.

```tsx
// A vertical scroll region with fading edges that auto-hide when there's nothing to fade,
// padded for the bottom safe area. No overflow classes, no min-h-0 chain to get wrong.
<View scroll="y" fades="both" safe="bottom" className="gap-3 px-4">
  {items.map(i => <Row key={i.id} {...i} />)}
</View>

<View scroll="x" fades={{ left: false, right: true }}>{chips}</View>   // single-axis, one fade
<View row center className="gap-2">{...}</View>                         // flex helpers as props
```
- `scroll`: `"x" | "y" | "both" | false` — sets overflow + touch-action + overscroll-contain + the cross-axis lock, correctly, once.
- `fades`: masked gradient edges (the `%` hard-coded for physical correctness; color follows background); auto-hide when not scrollable.
- `safe`: `"top" | "bottom" | "x" | "all"` — safe-area padding that resolves per target.
- **Lint:** `overflow-*`, `scrollable-*`, `min-h-0` in `className` on a `<View>` → build error: "use `scroll`."

### ~~`Screen`~~ — removed (see L5)

**`Screen` was deleted 2026-07-20.** It duplicated what the shell already owns.

The frame is seeded **above** the route: the shell provides a full-viewport slot and stretches its
child, exactly as React Navigation's navigator does. A route's root is therefore just a `View` — a
dumb-correct `flex-col` box — and there is no second component whose job is "be the root."

The failure it avoids is real: with both a shell frame *and* a `Screen`, "who owns edge-to-edge" has
two answers, and a route nested one level deeper silently gets a different one. Root-ness must never be
inferred from position in the DOM. → `docs/design/architecture.md §1`

### `Button` — real press physics
Wraps the gesture engine (exists: `useGestureEngine`, and the patched `active:` variant). Press feedback that survives finger re-entry, optional haptic, disabled states, keyboard-activatable.

```tsx
<Button onPress={createTask} haptic="light" className="bg-primary text-white">
  New task
</Button>

<Button variant="ghost" onPress={undo} disabled={!canUndo} />
// press → data-pressed (JS-driven, not :active) → active:scale-95; haptic fires on pointerup (native/web).
```

### `List` — optimized cross-platform lists
Virtualized (wrap TanStack Virtual), sticky sections, pull-to-refresh, infinite, scroll-restoration.

```tsx
<List
  data={todos}
  keyExtractor={t => t.id}
  renderItem={t => <TodoRow todo={t} />}
  onRefresh={sync}                 // pull-to-refresh (native-feel on touch, button on desktop)
  onEndReached={loadMore}
  fades="both"
  estimateSize={64}
/>
```

### `Link` — nav that knows internal vs external
Internal → client router (memory history in-app). External → system browser via `@capacitor/browser` on native, new tab on web.

```tsx
<Link to="/settings">Settings</Link>                     {/* in-app route */}
<Link href="https://example.com" external>Docs</Link>    {/* system browser on native */}
```

### `Swipeable` — the perfect swipe row
Left/right action reveal, threshold dismiss, spring physics, cancels correctly, plays with scroll.

```tsx
<Swipeable
  right={[{ label: "Delete", tone: "danger", onAction: () => remove(id) }]}
  left={[{ label: "Archive", onAction: () => archive(id) }]}
  onDismiss="right"
>
  <TodoRow todo={todo} />
</Swipeable>
```

### `Drawer` / `Sheet` — the perfect bottom sheet
Snap points, backdrop dismiss (ghost-click guarded — fixed today), **keyboard-aware via the shared
`AvoidKeyboard`/`useKeyboard` primitive** (native `@capacitor/keyboard`, not visualViewport guesswork),
stays mounted for exit animation.

```tsx
<Drawer open={open} onOpenChange={setOpen} snapPoints={["content", 0.9]}>
  <Drawer.Header>New deck</Drawer.Header>
  <View scroll="y">
    <Input autoFocus placeholder="Name" />   {/* keyboard lifts the sheet correctly on every target */}
  </View>
  <Drawer.Footer>
    <Button onPress={save}>Save</Button>
  </Drawer.Footer>
</Drawer>
```

### `Input`, `Text`, `Image`, `Modal`, `Tabs`
- ✅ `Input` — keyboard avoidance, autocorrect/spellcheck static-disable, no-zoom font, caret fixes baked in. **Shipped** (`src/components/input.tsx`, `text-area.tsx`, `avoid-keyboard/`).
- ✅ `Text` — selectable opt-in, truncation, dynamic-type aware. **Shipped** 2026-07-30 (`src/components/text.tsx`); the two-quirk test it passes is in `docs/research/component-surface.md §8.1`.
- ✅ `Image` — lazy, placeholder/blur, safe intrinsic sizing (no layout shift). **Shipped** 2026-07-30, and this line is delivered by [`design/image.md`](design/image.md), which is the design of record including the build-time placeholder pipeline.
- 🚧 `Modal` / `Tabs` — focus trap, stacking, safe-area, back-button integration. **Not built** → [`roadmap/component-gaps.md`](roadmap/component-gaps.md) Tiers 2 and 3.

---

## 6. Capabilities (hook-vs-API + examples)

**Imperative → API** (plain functions, tree-shakeable, work outside React):

```ts
import { haptics, share, splash, clipboard, storage } from "@repo/adaptv/capabilities"

haptics.impact("light")                 // navigator.vibrate / iOS polyfill / @capacitor/haptics
await share({ title, url })             // Web Share API / native share sheet
splash.hide()                           // native launch splash hand-off
await clipboard.write(text)
await storage.secure.set("token", jwt)  // localStorage (web) / Keychain·Keystore (native)
```

**Reactive → hook**:

```ts
const online = useNetwork()             // navigator.onLine+events / @capacitor/network
const { open, height } = useKeyboard()  // visualViewport / virtualKeyboard / @capacitor/keyboard
const { preference, resolved, setPreference } = useTheme()
```

**Permission-gated → async fn (one-shot) or hook (watch)**, modeled on geolocation (exists):

```ts
const perm = await requestPermission("camera")   // web Permissions / native OS dialog
const pos  = await getLocation()                  // one-shot
const stop = watchLocation(setPos)                // live → returns unsubscribe
```

Adding a capability is always the same shape: `capabilities/<x>.ts` → `if (!isNativePlatform()) { web }
else { @capacitor/<plugin> }` → export; wrap in a hook only if it's reactive.

---

## 7. Configuration — one file

```ts
// adaptv.config.ts — generates the web manifest, capacitor.config, native project settings.
export default defineApp({
  name: "ChopChop",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  backgroundColor: "#ffffff",
  icons: "./public/favicons",
  orientation: "portrait",

  splashScreen: () => import("@/components/splash-screen"),  // shown on iOS + native; skipped on Android-PWA & browser

  native: {                                 // PROPOSED — replaces a hand-written capacitor.config
    appId: "com.chopchop.app",
    edgeToEdge: true,                        // adaptv opinionates this on
    plugins: ["haptics", "keyboard", "status-bar", "network", "geolocation", "app"],
  },
  router: { render: "ssr", /* auto → spa for the capacitor target */ },
})
```

Consequences that fall out automatically: web manifest, `capacitor.config.json`, StatusBar edge-to-edge,
splash policy, orientation lock, service-worker gating, SSR↔SPA per target. **No second config file.**

---

## 8. Developer experience

- **Six-target testing** discipline and commands: `docs/guides/testing.md`.
- **Enforcement**: build-time lint rules (className-behavior misuse, non-`View` route roots), dev-only
  runtime warnings, and types that make illegal states unrepresentable.
- **Debugging native**: WebView inspection (`chrome://inspect`, Safari ▸ Develop), device log sink.
- **Version safety**: adaptv pins a known-good Capacitor set (core/plugins/framework/Xcode) so consumers
  never hit the SPM/CocoaPods/toolchain skew (documented in `stack/capacitor`).

---

## 9. Open questions (decide as we go)

> ⚠︎ **Most of this list is closed.** It is kept for the shape of the original questions, not as a
> status. The live set — and what each closed one was closed *with* — is
> [`roadmap/open-questions.md`](roadmap/open-questions.md); the full rationale is
> [`decisions/register.md §5`](decisions/register.md). Only **navigation model** and **testing
> automation** below are still genuinely open.

- **Styling system** — stay Tailwind-classes-for-presentation, or add a typed style prop? (Leaning: keep
  Tailwind; behavior via props, looks via `className`.)
- **Lint delivery** — a Biome plugin, an ESLint rule, or a Vite transform for the correctness rules?
- **`List` virtualization** — wrap TanStack Virtual vs a bespoke engine for pull-to-refresh + sticky.
- **Navigation model** — how much of tabs/modals/sheets stacking does adaptv own vs TanStack Router?
- **OTA** — bundle a live-update client (Capgo/`@capacitor/live-updates`) as a first-class adaptv feature?
- **Secure storage / auth** — how opinionated should adaptv be about the bearer-token + biometric flow?
- **Testing automation** — can the six-target matrix run in CI (sims/emulators) or stay local?
- **Distribution** — does adaptv own signing config + fastlane, or stop at the unsigned artifact?
- ✅ **Scope discipline — ANSWERED, see `docs/design/architecture.md §5`.** The method: a primitive is *forced* when
  cross-platform divergence means the consumer would otherwise write the branch (Drawer), or *elective*
  when it's a genuinely better building block (View's `min-h-0` safety). Ship **every layer** of the §4
  ladder as a public export, not just the component. Prioritise from **filtered demand** — Ionic's
  component list, RN/Expo's API surface, and especially *popular Capacitor packages, since a popular
  package is a gap in the framework*. Wrap by default, but **health-check first: popularity is not
  health** (`vaul` has 37M downloads/week and is dead). *(Original question below, for context.)*
- ~~which 8–10 primitives are the 80/20?~~ (View, Button, List, Link, Input,
  Swipeable, Drawer, Text, Image — everything else composes from these.)

---

## 10. Sequencing (how we get there without boiling the ocean)

Pick a driving pain → build the one primitive that kills it **end-to-end across all six targets** →
document the pattern → repeat. ChopChop is the forcing function; every primitive has a real use there.

1. **Native keyboard avoidance** — `useKeyboard` gains a `@capacitor/keyboard` branch; the drawer and
   `AvoidKeyboard` stop misbehaving on native. (Real pain now; proves the capacitor-aware-primitive loop.)
2. **`capacitor.config` from `adaptv.config`** — kill the second config file.
3. **`View` contract** — props-not-className, edge-to-edge default, the lint rule. The spine.
4. Then **Button → List → Swipeable → Drawer-on-AvoidKeyboard → Link → Input**, each verified on six targets.

The measure of success: a developer writes ordinary React with these primitives and gets a browser app,
an installable PWA, and native iOS/Android builds that each feel native — without thinking about a single
item in §3.
