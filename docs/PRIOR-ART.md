# nativ — prior art: what we port from Ionic, and how we attribute it

> Doctrine `ARCHITECTURE.md §0.6` says *"don't reinvent the solved — study their solution, adopt the
> hard-won edge cases."* This is the concrete list: what nativ **ports**, what it **studies**, what it
> **skips**, and the attribution convention for ported code.
>
> Source: `@ionic/core` **v8.8.14**, commit **`6251eb85db0e5b43b9e09604248dc8451e1664c0`** (2026-07-17,
> `main`). Read from a local clone, not from docs. Line numbers and constants verified at that SHA.

---

## 0. License & attribution — settled

**Ionic Framework is MIT.** `LICENSE` at repo root: `Copyright (c) 2015-present Drifty Co.`, confirmed
by `"license": "MIT"` in `core/package.json@8.8.14`. No CLA, no patent grant, no copyleft.

MIT requires only: *"The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software."* **Porting substantial logic counts as a substantial
portion.** nativ's own `package.json` says `UNLICENSED`, which is fine — MIT permits relicensing
derivative work under any terms, including proprietary, as long as the notice travels with the code.

### 🔒 The convention

**1. A `THIRD_PARTY_LICENSES` file at the repo root** carrying the full Ionic MIT text including the
Drifty copyright line. This is the only legally required step.

**2. Every ported file carries a provenance header** — not required by MIT, but it is how a reader
knows the constants aren't arbitrary, and it evidences provenance:

```ts
// Ported from Ionic Framework (MIT, © 2015-present Drifty Co.)
// https://github.com/ionic-team/ionic-framework/blob/6251eb85db0e5b43b9e09604248dc8451e1664c0/core/src/utils/gesture/index.ts
//
// Why: the start-position reset on capture. Without it every gesture visually
// jumps by exactly `threshold` px at the moment it engages.
```

**Pin the SHA, never `main`.** A `main` link rots and the reader can't diff what changed.

**3. The `Why:` line is mandatory.** A permalink tells you where a number came from; it doesn't tell
you why deleting it breaks things. Most of what's below is load-bearing *because* of a bug that isn't
obvious from the code.

**4. One transitive notice:** `css/normalize.scss` is normalize.css v3.0.2, MIT, © Nicolas Gallagher.
If that file is ported, carry his notice too. It's the only third-party header anywhere in `core/src`.

---

## 1. The port order — ranked by value per hour

| # | Item | Verdict | Why this rank |
|---|---|---|---|
| 1 | `structure.scss` — `transform: translateZ(0)` on `body` | **PORT** | **One line.** WebKit doesn't always promote body to its own layer on load; the first scroll then triggers a repaint that *halts scrolling until the next gesture*. Ionic's comment notes the lazy-loaded build masks this via hydration repaint — **nativ has no hydration repaint either**, so the first swipe on every page dead-drops without it. |
| 2 | Safe-area block from `core.scss` | **PORT** | `env()` appears **5 times in the entire css directory**, all here. The critical line is `var(--safe-area-inset-top, env(safe-area-inset-top))` — the Capacitor bridge, because Android WebView reports **zero** `env()` insets in edge-to-edge mode and `SystemBars` writes `--safe-area-inset-*` directly. Documented nowhere obvious. |
| 3 | `utils/hardware-back-button.ts` | **PORT** | ~140 lines, one dependency, solves Android back outright. nativ has no equivalent. → §2. |
| 4 | `utils/gesture/` (index, controller, pointer-events, recognizers) | **PORT** | The foundation for drawer/sheet/swipe-back, and the priority table saves weeks of conflict tuning. → §3. |
| 5 | `utils/lock-controller.ts` | **PORT** | 12 lines. Prevents double-tap `present()`/`dismiss()` races leaving an overlay stuck half-open. Wrap call sites in `try/finally` — Ionic doesn't, and a missed unlock deadlocks that component permanently. |
| 6 | `utils/animation/cubic-bezier.ts` | **PORT verbatim** | 105 lines of pure math, zero deps. Inverts a bezier (given progress, find time) via **Cardano's formula** — closed-form, not Newton-Raphson. A drag gives you *position*; `progressStep` wants *time*, and on a non-linear curve those differ. A day to derive. |
| 7 | `swipe-back.ts` + ios/md transition constants | **PORT the numbers** | nativ has `edge-swipe-gestures.tsx` — diff against these. → §4. |
| 8 | modal `gestures/sheet.ts` + `swipe-to-close.ts` | **PORT** | Not in the original scope; the highest-value unlisted find. Directly upgrades `src/components/drawer/`. → §5. |
| 9 | `utils/tap-click/index.ts` | **PORT** | Three magic numbers + the `pointercancel` strategy, tuned over years. → §6. |
| 10 | `utils/focus-trap.ts` + `utils/focus-controller/` | **PORT** | A11y correctness nativ lacks today. Bring the CSS with it — `focus-controller` needs matching `outline: none` rules in `core.scss:412-426` or every route change paints a focus ring. |
| 11 | `utils/keyboard/keyboard.ts` | **PORT the three guards** | → §7. Audit `src/hooks/use-keyboard.ts` against all three. |
| 12 | `utils/platform.ts` heuristics | **PORT** | Diff against `src/utils/platform.test.ts`. → §8. |
| 13 | `input-shims/hacks/common.ts` (clone/relocate) | **STUDY** | → §9. May already be covered by `useFreezeViewport` — test before porting. |
| 14 | `input-blurring`, `focus-visible`, `listener.ts` | **SKIP** | Deprecated upstream, superseded by native `:focus-visible`, or a Zone.js escape hatch nativ has no use for. |

