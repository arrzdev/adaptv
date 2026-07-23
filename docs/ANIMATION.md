# adaptv — the animation & transition substrate

> What adaptv animates with, and why it does **not** build an animation engine. Covers the four
> candidate substrates (CSS, WAAPI, `motion`, View Transitions), what actually runs off the main
> thread, and the specific traps that look like good ideas.
>
> Closes `DECISIONS.md` **O10**. Decided **2026-07-20** against BCD, webstatus.dev, Chromium source,
> and the `motion` repo at 12.42.2.

---

## 0. The decisions

| # | Decision |
|---|---|
| A1 | **`motion` stays the animation substrate.** adaptv does not build an engine. Already a peer dep. |
| A2 | **CSS is the default for enter/exit**; `motion` is for gesture-driven, interruptible, and layout animation. |
| A3 | **The accelerated property set is `transform` / `opacity` / `filter` / `backdrop-filter`.** Everything else is main-thread; treat acceleration as progressive enhancement, never as a guarantee. |
| A4 | **`composite: "add"` is forbidden** in adaptv primitives — it silently disables the Chromium compositor. |
| A5 | **Overlays are ordinary positioned elements, not the top layer.** `overlay` is Chromium-only and unrequested in WebKit — `<dialog>`/popover exits break on iOS permanently. |
| A6 | **View Transitions are opt-in polish, never the mechanism** for gesture-driven navigation. |
| A7 | **Ship `LazyMotion` + `m`**, not the full `motion/react` barrel. |

---

## 1. What actually runs off the main thread

From Chromium's `compositor_animations.cc` — the definitive list, not the folklore:

```cpp
constexpr auto kCompositableProperties = std::to_array<CSSPropertyID>(
    {CSSPropertyID::kBackdropFilter, CSSPropertyID::kFilter,
     CSSPropertyID::kOpacity, CSSPropertyID::kRotate, CSSPropertyID::kScale,
     CSSPropertyID::kTransform, CSSPropertyID::kTranslate,
     // native paint worklet properties — gated on a paint image generator
     CSSPropertyID::kBackgroundColor, CSSPropertyID::kClipPath});
```

**`background-color` and `clip-path` are only accelerated behind runtime paint-worklet flags**
(`CompositeBGColorAnimationEnabled`, `CompositeClipPathAnimationEnabled`). Do not count on them.

**WAAPI, CSS animations, and CSS transitions all funnel through the same
`CheckCanStartAnimationOnCompositor` path in Blink.** WAAPI gets no acceleration advantage over CSS,
and no penalty. *The substrate choice is orthogonal to acceleration* — which is the single most
useful fact here, because it means adaptv can pick a substrate on ergonomics alone.

**Things that silently drop you to the main thread** (each is a named failure reason in Blink):
a non-`replace` composite mode · animating a property set `!important` · blur-type filters near
edges (`kFilterRelatedPropertyMayMovePixels`) · mixed keyframe value types · a transform on an
inline box · `CSSPropertyID`s outside the list above.

> **Rule for every adaptv primitive: animate `transform` and `opacity`.** If a design needs
> `height`/`width`/`background-color` animated, that is a design change, not an optimisation task.

### 1.1 🔒 The iOS 60Hz ceiling — the real reason this rule is non-negotiable

The compositor argument above is the *ordinary* one. On iOS there is a harder one, and it changes this
from an optimisation to a correctness constraint.

