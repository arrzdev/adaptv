# Developing layout-reactive components autonomously

How to build and verify a component whose geometry reacts to things you cannot script — the
on-screen keyboard, content that grows and shrinks, a viewport that changes shape — without a human
looking at it. Written after taking adaptv's `Drawer` from "green sixteen times while visibly
janky" to a measured 60fps, and the mistakes below are all ones that run cost real iterations.

Pairs with [`TESTING.md`](TESTING.md) (the six-target discipline) and
[`BEHAVIORS.md`](BEHAVIORS.md) (what each component guarantees).

---

## 1. The target is a number, not an impression

**~60fps for the whole animation, with zero dropped frames.** That is what "feels native" reduces
to, and unlike "smooth" it can be asserted. A UIKit sheet does not drop frames; neither may ours.

Concretely, per transition:

| metric | how | bar |
|---|---|---|
| frame rate | count `requestAnimationFrame` callbacks over the animating window | ≥55fps |
| dropped frames | intervals > 25ms (missed a vsync) | 0–1 |
| worst frame | max interval | ≤35ms |

## 2. Geometry assertions are blind to time

This is the trap, and it is expensive. A suite can assert that a sheet ends in the right place,
never overshoots, never reverses, eases rather than snaps — and every one of those passes
identically at 60fps and at 24fps. Sixteen consecutive green runs of exactly such a suite sat on
top of a drawer that reflowed the entire sheet on every frame.

**Sample on `requestAnimationFrame` and record the intervals.** The gaps between callbacks *are*
the frame rate. A `setInterval` sampler measures wall-clock and cannot see a dropped frame at all.

The first run with frame telemetry indicted every keyboard motion in one screenshot, after weeks of
geometry assertions had said the component was fine.

## 3. Never animate layout properties

The single highest-leverage rule. Transitioning `height`, `max-height`, `min-height`, `padding`,
`top` or `width` puts a reflow of the whole subtree on the main thread for every frame of the
animation. Measured cost on the drawer: **23–39fps with 7–11 dropped frames and 66ms stalls**.

Use **FLIP** instead:

1. measure the element,
2. apply the final layout in **one** step, no transition,
3. measure again; the difference becomes a `transform` that starts it where it visually was,
4. animate that transform to zero.

One reflow instead of sixty, and the tween runs on the compositor. Same result on the same curve,
at 60fps. When a change is genuinely internal (a scroller shrinking under a stationary top edge)
and no single translate expresses it, FLIP the pieces separately rather than falling back to
animating layout.

**Whoever owns the transform during a gesture owns it exclusively.** A FLIP that fires mid-drag
re-applies `transition: transform` and every finger position gets smoothed over the animation
duration — the element appears frozen under the finger. Skip FLIP while dragging.

## 4. Build a harness the component can run itself

The thing under test is usually the thing you cannot trigger. No simulator raises a software
keyboard for a scripted run, and no web API lets a page synthesise `visualViewport` geometry.

**Add a narrow test seam.** adaptv's is `window.__adaptvKeyboardMock` plus an
`adaptv:keyboard-mock` event; while set, `useKeyboard` reports the mock and nothing else. Opt-in by
construction — nothing sets that global by accident.

**Then simulate the real thing, including its motion.** Paint a solid block of the keyboard's
height over the bottom of the screen: from the sheet's point of view that *is* the keyboard, and it
has to be avoided identically. Make it **slide** (~250ms) rather than appear — an instant block
only ever tests endpoints, and hides whether the component *tracks* the moving edge or merely
agrees with it once both have stopped.

Harness rules that were each learned by getting them wrong:

- **Self-run.** Trigger on open, not on a button: once a modal is up, the page behind it is
  unreachable and every tap dismisses it.
- **Portal the report** to `<body>`. A z-index only competes inside its own stacking context, so a
  report nested in the page loses to a portalled overlay however high the number — and a truncated
  list reads as a full pass.
