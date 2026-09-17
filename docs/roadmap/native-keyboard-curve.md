# adaptv — drive the sheet with the OS keyboard's own curve

> 📐 **Agreed, unbuilt.** Follow-up owed after the drawer/keyboard work landed. **Size: small to
> medium. Risk: low** — it is additive, and the existing behaviour is the fallback.

---

## The gap

`src/capabilities/keyboard.ts` reports the native keyboard as:

```ts
export type KeyboardInfo = {
  isOpen: boolean
  height: number
}
```

**Height only.** The OS tells us more than that and we throw it away. On both platforms the
will-show event carries an animation **duration** and an **easing curve**, and the keyboard is
already moving on that curve when the event fires. adaptv currently lifts the sheet on its own
timing, so the sheet and the keyboard travel together only by coincidence — they start at the same
moment and arrive at slightly different ones.

The agreed fix: **carry the OS duration and curve through the accessor, and tween the sheet on
them** rather than on adaptv's own constants.

## Baseline, measured 2026-09-02

iPhone 17 Pro simulator (iOS 26.1, software keyboard, 402×874pt), the playground's create-task
drawer, `xcrun simctl io recordVideo` at passthrough frame rate, one pixel column in the sheet's
right margin read per frame: the sheet's top edge and the keyboard's top edge, in points, from the
frame the keyboard first appears.

```
   t(ms)  sheetTop  kbTop    dSheet   dKb
    0.0    269.0    867.0
   15.0    269.0    838.3     0.0   -28.7
   36.7    219.3    782.0   -49.7   -56.3
   51.7    186.3    734.7   -33.0   -47.3
   70.0    149.7    692.0   -36.7   -42.7
   90.0    120.7    655.0   -29.0   -37.0
  101.7    106.7    630.7    -6.0   -12.0
  118.3     96.7    607.3   -10.0   -23.3
  135.0     89.7    588.7    -7.0   -18.7
  151.7     84.3    575.3    -5.3   -13.3
  185.0     77.7    557.3    -3.0    -8.0
  235.0     72.0    545.0    -1.3    -2.7
  285.0     69.7    540.0    -0.7    -1.0
  338.3     67.0    538.0    -1.3    -0.7
  353.3     67.0    537.7     0.0    -0.3
  405.0     67.0    537.3     0.0     0.0
```

What it says: the keyboard travels 330pt in about 355ms; the sheet travels 202pt and starts one
frame after the keyboard's first move (about 22ms), then arrives about 15ms before it. Both
decelerate, but on different curves — the sheet covers 64% of its travel in the first 70ms
where the keyboard covers 53% — and the sheet's tail is the drawer's own settle, not the
keyboard's. That is the coincidence this item replaces with the OS's own duration and curve.
The keyboard's height on this device is 345pt; the sheet's `room` after the raise is that whole
height (iOS gives none of it up in the layout viewport, see `design/behaviors.md §4`).

## Why it is its own change

This is deliberately *not* folded into the drawer work, for two reasons that are both recorded
scar tissue:

1. **The settle is authored in CSS, and the authoring site is load-bearing.** A `@keyframes` rule
   animates cleanly; an inline `transition` or an `element.animate()` call settles with a visible
   tremor on WebKit. The shipped engine tweens through the `pwa-drawer-slide` keyframe for exactly
   this reason. Feeding a *runtime* duration and curve into a *build-time* keyframe is the whole
   design problem here, and it is not obvious. → [`../research/composited-transform-authoring.md`](../research/composited-transform-authoring.md)
2. **Do not retune the existing curve while doing it.** The drawer's easing is settled over four
   device ladders. A change that "improves" it in passing will read as a regression to the owner
   and will be bisected to this PR.

## The known platform obstacle

**iOS's keyboard easing curve token is private.** `UIKeyboardAnimationCurveUserInfoKey` reports a
`UIView.AnimationCurve` raw value that is *outside* the four public cases — the keyboard uses a
curve Apple does not expose. It cannot be mapped to a public CSS easing exactly; the usual
approximation is a cubic-bezier fitted to the observed motion. Decide up front whether to:

- ship the fitted approximation and document it as an approximation, or
- pass the raw duration through and keep adaptv's own curve, which fixes the *arrival time* mismatch
  without pretending to match the shape.

The second is cheaper and closes most of the visible gap. It is probably the right first step.

## Scope

- Widen `KeyboardInfo` with `duration` and an easing descriptor. This is a **public type change** —
  additive, so no consumer breaks, but it is surface.
- Plumb it from the native listener in `initNativeKeyboard`.
- Consume it in the drawer's keyboard path without disturbing the authored keyframe.
- **Web has no equivalent.** `visualViewport` reports geometry with no timing at all, so the web path
  keeps adaptv's constants and the two paths diverge here on purpose.

## Verification

Cannot be closed by a unit test — it is a motion-alignment question. Measure it the way the drawer
work was measured: a screen recording at `-fps_mode passthrough`, both surfaces in **one** camera,
comparing px-per-frame of the sheet against the keyboard edge. A sim **hardware keyboard hides this
entirely** (no software keyboard, no motion), so `Connect Hardware Keyboard` must be off.
→ [`owed-device-verification.md`](owed-device-verification.md)