**[WebKit 173434](https://bugs.webkit.org/show_bug.cgi?id=173434) — filed 2017, still NEW/P2.** Safari
gained 120Hz `requestAnimationFrame` in iOS 18, but only behind a manually-toggled experimental flag,
and [Apple's own forums](https://developer.apple.com/forums/thread/773222) confirm *"these Safari flags
do not apply to WKWebView."* Radar FB16411517 (Jan 2025) is unanswered. Measured on iPhone 17 Pro Max /
iOS 26:

| Path | Rate | Unlockable? |
|---|---|---|
| `requestAnimationFrame` JS | **60Hz** | **No** |
| Canvas / WebGL rAF | **60Hz** | **No** |
| CSS main-thread properties | 60Hz | No |
| **CSS composited (`transform`/`opacity`)** | **120Hz** | **Yes** |

**So anything that follows a finger through JavaScript runs at half the frame rate of the native app
beside it, on every ProMotion iPhone — and there is no fix.** Escaping it needs private APIs
(`WKPreferences._setEnabled:forFeature:`) plus 10–15% battery.

This is the strongest possible argument for §3's rule about `motion`: **the compositor path isn't a
performance nicety, it's the only way to reach 120Hz on iOS at all.** Every gesture-driven surface —
`Button` press, `Swipeable`, `Drawer` drag, edge-swipe — must be composited by construction, and
`onUpdate`/`MotionValue` subscribers (which force the main thread) must be treated as a deliberate,
justified exception rather than a default.

**Two related corrections worth not rediscovering:** `-webkit-overflow-scrolling: touch` has been a
**no-op since iOS 13** — WebKit made accelerated one-finger scrolling the default for all frames, so
momentum and rubber-band are already native. And the 300ms tap delay is dead, killed by
`width=device-width` + `touch-action: manipulation` (though see `DECISIONS.md` **B13** — use the
longhand, not `manipulation`, on gesture surfaces).

---

## 2. Why WAAPI alone is not enough

WAAPI is the best *imperative control* surface on the platform (`play`/`pause`/`reverse`/`cancel`,
`currentTime` scrubbing, `updatePlaybackRate()`, `ready`/`finished` promises, `getAnimations()`), and
it's Baseline Widely Available since 2023-03-16. But four gaps make it unusable as adaptv's only layer:

1. **No velocity readback.** There is no `animation.currentValue`. `getComputedStyle()` gives you a
   position, but velocity needs two samples across frames — and reading computed style on a
   compositor-driven animation forces a style flush. **This is why no library can be a thin WAAPI
   wrapper and still do interruptible springs.**
2. **No springs.** The only route is numerically pre-generating the curve into a `linear()` easing —
   which pins a **fixed duration and fixed start/end values**, so any interruption invalidates it.
   Note `linear()` only crossed into **Baseline Widely Available on 2026-06-11**, five weeks ago.
3. **No retargeting.** CSS *transitions* retarget from the current computed value for free; WAAPI
   requires `cancel()` + a new animation, which snaps.
4. **No `auto`.** WAAPI needs resolved values on both ends. `interpolate-size`/`calc-size()` would fix
   this but is **Chrome 129+ only, Baseline limited** — and per the earlier CSS research, WebKit bug
   [295132](https://bugs.webkit.org/show_bug.cgi?id=295132) is NEW/unassigned. Use
   `grid-template-rows: 0fr → 1fr` or measured pixel heights instead.

### 2.1 🔒 `composite: "add"` is a trap — do not use it

It is Baseline Widely Available and looks like the ideal primitive for interruption blending
(additive animations compose naturally). But Chromium's `compositor_animations.h` says:

```cpp
// Currently the compositor does not support any composite mode other than 'replace'.
kEffectHasNonReplaceCompositeMode = 1 << 4,
```

**Using any composite mode other than `replace` silently disables compositor acceleration.** You get
free blending and lose the GPU. On low-end Android — the exact device class adaptv's `gpuBoost`
sentinel exists for — that is the wrong trade.

`iterationComposite` is worse: **Chrome has never shipped it** ([crbug 41133485](https://crbug.com/41133485)),
Baseline limited, zero developer signal. Treat as nonexistent.

---

## 3. 🔒 Keep `motion` — and understand its hybrid engine

adaptv already peer-depends on `motion` (12.35.0; current is **12.42.2**, 2026-06-30 — `framer-motion`
ships in lockstep at the identical version and `motion` is a re-export shell over it).

The marketing line is "hybrid engine." The real decision function is
`supportsBrowserAnimation()` in `motion-dom/src/animation/waapi/supports/waapi.ts` — an animation
goes to WAAPI **only if all** of these hold:

- target is an `HTMLElement` (SVG → JS; elements in a different timing context, e.g. popups →
  deliberately JS, so they can't desync from the main frameloop)
- the property is in `acceleratedValues` = `opacity` · `clipPath` · `filter` · `transform`
  (`background-color` is present but **commented out**, pending a Chromium bug)
- **no `onUpdate` callback** — WAAPI can't be read per-frame
- no `repeatDelay`, `repeatType !== "mirror"`, `damping !== 0`, `type !== "inertia"`
- `transform` without a `transformTemplate`

Everything else — layout animations, drag, `MotionValue` chains with subscribers, SVG, path drawing,
CSS variables, inertia — runs in JS on motion's own rAF frameloop.

**The piece worth knowing about, because you'd otherwise have to build it:** motion solves the
velocity-readback gap (§2.1) by running a *renderless shadow `JSAnimation`* with `autoplay: false`,
sampling it twice (at `sampleTime` and `sampleTime - 10ms`), and feeding both into
`motionValue.setWithVelocity()`. It uses wall-clock time rather than `animation.currentTime` because
*"under CPU load, WAAPI's currentTime may not reflect actual elapsed time, causing incorrect sampling
and visual jumps."* That is roughly the whole argument for renting rather than building.

**Two consequences that become adaptv rules:**

- **Any per-frame JS observation forces the main thread.** `onUpdate` and `MotionValue` subscribers
  are exactly the reactivity that costs you acceleration. This tension is fundamental, not a motion
  quirk — so adaptv primitives should prefer `data-*` + CSS over `onUpdate` where the value is only
  needed for styling.
- **`acceleratedValues` means "hand off to WAAPI", not "guaranteed compositor."** `clipPath` is on
  motion's list but is paint-worklet-gated in Chromium (§1).

### 3.1 🔒 Bundle: `LazyMotion` + `m`, not the full barrel

| Path | min+gzip |
|---|---|
| `motion/react` (full) | ~50kb |
| `m` + `LazyMotion` initial render | **~4.6kb** |
| `+ domAnimation` (variants, exit, gestures) | +15kb |
| `+ domMax` (adds drag/pan + layout) | +25kb |
| `animate()` mini (`motion/mini`) | 2.3kb |

The `m`/`LazyMotion` path is alive in v12 (`motion/react-m` is a live export). For a framework that
ships to a WebView on low-end Android, the ~45kb difference is worth the ergonomic cost.

---

## 4. 🔒 CSS for enter/exit — with a hard iOS limit

`@starting-style` + `transition-behavior: allow-discrete` genuinely replace a JS presence library for
elements that **stay mounted** and toggle `display`. Support floor:

| Capability | Chrome | Safari / iOS | Firefox |
|---|---|---|---|
| `transition-behavior` (property) | 117 | **17.4** | 129 |
| `@starting-style` | 117 | **17.5** | 129 |
| **actually transitioning `display`** | 117 | **18.0** | ❌ **never** |
| **`overlay`** | 117 | ❌ **never** | ❌ (bug 1841456 REOPENED) |

Two hard facts:

- **Firefox parses `transition-behavior` but cannot transition `display` at all**
  ([bug 1882408](https://bugzilla.mozilla.org/show_bug.cgi?id=1882408), NEW, unassigned). "Firefox 129
  supports `transition-behavior`" is true and useless — your exit animation is simply invisible there.
- **`overlay` is Chromium-only with no tracked WebKit bug** — absent from Safari 26.5, Safari 27 beta,
  and STP 247. Without it, a closing `<dialog>`/popover is **yanked out of the top layer mid-animation**,
  losing z-order and `::backdrop`.

### 4.1 🔒 Therefore: overlays are ordinary positioned elements

adaptv's `Drawer`/`Sheet`/`Modal` do **not** use `<dialog>` or the Popover API's top layer. They are
ordinary positioned elements with adaptv-owned z-index and a JS presence hook. This:

- sidesteps the permanent iOS `overlay` gap,
- sidesteps `dialog[closedby]` being Safari-absent (STP only),
- and keeps interruptible, gesture-driven dismissal possible — which the top layer does not help with
  anyway.

The cost is re-implementing focus trapping and inert-ing, which `<dialog>` gives free. Accepted: adaptv
already owns a back-handler priority chain (`COORDINATION.md`) that a native `<dialog>` would fight.

**What adaptv ships instead of a presence library:** a thin hook that defers unmount by one frame plus
`transitionend`/`animationend`, letting CSS own the interpolation via `@starting-style` +
`allow-discrete`. React removes nodes synchronously during commit — there is no CSS hook for removal,
and a CSSWG search confirms **none is even proposed** (the live issues, #12351/#11263/#10356, are all
refinements of *entry*).

Use `transition: all Xs allow-discrete` — MDN endorses it, and unknown properties are ignored, so it
degrades cleanly on Safari without a separate stylesheet branch.

---

## 5. 🔒 View Transitions — polish, not mechanism

Baseline **newly available 2025-10-14** (Chrome 111 · Safari 18 · Firefox 144). Cross-document is
Chromium-only; element-scoped is Chrome 147+ (~3 months old).

**Why it cannot be adaptv's route-transition mechanism:**

- It **does not support interruptible or gesture-driven animation** — the whole point of a native-feel
  swipe-back.
- It **freezes interaction** for the transition duration.
- React's `<ViewTransition>` is **still Canary/Experimental** — it did not ship stable in 19.2.

**Where it *is* right:** non-gesture transitions where the old DOM is gone — because the browser
snapshots before the mutation, VT handles removal that `@starting-style` structurally cannot.

`motion` now wraps it: **`animateView()` moved from Motion+ early access into the main library in
v12.41.0 (2026-06-23)** — adds spring easing, interruption queuing, simplified shared-element matching,
and degrades gracefully where VT is unsupported. **It is one month old and still settling** (12.42.0/.1/.2
are almost entirely `animateView` fixes). Treat as opt-in, revisit in a quarter.

### 5.1 Swipe-back is hand-built regardless

The Navigation API is now Baseline (**Safari 26.2**, 2025-12-12; **Firefox 147**, 2026-01-13) and
`navigate` fires for back/forward with `navigationType === "traverse"`. But:

- **There is no gesture-progress surface.** The `navigate` event is a discrete commit signal — no
  scrub position, no abort-and-rewind. Interruptible rubber-banding is not expressible.
- Cancelability of traversals is deliberately restricted; `hasUAVisualTransition` exists precisely so
  you *skip* your animation when the UA runs its own.
- **`WKWebView.allowsBackForwardNavigationGestures` defaults to `false` and Capacitor never sets it**
  (0 hits across `ionic-team/capacitor`). So there is no system swipe-back in a stock Capacitor iOS
  app at all — no competing UA animation, and nothing to intercept.

> **So: adaptv's edge-swipe is Pointer Events + transform, driven by touch delta, committing via the
> router at gesture end.** Which is what `edge-swipe-gestures.tsx` already does. The Navigation API
> changes nothing here — and with memory history (installed/native), there are no WKWebView history
> entries for a gesture to traverse anyway.

---

## 6. Acceptance

- [ ] No adaptv primitive animates a property outside `transform`/`opacity`/`filter`/`backdrop-filter`.
- [ ] No `composite: "add"` / `iterationComposite` anywhere.
- [ ] `Drawer`/`Sheet`/`Modal` use no `<dialog>`, no Popover top layer, no `overlay`.
- [ ] Exit animations verified on **iOS 18** (the `display`-transition floor) and in Firefox (where
      they must degrade to an instant hide, not a broken state).
- [ ] `LazyMotion` + `m` in the shipped bundle; the full `motion/react` barrel is not imported.
- [ ] Edge-swipe remains pointer-driven; no dependency on the Navigation API or View Transitions.

---

## 7. Where this sits

- `COORDINATION.md` — the gesture controller this substrate serves; the back chain that argues
  against native `<dialog>`.
- `STYLING.md` — `@layer`, and the `data-*` state contract that lets CSS own interpolation.
- `BEHAVIORS.md` — per-primitive animation behaviours.
- `DECISIONS.md` — **O10 closed** by this doc.
