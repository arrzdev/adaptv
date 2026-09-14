# Where a transform is authored decides whether it settles

**Engine:** WebKit. **Reproduces on:** physical iPhone only. **Status:** established, fixed, enforced.

## The claim

For a composited `transform` animation on iOS WebKit, **the mechanism the transform is authored
through changes how the motion arrives** — with the curve, duration, distance, endpoints, element
and layer all held identical.

- driven by a `@keyframes` rule → arrives clean
- driven by an inline CSS `transition` → **settles**
- driven by `element.animate()` → **settles**

"Settles" is the symptom the drawer was reported with for months: instead of decelerating flat into
place, the sheet appears to lock or snap the last part of its travel. It is a property of the
arrival, not of the journey — the motion up to that point looks correct.

The claim is narrow on purpose. It is not "keyframes are faster". Nothing here says the composited
path differs in frame timing; **no frame is late in any of the failing cases**, which is exactly why
it survived so long. The pixels at the arrival differ; the timeline does not.

## How it was established

Bisected on a physical iPhone across four ladders of sheets that were otherwise identical — same
markup, same content, same curve, same duration, same travel — each step differing from its
neighbour by exactly one mechanism. Verdicts came from tapping through the ladder on the device,
because no instrument available on the device reports the difference (see *Why it is invisible
below*).

| verdict | steps | mechanism |
|---|---|---|
| clean | A–E, M, O | the transform comes from a `@keyframes` rule |
| **settles** | F–K | an inline CSS transition |
| **settles** | L, N | a JS-constructed animation (`element.animate()`) |
| clean | P, Q, R | the keyframe rule, started by JS and aimed by a measured variable |

The fourth ladder exists because the first three establish a fact the engine cannot simply obey: the
drawer *must* compute its own endpoints. A sheet holding keyboard room does not travel its own
height, and a drag release has no curve to inherit. P–R separate "JS decides the motion" from "JS
performs the motion" and show only the second one matters.

## What was ruled out

The expensive half. Three plausible readings of the same data died, each to a single step:

- **"transition versus animation"** — died on **L**, which `getAnimations()` confirms the browser
  runs as a real `Animation` and not a `CSSTransition`, and which settles anyway. The boundary is
  not the CSS object model's.
- **"declared at mount versus started from an effect"** — died on **M** (a keyframe started late:
  clean) against **N** (a scripted animation started before first paint: settles). A keyframe is
  fine started late; a scripted animation is not fine started early. Timing is not the variable.
- **"the end-of-motion handoff"** — the most attractive one, since the symptom is at the arrival —
  died on **O**. Ladder one never reached it, because its animation kept filling underneath its own
  settle write and hid the question.

Each of these was independently exonerated by a step that carries it and behaves: the arrival settle
write (E), layer promotion and demotion (D — and K removes `will-change` and settles anyway), the
inheritable root-CSS-variable restyle (C), the backdrop fade (B), the endpoint units (J writes
pixels, H writes percentages, both settle), the start-commit style (I), the timing (M), the handoff
(O).

## Why it is invisible below

**No desktop browser reproduces any of it.** Chromium at 1x, 4x, 6x, 8x and 10x CPU throttle, and
real WebKit on macOS, put every corner of the sheet within 0.01px of its target at the arrival.

This is the part with teeth for anyone working on it later:

- The fix **cannot be verified headless**, and an experiment that "fails to reproduce" in Chromium
  has proved nothing.
- The unit suite cannot see it either — jsdom has neither `getAnimations` nor `DOMMatrixReadOnly`,
  so the whole path short-circuits there.
- It follows that the rule is only as durable as the comment on it. That is why
  `src/styles/drawer.css` carries the reasoning in full rather than a cross-reference, and why the
  rule says *do not simplify it back* in those words.

## The same mechanism's other half

WebKit also **promotes an element when an inline transition starts and demotes it when the
transition ends**, re-rasterising the content at the moment the motion finishes. This produced a
second, independent artefact on the same surfaces — text visibly re-rendering as the sheet arrives,
and a dim layer repainting at the end of every fade. The two used to stack, which is part of why the
symptom read as one intermittent bug rather than two deterministic ones.

The remedy is a promotion hint held for the element's whole mounted lifetime, so there is no
transition boundary to demote at: `will-change: transform` on the panel, `will-change: opacity` on
the dim.