---

## 2. Hardware back button — the single most Capacitor-relevant file

`core/src/utils/hardware-back-button.ts`

**The design insight: there is no persistent registry.** Every press dispatches a fresh
`CustomEvent('ionBackButton', { detail: { register(priority, handler) } })` on `document`, collects
registrations synchronously, then runs a priority auction. That's what makes it correct under dynamic
overlay/menu state — the stack can't go stale because it's rebuilt each time.

```ts
handlers.forEach((handler) => {
  if (handler.priority >= selectedHandler.priority) { selectedHandler = handler; }
});
handlers = handlers.filter((h) => h.id !== selectedHandler.id);  // remove BEFORE executing
executeAction(selectedHandler).then(() => (busy = false));
```

`>=` means ties go to the later registrant (more recently mounted). The winner is removed *before*
execution so `next()` walks strictly downward and terminates.

**🔒 Adopt these constants verbatim** so third-party handlers written against Ionic conventions
interoperate:

| Priority | Registrant |
|---|---|
| `OVERLAY_BACK_BUTTON_PRIORITY = 100` | topmost presented overlay (only if `backdropDismiss`) |
| `MENU_BACK_BUTTON_PRIORITY = 99` | open menu — *"1 less than overlay priority since menu is displayed behind overlays"* |
| `0` | the router |

**Two non-obvious details worth keeping:**

- **The overlay handler deliberately does *not* return its dismiss promise** — *"otherwise the hardware
  back button utility will be blocked until the overlay dismisses… it will be impossible to use the
  hardware back button to dismiss the alert dialog"* presented inside a `canDismiss` callback.
- **`blockHardwareBackButton()` is two lines:** `document.addEventListener('backbutton', () => {})`.
  Registering *any* listener suppresses the webview's default navigation.

Errors are logged, never rethrown — one throwing handler can't brick back navigation for the session.

> This maps directly onto `COORDINATION.md`'s designed back-handler priority chain. **Build it from
> this file rather than from the design doc.**

---

## 3. Gestures

`core/src/utils/gesture/{index,gesture-controller,pointer-events,recognizers}.ts`

**Defaults:** `disableScroll: false`, `direction: 'x'`, `gesturePriority: 0`, `passive: true`,
`maxAngle: 40`, `threshold: 10`.

**The start-position reset is the highest-value trick in the file.** Ionic's own comment: *"If the pan
detector threshold is big, not resetting the start position will cause a jump in the animation equal
to the detector threshold."*

```ts
detail.startX = detail.currentX;
detail.startY = detail.currentY;
detail.startTime = detail.currentTime;
```

