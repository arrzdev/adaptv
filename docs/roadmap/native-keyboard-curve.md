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
