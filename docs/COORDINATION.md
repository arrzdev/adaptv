# nativ — the runtime coordination layer

> The **app-runtime lifecycle** and the shared arbiters that make overlapping cross-platform behaviours
> resolve *deterministically*: app state (resume/pause), the hardware/soft **back** chain, the **gesture**
> controller, and **route** lifecycle. This is the correct-by-construction spine the leaf primitives
> (`Drawer`, `Swipeable`, `Modal`) — and the OTA updater — compose onto.
>
> Distinct from `LIFECYCLE.md` (the *build/deploy* lifecycle); this is the *running app's* lifecycle. All
> four contracts are pure logic, mockable at the Capacitor edge (TDD-ready — not TDD'd in this pass).
> Started **2026-07-14**. Pairs with `RESEARCH.md §1` (the gaps) + `§4` (Ionic prior art to study).

---

## 0. Why a coordination layer

Four runtime concerns each have the same failure mode: **more than one actor wants the same event, and
without a shared arbiter the wrong one wins.**

- A **resume** must refresh the token *before* the first request — but no React effect fires on
  home→app.
- A **back** press must close an open drawer *before* it navigates — but a lone `router.back()` can't
  know the drawer is open.
- A **drag** near the edge must resolve to *exactly one* of edge-swipe-back / scroll / swipeable-row —
  but each gesture handler is blind to the others.
- A **navigation** must run enter/leave deterministically — but React mount/unmount and the OS lifecycle
  disagree about when a screen "left."

Today nativ handles each in isolation (`useAndroidBackButton` hardcodes routing; `useGestureEngine` vetoes
via pointer capture; there is no app-state hook at all). The coordination layer makes these **shared,
priority-ordered contracts** instead of per-primitive discipline. Doctrine: *study how Ionic arbitrates
(gesture controller, `ionBackButton`, page lifecycle), adopt the hard-won semantics, diverge where nativ's
memory-history + DOM model differs* (`ARCHITECTURE.md §0.6`).

---

## 1. App state — foreground / background / resume / pause

### The problem
React effects and route lifecycle only run while the app is foregrounded. The most common mobile
lifecycle event — background then resume — fires **none** of them, and the "we're back" signal differs
per target:

| Target | Resume / pause signal |
|---|---|
| Native iOS/Android | `@capacitor/app` `resume` / `pause` |
| Browser tab / PWA | `visibilitychange` (+ `pageshow` for bfcache restores) |

### The contract
Mirror the `network` accessor+hook duality so **non-React code can subscribe too** (the OTA updater is
not a component):

```ts
const state = useAppState()                 // "active" | "background"
useAppState.onResume(() => { … })           // native resume OR tab re-focus
useAppState.onPause(() => { … })
// low-level, for non-React consumers (OTA updater, auth):
subscribeAppState(cb) / getAppState()
```

- **Native** → `App.addListener("resume"/"pause")`, attached **eagerly at boot** in the shell (same
  pattern as the keyboard listeners, so nothing races the first event). **Web** → `visibilitychange` +
  `pageshow`.
- **Consumers:** token refresh, TanStack Query refetch-on-resume (a native WebView resume is *not* a
  browser "focus", so `refetchOnWindowFocus` misses it — this hook is the fix), biometric re-lock, socket
  reconnect, and **the OTA update check** (`LIFECYCLE.md §5.4`).

### Cold-start & deep links belong here too
The app-open lifecycle is the same concern: `@capacitor/app` `appUrlOpen` (native, warm + cold) / the
initial URL (web) → resolve to a route. Cold-start deep-link (the app wasn't running) vs warm deep-link
(it was backgrounded) are the two cases; both route through this layer so auth guards (`beforeLoad`) and
the resume refresh run in the right order.

---

## 2. Back — a priority handler chain

### The problem
`router.back()` alone is wrong: an open overlay must intercept back *before* navigation, and an installed
app (no browser history, no URL bar) needs the app to fully own back — including a programmatic affordance,
since there's no browser chrome.

### The contract
A **module-level registry** (not React context — it must be reachable from both the eager `App.backButton`
listener *and* imperative code):

```ts
useBackHandler(handler, priority)   // register/unregister on mount/unmount; handler → true (handled) | false (defer)
nativBack()                         // platform-agnostic programmatic back for in-app affordances
```

- The shell installs **one** `App.backButton` listener that walks registered handlers **high→low
  priority**; the first to return `true` consumes the press, else it defers to the next.
- **Default lowest-priority handler** = `router.history.canGoBack() ? back() : exitApp()` — today's
  `useAndroidBackButton` behaviour, refactored to be the *floor* of the chain rather than the whole thing.
- **Priority bands:** overlays (`Drawer`/`Modal`/`Sheet`, registered while open) > transient UI (menus,
  search) > in-app back affordance > router back > app exit.
- `nativBack()` unifies the Android hardware button, an in-app back button, and (when installed) the
  otherwise-inert OS gesture into one path.

> ### ✅ BUILT — controller + React binding; one primitive migrated
>
> `capabilities/gesture-controller.ts` (16 tests) is the pure arbiter; `hooks/use-gesture-capture.ts`
> (6 tests) is the React binding, giving each mounted instance its own identity so two `Swipeable` rows
> on one screen genuinely compete rather than aliasing into a single gesture.
>
> **`Swipeable` is migrated** and is the pattern for the rest. The integration point matters more than
> the wiring: capture is requested **at the moment the swipe locks**, not on `pointerdown`. A
> pointerdown is also how a *tap* starts, so claiming there would starve every other gesture on the
> screen for the duration of every touch. Both lock points — the mouse path and the imperative touch
> path — go through the arbiter, and `onLost` ends the drag so a pre-empted row springs back instead of
> being left mid-translate with no pointer to finish it.
>
> `GesturePriority`: `EdgeSwipe 400 > DrawerDrag 300 > SwipeableRow 200 > Scroll 100`.
>
> **All three primitives are migrated.** Each claims the arbiter at the point where its gesture becomes
> unambiguous, which differs per primitive and is the part worth getting right:
>
> | Primitive | Claims at | Why not earlier |
> |---|---|---|
> | `Swipeable` | the horizontal **lock** | a pointerdown is also how a tap starts; claiming there starves every other gesture for the duration of every touch |
> | `Drawer` (handle) | **pointerdown** | there is nothing else a handle press could mean, so it commits immediately |
> | `Drawer` (whole sheet) | the scroll **takeover** | a touch on the sheet usually means scrolling its content |
> | `EdgeSwipeGestures` | **touchstart inside the edge strip** | it only decides at touchend, but waiting would be too late to stop a row swipe running under the same finger. The strip is a few pixels wide, so holding the pointer there is narrow enough not to starve anything — and suppressing an in-content gesture under an edge touch is the intended outcome |
>
> Every one wires `onLost` so a pre-empted gesture resets rather than being stranded mid-translate with
> no pointer left to finish it — the drawer snaps back, the row springs back.
>
> ⏳ **Still owed: device tuning.** The priority *numbers* are reasoned, not felt. The ordering wants
> confirming on hardware with a drawer, a swipeable row and a scroller on one screen — exactly the kind
> of judgement a unit test cannot make.

### Delta
`use-android-back-button.ts` currently hardcodes `router.back()`/`exitApp()` with no interception point.
Refactor it into: (a) the shared chain + registry, (b) the default floor handler, (c) overlays registering
high-priority handlers. Reference: Ionic `ionBackButton` priority model (`RESEARCH.md §4`).

---

## 3. Gestures — the controller (full Ionic-style)

**Decided: the full controller, not a minimal arbiter** — if nativ owns gesture arbitration it should own
the real semantics rather than grow into them. It's pure logic, so the extra scope is mostly extra test
cases, not extra runtime risk.

### The problem
`Drawer` drag, `Swipeable` row, `ScrollView`, and edge-swipe-back all compete for the same pointer stream.
Only one may win. `useGestureEngine`'s pointer-capture veto handles tap-vs-swipe on a single element, but
there is no **shared** arbiter across sibling/ancestor gestures.

### The contract
A singleton `GestureController` that grants a single captured gesture at a time, modelled on Ionic's
`createGesture` + gesture-controller (`RESEARCH.md §4`):

```ts
const gesture = createGesture({
  name: "drawer-drag",
  priority,                 // higher wins a contested start
  canStart, onStart, onMove, onEnd,
  blocksScroll: true,       // stop the scroller while this gesture owns the pointer
  direction: "y",
})
gesture.enable() / .destroy()
```

- The controller holds **capture requests**; a higher-priority `canStart` can pre-empt a lower one; a
  captured gesture blocks others until it releases. `blocksScroll`/`disableScroll` stop the scroll
  container while a drag owns the pointer (the reliable cross-platform way, since `touch-action` can't
  change mid-touch on iOS).
- `useGestureEngine` (the per-element press/long-press/reentrant engine) stays; the controller is the
  **layer above** it that decides *which* element's gesture starts when several could.

### Delta
Build the controller; wire `Drawer` drag, `Swipeable`, and edge-swipe onto it so they coexist (a real
chopchop screen has all three). Diverge from Ionic where the DOM/React model needs (React refs, pointer
events, the existing reentrant engine).

---

## 4. Route / screen lifecycle

### Decided principle: **no DOM retention** (`ARCHITECTURE.md §0.4`)
RN's navigator and Ionic both *keep popped pages in the DOM* until popped. nativ does **not**: it uses
memory-history + client routing, so a React **unmount is the natural "leave."** This keeps the model
predictable and avoids the retained-DOM state bugs Ionic documents (`RESEARCH.md §4`).

### The contract
Map lifecycle to what already exists, thinly:

- `beforeLoad` = **will-enter** (auth guards, redirects — isomorphic, per `RENDERING.md`).
- A route component **mount** = **enter**; **unmount** = **leave**. `useScreenLifecycle({ onEnter,
  onLeave })` is sugar over mount/unmount + the route match, for symmetry with the mental model — not a
  new retention mechanism.
- **Resume is not enter** — that's §1's job. Ionic's page hooks famously *don't* fire on resume; nativ
  keeps them separate on purpose (route lifecycle = navigation; app state = foreground).

If a future screen genuinely needs to survive back (retain scroll/state), that's a **deliberate opt-in**
(a cached route), never the default.

---

## 5. How the four compose (the arbitration picture)

```
BACK press ─────▶ back chain (§2): open Drawer's handler consumes → else router back → else exit
DRAG at edge ───▶ gesture controller (§3): grants ONE of edge-swipe-back / scroll / swipeable
RESUME ─────────▶ app state (§1): token refresh + Query refetch + OTA check (LIFECYCLE §5.4)
NAVIGATE ───────▶ route lifecycle (§4): enter/leave via mount/unmount; memory history when installed
```

These four are the shared substrate. Leaf primitives register into them (a `Drawer` adds a back handler
*and* a gesture *and* mounts/unmounts a screen), and cross-cutting systems (auth, OTA) subscribe to app
state. Nothing below coordinates itself ad-hoc.

---

## 6. Status & build order

All four are **unbuilt** except a partial `useAndroidBackButton` (single hardcoded handler, §2 delta).
When this moves from design to TDD, the order — smallest/most-isolated first, and following the OTA
dependency — is:

1. **`useAppState`** — zero deps, unblocks OTA + refetch-on-resume. The TDD template (mirrors
   `network.test.ts`).
2. **Back-handler chain** — refactor `useAndroidBackButton` onto it; overlays register.
3. **Gesture controller** — the singleton; wire `Drawer`/`Swipeable`/edge-swipe.
4. **Route lifecycle** — the thin `useScreenLifecycle` + the no-retention guarantee.

Each is pure logic with a mockable Capacitor edge → ideal for tests-first. Cross-refs: `RESEARCH.md §1`
(these exact gaps), `§4` (Ionic source/issues to read first), `LIFECYCLE.md §5.4` (OTA ⇐ app state),
`ARCHITECTURE.md §0.4` (no-DOM-retention).
