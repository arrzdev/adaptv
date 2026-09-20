# Keyboard signal — how tall, and when

> Where the drawer's keyboard height comes from, per platform, and how a per-frame / predicted signal
> feeds the geometry PR #32 already ships without reverting it. This is the keyboard half of
> `@adaptv/shell` (`docs/roadmap/native-shell-plugin.md` roadmap #2). Web/PWA + Android<30 branch is **built** (PR #34);
> iOS REPLAY and Android FOLLOW are **designed here, to build against this contract.**

---

## 0. The one distinction the whole design rests on: *geometry* vs *signal*

Two separable problems get conflated whenever someone proposes "just `translateY` the sheet with the
keyboard":

- **Geometry** — *how the sheet accommodates the keyboard.* This is [drawer-engine](../src/components/drawer/drawer-engine.tsx)
  + [drawer-keyboard](../src/components/drawer/drawer-keyboard.ts), and **PR #32 already answers it**:
  the sheet grows into its `max-h`, holds the keyboard as **room** under the content, the scroller
  absorbs the overflow, and a composited **FLIP transform** carries the visible motion in one step.
  Unchanged by this work.
- **Signal** — *what the current keyboard offset is, and when we know it.* This is
  [capabilities/keyboard](../src/capabilities/keyboard.ts) + [use-keyboard](../src/hooks/use-keyboard.ts).
  This is the only thing the keyboard-signal work touches.

Keep them apart and the per-platform plan is simple: **every platform produces the same signal; the
drawer's one geometry consumes it.**

## 1. Why the signal feeds the geometry, and does not replace it

A tempting invariant — *"only ever write `transform: translateY()`; never height/top/padding"* — is
wrong for this component, for two concrete reasons, both already paid for once:

1. **Transform-only reverts PR #32 for the common case.** A form fills the sheet to its `max-height`
   cap. A pure `translateY(-keyboard)` then walks the sheet's **top edge off the top of the screen /
   under the notch**, and still can't reveal the footer/action buttons below the keyboard line — the
   only way to surface those is room + scroll, i.e. layout. #32's opening paragraph is this exact
   bug ("the footer stayed buried behind the keyboard"). Transform-only works for a *short* sheet
   (content < `viewport − keyboard`); the short sheet was never the hard case.
2. **Per-frame layout is ~25fps.** #32 measured transitioning `max-height`/`min-height`/`padding`
   every frame at 23–39fps. So a literal per-frame FOLLOW that rewrites layout each frame reintroduces
   the jank #32 removed.

**Resolution.** REPLAY is the default everywhere — it is what #32's *land-layout-in-one-step + FLIP
transform* already is. FOLLOW's live per-frame offset may ride a **compositor transform on top of an
already-committed one-step layout**, and only while the sheet is **not at its cap** (where a live
translate would clip the top). At the cap, ignore the live follow and keep room + scroll + FLIP.

## 2. Per-platform matrix

| Platform | Source of truth | Mode | Where the animation lives |
|---|---|---|---|
| **iOS** | `keyboardWillShow/Hide` `userInfo`: frame-end height, duration, curve (the private curve `7` is a spring: damping 500, stiffness 1000, mass 3, dur 0.5) | **REPLAY** | native spring on the arrival frame; JS gets the target, the engine's FLIP eases to it |
| **Android 30+** | `WindowInsetsAnimation.Callback.onProgress` → live IME inset per frame | **FOLLOW** | per-frame offset → compositor transform (see §1 cap rule) |
| **Android <30 / Web / PWA** | predict on `focus` from the height cache → confirm via `visualViewport` | **REPLAY** (predicted) | JS: seed the target on focus, the engine re-aims when the real height lands |
| **Desktop / Electron** | — | no-op | — |

Prediction on `focus` also helps iOS/Android: seed from the cache, let the native payload *confirm*
rather than *initiate*. It is additive to every row, not a fourth mode.

The **geometry** uses the same focus frame, independently of the height signal. Focusing a text
field can collapse an expanded picker (a wheel/date picker) in the same instant — content shrinks
before the keyboard's height is known. While no room is held the shrink cannot ride the room effect
(it early-returns at room 0), so on the focus frame the drawer pins a `min-height` **floor** at the
box's current height (`drawer-engine.tsx` `primeKeyboardFloor`, gated by `shouldPrimeKeyboardFloor`):
the picker collapses under the floor, the sheet's top holds, and the keyboard-room effect's
`heldFloor` path eases the floor to the final height once the height lands — one motion, no
shrink-then-grow dip. Like the signal-side prediction it is **reversible**: a focus that raises no
keyboard retracts the floor after a confirm window (`DRAWER_KEYBOARD_FLOOR_CONFIRM_MS`, mirroring §5).
On web the predictive seed already starts the grow on the focus frame, so the two coalesce; on native
(prediction off today) the floor alone is what removes the dip. See `docs/design/behaviors.md §4`.

## 3. The contract

One unified accessor, identical shape on every target — the JS layer above it never learns which
platform it is on (`docs/roadmap/native-shell-plugin.md §2`).

- [capabilities/keyboard.ts](../src/capabilities/keyboard.ts) emits
  `{ isOpen, height, unpaidHeight, resizesLayoutViewport }` and
  [use-keyboard.ts](../src/hooks/use-keyboard.ts) consumes it, publishing `--adaptv-keyboard-height`
  + `data-keyboard-open` on `<html>` for app chrome. `useKeyboard()` returns the same four fields.
- **`height` is the keyboard; `unpaidHeight` is what is left to lay out around.** `unpaidHeight` is
  `max(0, height - (rest - innerHeight))`: the part of the keyboard the layout viewport has not
  already given up. It equals `height` on web, PWA, the VirtualKeyboard API path, iOS native and the
  harness seam, where the layout viewport keeps its size. On Android native the WebView shrinks by
  the keyboard itself (§6), so it drops to 0 once that resize lands, and `resizesLayoutViewport` is
  `true`: the keyboard's top edge is then `innerHeight - unpaidHeight` in layout coordinates. Layout
  against `unpaidHeight` (AvoidKeyboard does); `height` stays the whole keyboard for consumers that
  subtract their own measured shrink (the drawer).
- **The rest is app-wide and per width.** `initNativeKeyboard` seeds `innerHeight` at boot, keyed by
  `innerWidth` like the height cache (§4). A resize becomes the rest only while the keyboard is closed
  and no field that raises it has focus (an `<input>` that types, a `<textarea>` or a
  contenteditable, looked for through open shadow roots), because the resize lands before the
  plugin's event as often as after it. Any other resize can only raise the rest. A width first
  reached with the keyboard up counts as paid in full.
- **A resize is never a report.** On Android native `subscribeNativeKeyboard` re-sends the last
  `{ isOpen, height }` unchanged, with a new `unpaidHeight`, on every window resize, so an unchanged
  report there is no sign of a new keyboard event. `useKeyboard` hears the two apart (the withheld
  `listenNativeKeyboard`): every OS report, a repeat of the last included, reaches its prediction
  and height cache, and a resize only re-reads the payment.
- **Known limits of `unpaidHeight` on Android native** (each measured in a unit probe, none on a
  device). Window growth while the keyboard is up reads as the keyboard shrinking and leaves that
  growth as a band until the keyboard closes: 24px for a system bar hiding, 223px for a split-screen
  divider. A field focused inside a closed shadow root or an iframe is invisible to the focus check,
  so a resize that lands before the plugin's event passes for the rest and leaves a band.
  Under-reservation is brief: a window that shrank under a focused field for another reason (a
  split screen with a hardware keyboard), or a rotation to a new width with the keyboard up, counts
  as paid until the keyboard's own resize lands, so the field can sit covered for those frames; on a
  WebView that never shrinks for the keyboard (not adaptv's configuration) a new width stays
  covered. A shorter keyboard (a suggestion strip hiding) is held for `useKeyboard`'s 350ms shrink
  hold while the viewport has already grown, so a band that tall shows for that beat.
- **`height` and its CSS var still carry the whole keyboard.** `--adaptv-keyboard-height` (on `<html>`
  and on the AvoidKeyboard wrapper) and `useKeyboardAvoidance().keyboardHeight` publish `height`, so on Android
  native a stylesheet that lays out against `100vh - var(--adaptv-keyboard-height)` counts the
  keyboard twice (`docs/decisions/styling.md` §4). Redefining them to the unpaid part is the
  follow-up to #83.
- **Native today** reports a single discrete height on will-show. The plugin work upgrades *this
  source* to continuous (Android `onProgress`) + curve-bearing (iOS `userInfo`) — the consumer shape
  does not change. If FOLLOW ever needs it, extend the event with a `phase`/`velocity` field; the
  drawer must keep consuming "current offset", never raw frames.
- **Prediction** (PR #34) adds *seed-then-correct* to the web path: the height is known on the focus
  frame and the real measurement corrects it through the existing grow/shrink paths.

## 4. The height cache (built — PR #34)

[keyboard-height-cache.ts](../src/capabilities/keyboard-height-cache.ts). A form is the same shape
every time it opens on a device, so last time's height predicts this time's.

- **Key** `{ viewportWidth, numeric|text }`. Width identifies the device implicitly and moves on
  rotation, so it encodes orientation for free — no separate orientation term. `inputmode`/`type`
  split the digit pad from the full keyboard; finer splitting just fragments the cache.
- **Durable**: Preferences on native (survives WebView eviction), localStorage on web; hydrated once
  at boot before any drawer opens; synchronous in-memory lookup on focus.
- **Self-healing**: every confirmed, stable height is recorded, so a keyboard-app / language / IME
  switch is absorbed on the next measurement.
- **Rejected**: a shipped device→height table — wrong too often (third-party keyboards, suggestion
  bar, CJK IMEs, split/floating iPad keyboards) and needs updating forever.

## 5. Prediction must be reversible

`focus` is a **trigger, not a guarantee**: a hardware keyboard, a programmatic focus, or a readonly
field focuses without raising a keyboard. So prediction is speculative and **retracts** if no
keyboard confirms within a window (`use-keyboard`'s `KEYBOARD_PREDICT_CONFIRM_MS`), and is gated off
`readOnly`/`disabled`. Native can additionally *detect* a hardware keyboard (iOS `GCKeyboard`,
Android `hasHardwareKeyboard`) and skip prediction outright rather than relying on the retract.

## 6. Invariants (from `docs/roadmap/native-shell-plugin.md`, do not relitigate)

- **`resize: none`** — set in [capabilities/keyboard.ts](../src/capabilities/keyboard.ts) on iOS, so
  the OS does not push the WebView there and adaptv lifts content itself. **Measured, Android does
  not hold to it:** that plugin has no resize mode, and Capacitor 8's `SystemBars` still pads the
  WebView by the IME inset, so the layout viewport shrinks by the keyboard (PR #83, Pixel 10
  emulator: `innerHeight` 923 → 587 under a 336px keyboard, `virtualKeyboard.overlaysContent` true
  throughout). The accessor answers that shrink as `unpaidHeight` (§3); nothing above it branches on
  the platform.
- **Never build on `visualViewport` on native** — Capacitor resizes shrink the WebView, making the
  keyboard invisible to it. Web/PWA only.
- **Report continuously, not on discrete show/hide** — changing `type`→`tel` or opening emoji resizes
  the IME while firing no events.
- **Layer on `SystemBars`, do not replace it** — Capacitor 8 ships an unavoidable `SystemBars` core
  plugin that already installs `setOnApplyWindowInsetsListener`; a second listener on the same view is
  literally bugs capacitor-keyboard #61/#68.
- **Never assume `keyboardWillHide` precedes `keyboardDidHide`** — iOS 26 inverts the order on a
  no-animation hide.
- **Don't freeze the plugin API against Capacitor 8's inset shape** — Cap 9 (alpha only today; `next`
  = `9.0.0-alpha.6`, no stable release) changes the inset contract. We ship on stable 8, upgrade when
  9 lands.

## 7. Open questions (need a device / emulator, which we have — see §8)

1. **Android FOLLOW vs `SystemBars`.** Does `WindowInsetsAnimation.Callback` co-exist with
   `SystemBars`' `setOnApplyWindowInsetsListener`, or collide? Verify on **API 34 and API 35**
   emulators (the breakage line).
2. **Retarget vs. 1–2 frames late** on a wrong prediction. A velocity-preserving retarget should beat
   being reactive-late on every raise, but the settle must not read as a snap-back — needs a real
   mid-range Android device.
3. **iOS FOLLOW (display-link) vs REPLAY.** Recommendation: **REPLAY** — iOS hands you the exact curve
   in `userInfo`; a per-frame bridge stream only adds jitter to reproduce a curve you already have.
   FOLLOW earns its place on Android, where the gesture keyboard has no predetermined curve.

## 8. How to verify (in THIS repo — no external harness)

From any worktree root (`docs/DEVELOPMENT.md` is authoritative):

```bash
pnpm dev:web        # PWA path: real visualViewport + the predictive cache, in a browser
pnpm dev:ios        # the app on the iOS Simulator — real OS keyboard, native height path
pnpm dev:android    # the app on the Android emulator — real IME, WindowInsets path
```

- `dev`/`preview` are turbo **interactive TTY** tasks (need a real terminal); `r` reloads JS, `b`
  rebuilds the native app. After a framework-only edit use `--force` — the build fingerprint ignores
  linked adaptv `src` and will otherwise install the previous bundle.
- **Deterministic conformance** without a real keyboard: `/lab/drawer-keyboard` drives the
  `__adaptvKeyboardMock` seam and self-reports (`docs/guides/autonomous-ui-testing.md`, `docs/design/behaviors.md §4`).
- **Unit**: `use-keyboard.test.ts` (observer + predictive path) and `keyboard-height-cache.test.ts`.
- On Android, inspect the WebView over CDP to read the real inset numbers and catch swallowed bridge
  rejections.

## 9. Status

- **Built (PR #34):** height cache + the predictive Web / Android<30 branch (seed-on-focus, confirm/
  retarget via the engine's re-aim, retract, learn).
- **Designed here:** iOS REPLAY (curve from `userInfo`) and Android 30+ FOLLOW (`onProgress`), both
  feeding §3's contract; §7 is what to resolve on-device first.

Cross-refs: `docs/roadmap/native-shell-plugin.md` (the plugin this is part of) · `docs/design/behaviors.md` / `docs/guides/autonomous-ui-testing.md`
(the drawer×keyboard contract + how to test it) · `DEVELOPMENT.md` (how to run native + web).