**Velocity is an EMA, 0.7/0.3, gated to `0 < timeDelta < 100`ms** — the gate discards stale samples
after a stall. `onMove` is rAF-coalesced, never synchronous.

**Arbitration is a single-winner auction, not a stack.** `capture()` scans all requested starts; only
max priority wins, and once `capturedId` is set every other gesture's `canStart()` returns `false`
until release. Priority is composite for deterministic ties: `priority * 1000000 + id` — so keep
logical priorities well under a million.

**🔒 Adopt the real v8 priority table** — it encodes working conflict resolution between
drawer / sheet / refresher / swipe-back:

| Priority | Gesture |
|---|---|
| 110 | `reorder` |
| **101** | `goback-swipe` — *"Swipe to go back should have priority over other horizontal swipe gestures. These gestures have a priority of 100 which is why 101 was chosen here."* |
| 100 | `item-swipe`, `segment`, `toggle`, `range`, `picker-swipe` |
| 40 | `modalSheet` |
| 39 | `modalSwipeToClose`, `toast-swipe-to-dismiss` (`OVERLAY_GESTURE_PRIORITY`) |
| 31 | `refresher` |
| 30 | `menu-swipe` |
| 0 | default |

**On capture it dispatches `ionGestureCaptured` on `document`** — that's how tap-click cancels a
pending ripple when a drag starts. **Port this signal; it's the decoupling seam** between the gesture
controller and every press-feedback consumer.

**Two `pointer-events.ts` fixes, each a class of "gestures randomly stop working":**

- **`MOUSE_WAIT = 2000`.** On `touchstart`, `lastTouchEvent = Date.now() + 2000`; mousedown returns
  early while that's in the future. The ghost-click suppressor.
- **`touchend`/`touchcancel` bind to `ev.target`, not the gesture element.** Ionic: *"In the event that
  the element this event was first dispatched on is removed from the DOM, the event will no longer
  bubble up to our reference element. This leaves the gesture in an unusable state."* Real bug: swipe
  an item that deletes itself → gesture never ends → **all gestures dead until reload.**

**`recognizers.ts`** detects direction via a **cosine against a 40° cone**, not axis comparison, with
the threshold compared squared to avoid a `sqrt` per move. Returns `0` for "past threshold but outside
the cone" → gesture aborts. That's what lets a vertical scroller and a horizontal swiper coexist.

> **⚠︎ Fix rather than copy:** Ionic has **two competing refcounts** on `body.backdrop-no-scroll` —
> one in `gesture-controller.ts`, one in `overlays.ts` — that don't know about each other. Unify them
> in nativ. And Ionic's lock is `overflow: hidden` on body, which only works because `ion-content` is
> the real scroller; see §10.

---

## 4. Transitions — the numbers that read as native

`ios.transition.ts`: `DURATION = 540`ms · `EASING = 'cubic-bezier(0.32,0.72,0,1)'` ·
`OFF_RIGHT = '99.5%'` · `OFF_LEFT = '-33%'` · `OFF_OPACITY = 0.8`.

The **3:1 parallax ratio** (entering `99.5% → 0%`, leaving `0% → -33%`) is the iOS signature. Edge
shadow: `.transition-cover` `0 → 0.1`, `.transition-shadow` `0.03 → 0.7`. Toolbar items fade
`0.01 → 1` — **never `0`**, which makes WebKit skip the layer.

`md.transition.ts`: forward **280ms** `cubic-bezier(0.36,0.66,0.04,1)` `translateY(40px) → 0`; back
**200ms** `cubic-bezier(0.47,0,0.745,0.715)`, entering page **not animated**. 58 lines total.

`transition/index.ts`: **z-index during transition** — entering `'99'` if going back else `'101'`,
leaving `'100'`. That single trick slots the entering page *under* the leaver on a back transition.
Pointer events are killed on both pages for the duration — *"resolves small issues like users double
tapping the ion-back-button."*

`swipe-back.ts`: **edge threshold 50px**, `threshold: 10`, priority 101. Completion is
`velocity >= 0 && (velocity > 0.2 || delta > width / 2)`. Duration `min(missing / |velocity|, 540)`,
skipped if `missing <= 5`px. **RTL is re-checked every gesture start, not cached** — *"the user's
locale can change mid-session."*