Measured cost, Chromium headless at 430×844 on `/lab/drawer`, layer tree read over CDP — with both
hints, and with both forced to `auto`:

|  | layers | layer memory | paints over 5 open/close cycles |
|---|---|---|---|
| shipped (both hints) | 7 | 15.53 MB | 27 |
| both hints forced to `auto` | 7 | 15.53 MB | 29 |

**Neither hint creates a layer.** The panel is already promoted by the engine's own `translate3d`
and the dim by being a fixed child of the portal's stacking context, so the hints declare a
promotion that exists either way — and, per css-will-change §2, grant no containing block that the
transform had not already granted. They are free, they remove paints even in Chromium, and the
WebKit saving is the larger one. This is the narrow shape `docs/design/performance-boost.md` permits: static,
component-scoped, never toggled, fixing a named bug.

## Where it is enforced

| File | What breaks if it is "simplified" |
|---|---|
| `src/styles/drawer.css` — `@keyframes pwa-drawer-slide` | the settle returns; the comment is the only surviving record on the device path |
| `src/components/drawer/drawer-motion.ts` — `tweenDrawerPanelTransform` | reads the live position, drops any running keyframe, commits, re-reads, animates between the two. Its `=== armed` guard stops an interrupted call stripping its own replacement |
| `src/components/style-precedence.test.tsx` | asserts both promotion hints, and that a consumer can turn each off in one variable |
| `src/styles/utils.test.ts` | forbids a promotion hint in the shipped stylesheet, which is why the keyframe uses `translateY` and not `translate3d` |

## What else it predicts

Every remaining use of the same mechanisms in `src/`, with a verdict. This is the reason to keep the
finding: the fix was one file, the audit is the return on it.

| Site | Mechanism | Verdict |
|---|---|---|
| anywhere in `src/` | `element.animate()` | **none left.** The construct that fails ladder steps L and N does not appear in the framework at all |
| `animateDrawerKeyboardOffset` (`drawer-motion.ts`) via `applyDrawerPanelTransition` | inline transition driving **transform** | **gone.** It had no caller — the keyboard lift moved to `drawer-keyboard.ts` in #47 and the settle to CSS in #52 — and was deleted with the rest of that path (f5a3788) |
| the keyboard FLIP (`drawer-engine.tsx`: the keyboard-room effect's grow and shrink, on both its room path and its shrunk-viewport cap path, and the content-height (`reaimKeyboardRoom`) and floor (`releaseKeyboardFloor`) re-FLIPs) via `applyDrawerPanelTransition(…, true)` | inline transition driving **transform** | **open, and the one left.** Each site clears the panel's transition, sets `keyboardFlip` to the height change so the panel paints where it already was, forces a reflow, then writes `transition: transform <duration> cubic-bezier(…)` and sets `keyboardFlip` back to 0, so the inline transition carries the panel home. This is the construct the ladder convicted, still in use for every keyboard grow and shrink, and whether it settles on a device has not been measured. Moving it onto the keyframe is not blocked on mechanism (`tweenDrawerPanelTransform` already hands a runtime duration and curve to the rule), but it rewrites the same grow and shrink that [`../roadmap/native-keyboard-curve.md`](../roadmap/native-keyboard-curve.md) retimes, and needs the same physical-iPhone check, so it belongs there rather than to a change of its own |
| `transitionDrawerBackdropOpacity` (`drawer-motion.ts`) | inline transition driving **opacity** | **fine.** The symptom is a transform arrival; opacity has no arrival geometry to get wrong. Its own half of the demote-repaint is covered by the permanent hint above |
| `writeDrawerKeyboardRoom` (`drawer-keyboard.ts`) | inline transition driving `padding-bottom` / `max-height` | **out of scope.** Layout properties are not composited at all — a different risk class, not a quieter version of this one |
| every other `style.transition =` in the drawer | `"none"` | **not a driver.** These kill a transition rather than install one |
| drag frames, and motion-value writes | per-frame inline `transform` from JS | **exonerated by the ladder.** A drag never settled; the failing cases hand the motion to the engine and let it interpolate, and these do not |

The generalisation worth carrying to the next component: **when a composited property animates and
only the arrival looks wrong, and only on a device, change the authoring mechanism before touching
the curve.** The curve is the thing everyone reaches for first — it was changed once here, to
`(0.25, 0.94)`, which removed a sub-pixel tail and made the whole drawer read as "robotic … too
slow" without touching the actual bug.
