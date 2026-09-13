# adaptv — the runtime coordination layer

> The **app-runtime lifecycle** and the shared arbiters that make overlapping cross-platform behaviours
> resolve *deterministically*: app state (resume/pause), the hardware/soft **back** chain, the **gesture**
> controller, and **route** lifecycle. This is the correct-by-construction spine the leaf primitives
> (`Drawer`, `Swipeable`, `Modal`) — and the OTA updater — compose onto.
>
> Distinct from `docs/design/lifecycle.md` (the *build/deploy* lifecycle); this is the *running app's*
> lifecycle.
>
> ✅ **All four are SHIPPED** — `src/capabilities/{app-state,back-chain,gesture-controller}.ts` and
> `src/hooks/{use-app-state,use-back-handler,use-gesture-capture,use-screen-lifecycle}.ts`, each with
> tests, and the gesture controller has three real consumers (`Drawer`, `Swipeable`, edge-swipe).
> Started **2026-07-14** as a design; **re-tensed to describe what was built on 2026-08-30**, at which
> point it had spent a month telling readers this layer did not exist. Where the built API differs
> from the original sketch, the built one is recorded and the sketch is marked.

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

When this was written adaptv handled each in isolation — `useAndroidBackButton` hardcoded routing,
`useGestureEngine` vetoed via pointer capture, and there was no app-state hook at all. The coordination
layer replaced that per-primitive discipline with **shared, priority-ordered contracts**, and is what
`src/capabilities/{app-state,back-chain,gesture-controller}.ts` are. Doctrine: *study how Ionic arbitrates
(gesture controller, `ionBackButton`, page lifecycle), adopt the hard-won semantics, diverge where adaptv's
memory-history + DOM model differs* (`docs/design/architecture.md §0.6`).

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
// as built — `src/hooks/use-app-state.ts`, `src/capabilities/app-state.ts`
const state = useAppState()                 // "active" | "background"
useOnResume(() => { … })                    // native resume OR tab re-focus
useOnPause(() => { … })
// low-level, for non-React consumers (OTA updater, auth):
subscribeAppState(cb) / getAppState() / onResume(cb) / onPause(cb)   // each returns an unsubscribe
```

> ⟨amended 2026-08-30⟩ The sketch here was `useAppState.onResume(cb)` — **statics hung off the hook**.
> That shape was never built and should not be reintroduced: a static on a hook is invisible to the
> rules-of-hooks lint and cannot be called from non-React code, which is the exact consumer (the OTA
> updater) this contract exists for. The built split is a plain hook pair (`useOnResume`/`useOnPause`)
> over module-level `onResume`/`onPause` accessors.

- **Native** → `App.addListener("resume"/"pause")`, attached **eagerly at boot** in the shell (same
  pattern as the keyboard listeners, so nothing races the first event). **Web** → `visibilitychange` +
  `pageshow`.
- **Consumers:** token refresh, TanStack Query refetch-on-resume (a native WebView resume is *not* a
  browser "focus", so `refetchOnWindowFocus` misses it — this hook is the fix), biometric re-lock, socket
  reconnect, and **the OTA update check** (`docs/design/ota.md §5.4`).

### Cold-start & deep links belong here too
The app-open lifecycle is the same concern: `@capacitor/app` `appUrlOpen` (native, warm + cold) / the
initial URL (web) → resolve to a route. Cold-start deep-link (the app wasn't running) vs warm deep-link
(it was backgrounded) are the two cases; both route through this layer so auth guards (`beforeLoad`) and
the resume refresh run in the right order.

> ⟨amended 2026-09-13⟩ Built as `src/capabilities/url-open.ts`, installed by the router factory rather
> than at shell mount, because the plugin replays the launching link to the first listener only and
> the shell mounts after the router exists. Cold = before the router's first screen has settled, and
> it replaces the entry; warm pushes. The web branch is nothing: the initial URL already is the route.

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
adaptvBack()                         // platform-agnostic programmatic back for in-app affordances
```