**The cancel curve is the reverse of the enter curve**, and this is where `cubic-bezier.ts` earns its
place (`router-outlet.tsx:82-123`):

```ts
let newStepValue = shouldComplete ? -0.001 : 0.001;   // "Account for rounding errors in JS"
if (!shouldComplete) {
  this.ani.easing('cubic-bezier(1, 0, 0.68, 0.28)');
  newStepValue += getTimeGivenProgression([0,0],[1,0],[0.68,0.28],[1,1], step)[0];
} else {
  newStepValue += getTimeGivenProgression([0,0],[0.32,0.72],[0,1],[1,1], step)[0];
}
```

**Animation progress semantics to port** (don't clone all 995 lines of `animation.ts`): the
**`0.9999` clamp** (hitting exactly `1` fires `onfinish` and tears down the animation mid-gesture),
`currentTime = delay + duration * step`, `updateTiming()` for mid-flight retiming, the one-time
callback array, and the before/after read/write batching that prevents layout thrash.

> **Note: the CSS-transition fallback is gone in v8.** `initializeAnimation()` has no `else` branch —
> WAAPI only. `supportsWebAnimations` survives purely as a test-environment guard. Don't port a
> fallback that isn't there. This corroborates `ANIMATION.md`'s WAAPI-based substrate decision.

---

## 5. Bottom sheet — the unlisted find that upgrades `Drawer`

`core/src/components/modal/gestures/{sheet,swipe-to-close,utils}.ts`

- `DISMISS_THRESHOLD = 0.5`. Completion: `(deltaY + velocity * 1000) / height` — **velocity projected
  one second forward**. Duration `clamp(400, remaining / |velocity * 1.1|, 500)`.
- `canDismissMaxStep`: **0.2** for card modals, **0.95** for sheets.
- `swipe-to-close.canStart` requires `scrollTop === 0` **and** no refresher present — *"We cannot solve
  this by making the swipeToClose gesture have a higher priority than the refresher gesture as the iOS
  native refresh gesture uses a scroll listener in addition to a gesture."*
- **The spring formula**, from a damped-oscillator ODE (stiffness `k = 0.57`, damping `c = 15`), with a
  100-line derivation comment above it — *"fairly close to native iOS's spring effect with the modal"*:

```ts
export const calculateSpringStep = (t: number) =>
  0.00255275 * 2.71828 ** (-14.9619 * t) - 1.00255 * 2.71828 ** (-0.0380968 * t) + 1;
```

- Footers switch to `position: absolute` during drag — *"to prevent it from shaking while the sheet is
  being dragged."*

> **The velocity-projection threshold and the spring constant are the difference between "feels
> native" and "feels like a web app."** Port both into `src/components/drawer/`.

---

## 6. Press feedback — why `:active` is insufficient, with numbers

`utils/tap-click/index.ts` — `ACTIVATED = 'ion-activated'`, `ADD_ACTIVATED_DEFERS = 100`ms,
`CLEAR_STATE_DEFERS = 150`ms.

- **The 100ms add-delay exists for scroll cancellation.** *"Tap click effects such as the ripple effect
  should not happen when scrolling… `pointercancel` is dispatched on a gesture when scrolling starts,
  so this lets us avoid having to listen for ion-content's scroll events."* With CSS `:active`, every
  touch that becomes a scroll flashes highlighted.
- **The 150ms removal-delay guarantees minimum perceived press.** A sub-100ms tap would otherwise show
  *no* feedback; `removeActivated` force-adds then removes smoothly. Pending clears are keyed in a
  `WeakMap` so re-pressing the same element cancels them.
- Listeners are **capture-phase**, plus a document listener for `ionGestureCaptured` (§3).

This is the same problem `src/hooks/use-gesture-engine.ts` + the `pressed:` variant already solve —
**diff the timings.** nativ's reentrant `data-pressed` (clears on drag-out, restores on re-entry) is
arguably better than Ionic's; the 100/150 pair and the `pointercancel` strategy are the parts to adopt.

`ripple-effect`: `PADDING = 10`, `INITIAL_ORIGIN_SCALE = 0.5`, peak opacity **0.16**, scale 225ms /
fade-in 75ms / fade-out 150ms, `cubic-bezier(.4, 0, .2, 1)`. Port the math and CSS, skip the component.

---

## 7. Keyboard — three guards nativ must be checked against

`utils/keyboard/keyboard.ts`. **`KEYBOARD_THRESHOLD = 150`px.**

```ts
const scaledHeightDifference =
  (previousVisualViewport.height - currentVisualViewport.height) * currentVisualViewport.scale;
return (
  !keyboardOpen &&
  previousVisualViewport.width === currentVisualViewport.width &&   // rotation guard
  scaledHeightDifference > KEYBOARD_THRESHOLD
);
```

1. **150px threshold** — below that it's URL-bar chrome, not a keyboard.
2. **Width-equality guard** — rotation changes width, so it can't be mistaken for a keyboard.
3. **Multiply by `scale`** — browser zoom otherwise breaks the math.

Heights are `Math.round`ed on copy; sub-pixel viewport values cause spurious resize churn.

**The reconciliation rule is either/or, never both**, and it independently confirms `NATIVE-SHELL.md`'s
decision: *"If the native keyboard plugin is available then we are running in a native environment… we
should only listen on the native events instead of using the Visual Viewport as the Ionic webview
manipulates how it resizes such that the Visual Viewport API is not reliable here."*

`keyboard-controller.ts` hands callers a **`resizePromise`** that resolves once the webview actually
resized, backed by a `ResizeObserver` rather than a `resize` event — *"In Capacitor there can be delay
between when the window resizes and when the container element resizes."* Any "hide the tab bar when
the keyboard opens" feature needs exactly this, or you animate before layout settles.

---

## 8. Platform detection

`utils/platform.ts`. The heuristics worth copying:

| Platform | Detection |
|---|---|
| `ipad` | `/iPad/i` **OR** (`/Macintosh/i` **AND** `isMobile`) ← iPadOS 13+ desktop-UA spoof |
| `android` | `/android\|sink/i` (`sink` = Chromecast/Fuchsia) |
| `phablet` | `min>390 && min<520 && max>620 && max<800` |
| `tablet` | `isIpad \|\| isAndroidTablet \|\| (min>460 && min<820 && max>780 && max<1400)` |
| `mobile` | **`matchMedia('(any-pointer:coarse)')`** — not a UA sniff |
| `hybrid` | `isCordova \|\| isCapacitorNative` |

`isMobile` being `(any-pointer:coarse)` is the one genuinely modern heuristic, and the iPad detection
depends on it. `isAndroidTablet = isAndroid && !/mobile/i` — phones put "Mobile" in the UA, tablets don't.

Results are stamped as `plt-*` classes on `<html>` so CSS can branch without JS — the same idea as
nativ's `data-nativ-platform` stamp, and a reason to consider adding `data-nativ-form-factor`.

---

## 9. iOS input shims — study, port selectively

`input-shims/hacks/common.ts` is the crown jewel. **The bug:** focusing an input makes WebKit scroll
the *webview itself*, destroying fixed headers, and it cannot be prevented. **The fix:** teleport the
real input off-screen before focus, leaving a visual clone.

```ts
const tx = isRTL ? 9999 : -9999;
inputEl.style.transform = `translate3d(${tx}px,${inputRelativeY}px,0) scale(0)`;
```

`disabled = true` on the clone is **Android-only** — *"prevents Chrome for Android from still scrolling
the entire page… This is not needed on iOS. While this does not cause functional issues on iOS, the
input still appears slightly dimmed even if we set opacity: 1."*

**`SCROLL_AMOUNT_PADDING = 50`** — *"gives us some room in case the keyboard shows password/autofill
bars asynchronously."* And the iOS password-bar double-keyboard wait is a genuine landmine: for
`type="password"` it waits for the **second** `ionKeyboardDidShow`, with a `1000ms` timeout fallback
that fires *"only in 2 instances: 1. The app is very slow. 2. The app is running in a browser on an old
OS that does not support Ionic Keyboard Events."*

`scroll-padding.ts` clears via a **120ms debounce** stashed on the element — without it, tabbing
between fields flickers the page. That's the right shape for `resolveAvoidanceSpace`.

`hide-caret.ts` is 35 lines: on scroll start relocate off-screen, on scroll end restore. **The bug:**
iOS paints the caret in the compositor, not the scrolling layer, so a focused input's caret stays
pinned mid-air over moving content. nativ's `use-caret-repaint` is the equivalent — **Ionic's is
broader** (covers user-initiated scrolling, not just programmatic).

> **VERDICT: STUDY.** nativ's `useFreezeViewport` may already pin the layout viewport enough that the
> clone/relocate dance is unnecessary. **Test before porting** — but if you see headers jumping on
> focus, this is the fix. Port the **numbers** (15 / 50 / 4 / 0.3 / 150–400ms) into
> `computeScrollIntoViewTop` regardless.

**Two things Ionic themselves are retiring — skip:** `input-blurring` (disabled by default since v8,
carries `// TODO FW-2796: find a better way, why 50ms?`, slated for removal) and the `focus-visible`
polyfill (native `:focus-visible` is baseline). **But keep one piece of the latter:** `:focus-visible`
does *not* paint a ring on programmatic `.focus()`, which a focus trap does constantly — so a ~15-line
`focusVisibleElement()` that force-applies `data-focus-visible` is still needed.

---

## 10. Corrections to the brief, and things to fix rather than copy

**Paths that don't exist** (don't hunt for them): `input-shims/hacks/cloneMap.ts` (the `WeakMap` lives
in `hacks/common.ts`) · `input-shims/hacks/copy-paste.ts` (**never existed** — 0 results across all
history) · `utils/tap-click.ts` (it's a directory) · `css/core.css` (only `core.scss` in source).

**Fix rather than copy:**

- **Overlay scroll lock.** Ionic's `body.backdrop-no-scroll { overflow: hidden }` only works because
  `ion-content` is the real scroller, not `body`. In a plain-DOM React framework that is **insufficient
  on iOS** — and per the separate scroll-lock research, `overflow: hidden` + `overscroll-behavior:
  contain` is the modern answer, with `position: fixed` + scrollY save/restore gated on `isSafari()`
  (Vaul's pattern). See `DECISIONS.md §5.0.2`.
- **The two competing refcounts** on `backdrop-no-scroll` (§3).
- **`helpers.ts` `pointerCoord`** uses `clientX` for touch but `pageX` for mouse — works only because
  Ionic's body is `position: fixed`. **A real bug if ported into a scrolling document.** Normalise to
  `clientX`/`clientY`.

**Also worth taking, briefly:** `transitionEndAsync` with `ANIMATION_FALLBACK_TIMEOUT = 500` (listens
to both `webkitTransitionEnd` and `transitionend`, filters bubbled child events via `el === ev.target`
— `transitionend` genuinely never fires if the element is removed mid-transition) · `status-tap.ts`'s
momentum-kill (`--overflow: hidden` around `scrollToTop`, because *"WebKit will jump the scroll
position back down and complete any in-progress momentum scrolling"*) ·
`refresher.utils.supportsRubberBandScrolling()`, which detects real Apple hardware via
`CSS.supports('background: -webkit-named-image(apple-pay-logo-black)')` to defeat Chrome's iOS
emulation spoof — relevant to `pull-to-refresh.tsx` · `typography.scss`'s 5-line iOS Dynamic Type
support (`font: var(--ion-dynamic-font, 16px var(--ion-font-family))` — the `font` **shorthand** is
required, `font-size` doesn't work).

---

## 11. Where this sits

- `ARCHITECTURE.md §0.6` — the doctrine this doc implements.
- `COORDINATION.md` — the back chain (§2) and gesture controller (§3) it designs; **build them from
  the source, not the design doc.**
- `ANIMATION.md` — §4's WAAPI-only finding corroborates the substrate decision.
- `NATIVE-SHELL.md` — §7's native-events-not-visualViewport rule is the same conclusion.
- `RESEARCH.md` — the issue index; this doc is the port list that replaces its §4 stub.