- **Sizes as a fraction of the viewport, never px.** A fixed `320` is ~40% of a phone held upright
  and ~90% of it on its side.
- **One screenshot must be the whole report** — that is what makes it work identically on a
  simulator, an emulator and a browser.
- **Expose results on `window`** too, so browser automation can read JSON instead of pixels.
- **An `?only=<scenario>` switch**, so a recording of one motion is seconds long.

## 5. What to assert

Per transition, beyond the frame metrics:

- never crosses the safe boundary (a notch, a cap)
- ends flush against the obstacle it was avoiding
- neither edge reverses (waive only where a step deliberately changes its mind mid-flight)
- tracks the obstacle's *painted* edge throughout, not just at rest
- content keeps its place — measured **mid-scroll**, because at a scroll extreme content genuinely
  must slide to fill space, exactly as `UIScrollView` does

Scenarios must include the interruptions, not just the clean cases: re-aim mid-flight, reverse
mid-flight, the obstacle larger than the element's reserve, content changing *while* the obstacle
moves, and a gesture in progress across all of it. Every real bug in the drawer lived in one of
those, never in a motion that started from rest.

## 6. Ground truth is the painted frame

When a metric and your eyes disagree, the metric is on trial.

Record the screen, extract frames, and build a **slit-scan**: pin a saturated 6px marker to the
edge under test, then
`ffmpeg -i rec.mp4 -vf "fps=30,crop=6:H:x:0,tile=Nx1" out.png` turns the whole motion into one
readable curve — a step is a step, an ease is an ease, and there is nothing to tune.

Two heuristics for "did it jump" were tried before this. In pixels the check measured the *sampler*
(a busy main thread skips timer callbacks, so healthy eases showed 60px "jumps"). Normalised
against path length it **passed a genuinely broken version** and **failed healthy ones by three
points**. Wrong in both directions is not a loose threshold; it is not a measurement. Delete it and
use the frames.

Watch the contrast: a light page with a white sheet and a 6px marker scaled 4× down loses the
signal entirely. Crop tight, scale little.

## 7. Traps that cost whole iterations

- **`document.hidden` freezes rAF *and* the animation timeline.** A browser pane that is open but
  not on screen reports it. A run there hangs, or worse, reports numbers from an animation that
  never advanced. Detect it and say so in the report.
- **Never tune a threshold after seeing it fail.** Either the bar is principled (derive it from the
  engine's own constants — a mid-flight correction is clamped at 0.12s, so judge it by that, not by
  the fresh-transition figure) or the check is unsound and should go.
- **Derived measurements lie for one frame.** `box - room + hidden` mixes terms that update on
  different frames, so at a boundary it dips and reports a change that never happened. Sum the
  parts instead. Anything that *pins* a value off a derived number will pin the wrong one.
- **The harness's own cost is in the numbers.** A per-frame `getBoundingClientRect` +
  `getComputedStyle` forces layout. Absolute values are inflated; trust the *differential* between
  scenarios under identical overhead.
- **Verify on every target after every change.** Two platforms disagreeing is the normal case, not
  the exception, and "shared code path so it should be fine" has been wrong repeatedly.

## 8. Driving the targets

```bash
# iOS Safari (target 2)
xcrun simctl openurl booted "http://localhost:<port>/lab/<harness>"
# then tap the trigger; screenshot with simctl io booted screenshot

# Android Chrome (target 3)
adb reverse tcp:<port> tcp:<port>
adb shell am start -a android.intent.action.VIEW -d "http://localhost:<port>/lab/<harness>"
adb shell input tap <x> <y>
adb exec-out screencap -p > shot.png

# recording for a slit-scan
adb shell screenrecord --time-limit 6 /sdcard/rec.mp4   # self-terminating
xcrun simctl io booted recordVideo --codec h264 out.mp4  # needs an explicit SIGINT
```

Installed PWA and native WebView targets need a real dev run (`adaptv dev ios|android`), not a URL
open — they have a different height cap, a real safe-area inset and the exact OS keyboard height.