- The shell installs **one** `App.backButton` listener that walks registered handlers **high→low
  priority**; the first to return `true` consumes the press, else it defers to the next.
- **Default lowest-priority handler** = `router.history.canGoBack() ? back() : exitApp()` — today's
  `useAndroidBackButton` behaviour, refactored to be the *floor* of the chain rather than the whole thing.
- **Priority bands:** overlays (`Drawer`/`Modal`/`Sheet`, registered while open) > transient UI (menus,
  search) > in-app back affordance > router back > app exit.
- `adaptvBack()` unifies the Android hardware button, an in-app back button, and (when installed) the
  otherwise-inert OS gesture into one path.

> ### ✅ BUILT — controller + React binding; one primitive migrated
>
> `capabilities/gesture-controller.ts` (20 tests) is the pure arbiter; `hooks/use-gesture-capture.ts`
> (9 tests) is the React binding, giving each mounted instance its own identity so two `Swipeable` rows
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
high-priority handlers. Reference: Ionic `ionBackButton` priority model (`../decisions/prior-art.md §12.1`).

---

## 3. Gestures — the controller (full Ionic-style)

**Decided: the full controller, not a minimal arbiter** — if adaptv owns gesture arbitration it should own
the real semantics rather than grow into them. It's pure logic, so the extra scope is mostly extra test
cases, not extra runtime risk.

### The problem
`Drawer` drag, `Swipeable` row, `ScrollView`, and edge-swipe-back all compete for the same pointer stream.
Only one may win. `useGestureEngine`'s pointer-capture veto handles tap-vs-swipe on a single element, but
there is no **shared** arbiter across sibling/ancestor gestures.

### The contract
A singleton `GestureController` that grants a single captured gesture at a time, modelled on Ionic's
`createGesture` + gesture-controller (`../decisions/prior-art.md §12.1`):

```ts
// as built — `src/capabilities/gesture-controller.ts`, `src/hooks/use-gesture-capture.ts`
const capture = useGestureCapture({
  id: "drawer-drag",
  priority: GesturePriority.Drawer,   // higher wins a contested start
  blocksScroll: true,                 // stop the scroller while this gesture owns the pointer
  onLost: () => { … },                // a higher-priority gesture pre-empted us
})
// non-React: `gestureController` (the singleton) or `createGestureController()` for a test instance
```

> ⟨amended 2026-08-30⟩ The block previously printed here was **Ionic's `createGesture` API**, not
> adaptv's — `createGesture` has never existed anywhere in `src/`. adaptv took Ionic's *arbitration
> semantics* (one captured gesture, priority pre-emption, scroll blocking) and left its API behind:
> the movement callbacks (`onStart`/`onMove`/`onEnd`) stay with the per-element `useGestureEngine`,
> and the controller only arbitrates **who owns the finger**. Keeping the two separate is why
> `useGestureCapture` takes no pointer handlers at all.

- The controller holds **capture requests**; a higher-priority `canStart` can pre-empt a lower one; a
  captured gesture blocks others until it releases. `blocksScroll`/`disableScroll` stop the scroll
  container while a drag owns the pointer (the reliable cross-platform way, since `touch-action` can't
  change mid-touch on iOS).
- **Disabling is not unregistering.** `setEnabled(id, false)` remembers the id so it stays refused;
  `unregister(id)` releases the same way (with `onLost`) and then forgets it. The React binding
  unregisters on unmount, because `useId` never reissues an id: disabling there kept one id per
  unmounted `Drawer`/`Swipeable`/`EdgeSwipeGestures` forever — 9 per `/` ↔ `/settings` round trip in
  the playground, 5400 after 600, measured with heap snapshots.
- `useGestureEngine` (the per-element press/long-press/reentrant engine) stays; the controller is the
  **layer above** it that decides *which* element's gesture starts when several could.

### Delta — ✅ discharged
The controller is built and all three consumers are wired: `src/components/drawer/drawer-engine.tsx`,
`src/components/swipeable.tsx`, `src/components/edge-swipe-gestures.tsx` each request capture through
`useGestureCapture`. It diverges from Ionic where the DOM/React model needed it (React refs, pointer
events, the existing reentrant engine). What is **not** closed is the *priority numbers* — arbitration
logic is proven by tests, but the ordering is a feel judgement on a real screen carrying a drawer, a
swipeable row and a scroller at once. → [`../roadmap/owed-device-verification.md`](../roadmap/owed-device-verification.md)

---

## 4. Route / screen lifecycle

### Decided principle: **no DOM retention** (`docs/design/architecture.md §0.4`)
RN's navigator and Ionic both *keep popped pages in the DOM* until popped. adaptv does **not**: it uses
memory-history + client routing, so a React **unmount is the natural "leave."** This keeps the model
predictable and avoids the retained-DOM state bugs Ionic documents (`../decisions/prior-art.md §12.1`).

### The contract
Map lifecycle to what already exists, thinly:

- `beforeLoad` = **will-enter** (auth guards, redirects — isomorphic, per `docs/design/rendering.md`).
- A route component **mount** = **enter**; **unmount** = **leave**. `useScreenLifecycle({ onEnter,
  onLeave })` is sugar over mount/unmount + the route match, for symmetry with the mental model — not a
  new retention mechanism.

  > ✅ **Reachable as of 2026-08-30** — `import { useScreenLifecycle } from "@arrzdev/adaptv/hooks"`.
  > It had shipped in the internal `src/hooks/index.ts` while being absent from
  > `src/interface/hooks.index.ts`, the barrel `package.json` `exports` actually points at, so this
  > doc described a contract no consumer could import. It was a barrel omission, not a decision —
  > the same class of drift that once hid `Text` — and the code was the side that moved.
  >
  > The hooks that are genuinely private are private for a reason this one does not have: they are
  > **mounted by the shell on every app** (`useCaretRepaint`, `useSuppressTextMagnifier`), so a
  > consumer calling them would double-mount framework behaviour. `useScreenLifecycle` is the
  > opposite — it does nothing unless a route component calls it.
- **Resume is not enter** — that's §1's job. Ionic's page hooks famously *don't* fire on resume; adaptv
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

## 6. Status

| # | Contract | Built | Reachable by a consumer |
|---|---|---|---|
| 1 | **App state** | `src/capabilities/app-state.ts`, `src/hooks/use-app-state.ts` | ✅ both barrels |
| 2 | **Back chain** | `src/capabilities/back-chain.ts` (`BackPriority`), `src/hooks/use-back-handler.ts` | ✅ both barrels |
| 3 | **Gesture controller** | `src/capabilities/gesture-controller.ts` + `src/hooks/use-gesture-capture.ts` | ✅ capability barrel. The *hook* is framework-internal by design — the three primitives are its consumers. |
| 4 | **Route lifecycle** | `src/hooks/use-screen-lifecycle.ts` | ❌ **missing from `src/interface/hooks.index.ts`** — see the note in §4 |

The build order this section used to prescribe — `useAppState` → back chain → gesture controller →
route lifecycle — is recorded as **L18** in
[`../decisions/register.md §2`](../decisions/register.md), and it was followed. Nothing here is
outstanding except the §4 barrel export.

> **Why this section is now a status table and not a plan.** Until 2026-08-30 it opened with *"All four
> are **unbuilt** except a partial `useAndroidBackButton`"* and then laid out four steps to build them.
> Every one had shipped. That single sentence was the most misleading line in the documentation, and the
> structural fix is the rule this folder now runs on: **`design/` is present tense.** A future-tense
> sentence in this folder is a bug — plans belong in [`../roadmap/`](../roadmap/README.md).
