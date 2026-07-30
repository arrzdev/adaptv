# adaptv — the "performance boost": what it is, where it came from, and why it should be deleted

> The `gpuBoost` patch — `hooks/use-global-fps-sentinel.ts` + `html[data-gpu-boost]` + the
> `hardware-boosted` utility — has shipped since 2026-06-16 and has never been studied. This is the
> study. It reaches a **delete** verdict, and the case for it is below.
>
> Read at adaptv `da36bd1ac440e0a2d808d6bead69d16f8a2d5bb6`. Upstream pinned at telegram-tt
> `1fb923db6c363745c5b9183153c9df62c81c36a6` and tweb `e52b5d9318848ab83316cb53138358cf49d2a27f`.
> Support facts are from MDN BCD `main` (the `webview_ios` / `webview_android` columns, not
> `safari_ios` / `chrome_android`), read 2026-07-29. Every constant below has its provenance stated,
> or is flagged as having none.

---

## 0. The verdict

| # | Component | Verdict | One-line reason |
|---|---|---|---|
| 1 | `will-change: transform` toggled at runtime on `.hardware-boosted` | **DELETE** | It makes each element a **containing block for `position: fixed` and `absolute` descendants** and toggles that on and off mid-session. A performance heuristic that mutates layout. |
| 2 | `transform: translate3d(0,0,0)` / `backface-visibility: hidden` / `perspective: 1000px` | **DELETE** | Not inert cargo cult — each one *independently* creates the same containing block, and `perspective` additionally puts every descendant into a 3D rendering context. |
| 3 | The rAF FPS sentinel as a **trigger** | **DELETE** | Structurally too late (≥666 ms of jank before it fires), and it flaps — see §4.5, the finding that decides this. |
| 4 | `hardware-boosted` as a public `@utility` | **DELETE** | Consumer-facing surface for an internal mechanism that is itself being deleted. |
| 5 | `@apply hardware-boosted` inside `scrollable-x` / `scrollable-y` | **DELETE** | Promotes something the engine already promotes (§4.2). |
| 6 | `patches.gpuBoost` config flag | **DELETE**, do not move to `ui: {}` | The alternative to the boost is *correct rendering*, not a different taste. Broken → no knob. |
| 7 | `useGlobalFpsSentinel` export from `interface/hooks.index.ts` | **DELETE** | It is *also* mounted by the shell; two samplers fight over one attribute (§1, correction 1). |
| 8 | Ionic's `body { transform: translateZ(0) }` (PRIOR-ART §1 rank 1, not yet ported) | **PORT — unchanged** | This is what a *correct* promotion looks like: one element, static, never toggled, fixing a named bug. It is the counter-example that proves the rule, not an exception to it. |
| 9 | A replacement runtime "performance mode" | **DO NOT BUILD** | §7. iOS exposes **no** passive performance API to drive one (§5), and no neighbour ships one — Ionic has documented evidence that both halves of the remedy backfire on WebKit and Chrome (§6.2). |

**The single most important thing to decide: whether adaptv has a measured jank problem at all.** Every
argument below is about a mechanism that was built without one. Do not replace it with a second
mechanism built without one — §8 is the harness that would answer the question, and it is cheaper than
either.

---

## 1. Corrections to the brief

The brief is wrong in five places, and three of them change the conclusion.

**1. `useGlobalFpsSentinel` is not consumer opt-in. It is already forced.** The brief says *"today the
consumer must opt in by calling it."* `RoutingShell` calls it unconditionally, gated only on
`patches.gpuBoost ?? true` (`src/shell/shell-layout.tsx`). It is *also* exported from
`src/interface/hooks.index.ts`. So the actual defect is the inverse of the stated one: the hook is
forced **and** public, which means a consumer who follows the export and mounts a second sampler gets
two rAF loops writing the same `<html>` attribute — and the second one's cleanup removes the first
one's boost. The doctrine fix is to delete the export, not to add the shell call that already exists.

**2. `hardware-boosted` is *not* registered in `src/utils/cn.ts`.** The added constraint says it is.
`extendTailwindMerge` registers `pwa-scroll-behavior` (`scrollable-x` / `scrollable-y` / `scrollable`)
and `pwa-touch-behavior` (`clickable` / `non-clickable`). `hardware-boosted` appears nowhere in that
file. There is therefore no de-registration to do — and, incidentally, that omission is a live
tailwind-merge bug in its own right: `cn("hardware-boosted", "will-change-auto")` keeps both classes
today, because tailwind-merge does not know the custom utility sets `will-change`. Deleting the
utility resolves it.

**3. The legacy hints are not cargo cult.** The brief asks whether `translate3d` / `backface-visibility`
/ `perspective` "still do anything." They do — just not the thing they were added for. All three change
the containing block of descendants (§4.1). "Inert" would have been the *good* outcome.

**4. The lineage is real but shallow, and points the other way.** There is an ancestor in Telegram Web
(§2), and reading it is the strongest argument against adaptv's version: upstream is iOS-only, one-shot,
and its remedy is explicitly *not* `will-change`.

**5. `patches.css` in-file comment is wrong.** It says *"`will-change: transform` alone already creates
the compositing layer"*, offered as the reason the legacy hints are now safely overridable. Creating a
compositing layer was never the concern; creating a **containing block** is, and `will-change: transform`
does that too — so the sentence is true and irrelevant, and it is the sentence that let the three
harmful declarations survive a refactor.

---

## 2. Lineage — traced, and it is not a port

**Searched:** full clones of `Ajaxy/telegram-tt` and `morethanwords/tweb` at the SHAs above, grepped
for `fps|lowFps|frameCount|frameRate`, `IS_LOW_END|low-end|deviceMemory|hardwareConcurrency`,
`will-change|willChange`, `documentElement.setAttribute`, `animationLevel`, `liteMode`.

**`data-gpu-boost` appears in neither repo. No CSS-variable-gated `will-change` appears in either.**

### 2.1 The actual ancestor

[`telegram-tt/src/util/betterView.ts`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/util/betterView.ts),
added 2023-10-27, 92 lines, verified verbatim:

```ts
const TEST_INTERVAL = 5000;   // 5 sec
const FRAMES_TO_TEST = 10;
const REDUCED_FPS = 35;

export function betterView() {
  if (!IS_IOS) return;
  …
}
```

and the remedy — this is the part that matters:

```ts
function improveView() {
  isImproved = true;
  const containerEl = document.createElement('div');
  containerEl.style.cssText = 'position: absolute; top: 0; left: 0; width: 0; height: 100%; overflow: hidden;';
  const boosterEl = document.createElement('div');
  const height = window.screen.height * 1.5;
  boosterEl.style.cssText = `width: 0; height: ${height}px; transform: translateX(100%); transition: transform 100ms;`;
  …
  requestAnimationFrame(() => {
    boosterEl.addEventListener('transitionend', () => { containerEl.remove(); });
    boosterEl.style.transform = '';
  });
}
```

A zero-width, off-screen div that runs one 100 ms transform transition and **deletes itself**. It nudges
WebKit into re-establishing accelerated compositing once, then leaves no trace.

| | upstream `betterView.ts` | adaptv sentinel |
|---|---|---|
| Platform gate | **iOS only** (`if (!IS_IOS) return`) | all six targets |
| Cadence | `setInterval` 5 s, stopped on `blur` | continuous rAF while active |
| Sample | **median** of 10 frame deltas | frame count / 333 ms window |
| Threshold | ≤ 35 fps | < 46 fps × 2 windows |
| Latch | **one-shot**, `isImproved` never resets | reversible, and it flaps (§4.5) |
| Remedy | a transient, self-removing dummy transition | **persistent `will-change` on every scroller** |
| Blast radius | one detached div | the app shell frame + every scroll container |

**Verdict on the lineage: "inspired by", not "ported from".** The half that was inherited (sample the
frame rate) is the half that does not matter. The half that matters (what to do about it) was invented
downstream, and it is the opposite of what upstream does. Under
[PRIOR-ART.md §0](PRIOR-ART.md#0-license--attribution--settled) the file should have carried a
provenance header and a `Why:` line from day one; it carries neither, and its git history
(chopchop `453eae7`, 2026-06-16) shows it landing fully formed with no comment on any constant.

> ⚠︎ **Do not revere the upstream either.** `frames.sort()` has no comparator, so it sorts frame deltas
> **lexicographically** — `[100.2, 16.6, 8.3]` sorts to `["100.2","16.6","8.3"]`. Upstream's "median"
> is the median of stringified numbers. It has been that way since 2023.

### 2.2 What Telegram actually does about slow devices

Both clients use a **user setting, not a measurement**, and neither sniffs hardware:

- telegram-tt: `animationLevel` 0/1/2, default MED —
  [`config.ts#L140-L143`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/config.ts#L140-L143),
  consumed by
  [`resolveTransitionName.ts#L12-L14`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/util/resolveTransitionName.ts#L12-L14).
- tweb: `liteMode`, a pure settings read with zero hardware detection —
  [`helpers/liteMode.ts`](https://github.com/morethanwords/tweb/blob/e52b5d9318848ab83316cb53138358cf49d2a27f/src/helpers/liteMode.ts).
- `navigator.deviceMemory` appears in **neither** repo. `hardwareConcurrency` appears only for
  worker-pool sizing.

And the mechanism they *do* run at frame time is the philosophical inverse of promotion:
[`beginHeavyAnimation`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/lib/teact/heavyAnimation.ts#L16)
is a refcounted signal that touches **no styles at all**; subscribers
([`useHeavyAnimation`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/hooks/useHeavyAnimation.ts))
**pause work** — `AnimatedSticker` literally stops playing
([`AnimatedSticker.tsx#L272`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/components/common/AnimatedSticker.tsx#L272)).

> **The one-sentence takeaway from the source of the idea: when frames are scarce, Telegram does less
> work. It does not allocate more compositor layers.**

Every `will-change` in telegram-tt (12 of them) is a static `.scss` declaration scoped to a component
state class, e.g.
[`Chat.scss#L38-L40`](https://github.com/Ajaxy/telegram-tt/blob/1fb923db6c363745c5b9183153c9df62c81c36a6/src/components/left/main/Chat.scss#L38-L40).
None is on a scroll container. tweb's one class-toggled case is added before a transition and removed on
`transitionend` — the textbook scoped pattern
([`appImManager.ts#L531`](https://github.com/morethanwords/tweb/blob/e52b5d9318848ab83316cb53138358cf49d2a27f/src/lib/appImManager.ts#L531),
[`#L553`](https://github.com/morethanwords/tweb/blob/e52b5d9318848ab83316cb53138358cf49d2a27f/src/lib/appImManager.ts#L553)).

---

## 3. The blast radius today

`will-change: var(--adaptv-gpu-boost, auto)` is on `hardware-boosted`, and `scrollable-x` /
`scrollable-y` `@apply` it. So the set of elements that flip together is:

| Carrier | Elements per screen |
|---|---|
| `APP_SCREEN_FRAME_CLASS` (`shell-layout.tsx`) | **1 — the full-viewport frame wrapping the entire app** |
| `scrollable-y` / `scrollable-x` (via `@apply`) | every `ScrollView`, every `List`, every `WheelColumn`, every consumer `scrollable-*` |
| `text-area.tsx` | every `TextArea` |
| `pwa-splash-overlay.tsx` | 1 |

A screen with a `List`, a horizontal chip row and two `TextArea`s promotes **six elements including the
whole viewport**, on a device that just told you it is short of frames.

---

## 4. The case against

### 4.1 🔒 The remedy mutates layout — this is a bug, not a cost

All four declarations independently make the element a **containing block for `position: fixed` *and*
`position: absolute` descendants**, and a stacking context.

| Declaration | Normative source |
|---|---|
| `will-change: transform` | [css-will-change §2](https://drafts.csswg.org/css-will-change/): *"If any non-initial value of a property would cause the element to generate a containing block for fixed positioned elements, specifying that property in `will-change` must cause the element to generate a containing block for fixed positioned elements."* (and the same sentence for absolutely positioned) |
| `transform: translate3d(0,0,0)` | [css-transforms-1 §3](https://drafts.csswg.org/css-transforms-1/#transform-property): *"any value other than `none` for the `transform` property also causes the element to establish a containing block for all descendants. Its padding box will be used to layout for all of its absolute-position descendants, fixed-position descendants, and descendant fixed background attachments."* |
| `perspective: 1000px` | [css-transforms-2 §8](https://drafts.csswg.org/css-transforms-2/): *"The use of this property with any value other than `none` establishes a stacking context. It also establishes a containing block for all descendants"* |
| `backface-visibility: hidden` | [css-transforms-2 §10](https://drafts.csswg.org/css-transforms-2/): *"A computed value of `hidden` … on a transformable element that participates in a 3D rendering context establishes both a stacking context and a containing block for all descendants"* — and the `perspective` on the same element is what creates that 3D context |

Corroborated by MDN's
[containing block](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_display/Containing_block)
reference, which lists `transform`, `perspective`, `filter`, `backdrop-filter`, `contain: layout|paint|
strict|content`, **and** *"a `will-change` value containing a property for which a non-initial value
would form a containing block."*

**What that means concretely, the moment the sentinel trips:**

- A `position: fixed` descendant of any boosted element re-anchors to that element's padding box —
  and the shell frame carries `overflow-hidden`, so a fixed child of the frame becomes **clipped**.
- A `position: fixed` descendant *inside a scroller* stops being fixed: it now scrolls with the content
  and is clipped by the scroll box.
- Any `position: absolute` descendant whose intended containing block was an ancestor above the
  scroller silently re-anchors.
- Stacking contexts appear where there were none, so `z-index` relationships that used to compare
  across the boundary stop doing so.
- `perspective: 1000px` puts every descendant into a 3D rendering context. `WheelColumn` is
  `scrollable-y` and therefore boosted, and its rows already compose
  `perspective(...) translateY(...) translateZ(...) rotateX(...)` per row — so the picker drum's
  geometry is in the blast radius. **Flagged as likely, not proven**; §8.3 is the experiment that
  settles it in ninety seconds.

And all of it **reverts** when frames recover. This is a layout mutation driven by a frame-rate
heuristic, applied at exactly the moment the main thread is least able to absorb a reflow.

> There is no version of "tune the constants" that fixes this. The remedy is wrong at the level of
> what it does, not how often it does it.

### 4.2 It promotes what the engine already promoted

The stated purpose is to help **scroll containers**. Both target engines already composite scrollers by
default:

- **WebKit:** Safari 13 / iOS 13 added one-finger accelerated scrolling for all frames and
  `overflow: scroll` elements, which is why `-webkit-overflow-scrolling: touch` became a no-op
  ([WebKit blog, *New WebKit Features in Safari 13*](https://webkit.org/blog/9674/new-webkit-features-in-safari-13/)) —
  a fact [`ANIMATION.md §1.1`](ANIMATION.md) already records in this repo.
- **Chromium / Android WebView:** scroll unification moved gesture scroll handling out of Blink so the
  compositor handles **all** scrollers, including ones that were not previously composited
  ([`cc/input`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/cc/input)).

So `will-change: transform` on a scroller buys a layer it already had, and pays §4.1's containing-block
change plus §4.3's memory for it.

**And on WebKit it can cost more than the layer.** Ionic documents in their own source that
`translate3d` on a scroll container *defeats* WebKit's "layer backing sharing" optimisation and thereby
**degrades** scrolling — they use `z-index: 0` instead, specifically to avoid it (§6.2 (i), WebKit bug
216701). adaptv applies `translate3d(0,0,0)` to every scroller, on the same engine, at the moment
frames are already scarce.

This is the case MDN warns about verbatim:

> *"Don't apply `will-change` to too many elements: The browser already tries as hard as it can to
> optimize everything. Some of the stronger optimizations that are likely to be tied to `will-change`
> end up using a lot of a machine's resources. Overusing the property can cause the page to slow down
> instead of improving it's performance."*
> — [MDN, `will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/will-change)

> *"`will-change` is intended to be used as a last resort to try to deal with existing performance
> problems. It should not be used to anticipate performance problems. Excessive use of `will-change`
> will result in excessive memory use and will cause more complex rendering to occur as the browser
> attempts to prepare for the possible change. This will lead to worse performance."*
> — ibid.

The spec's own authoring section says the same thing under three headings — *"Don't Spam will-change
Across Too Many Properties or Elements"*, *"Use will-change Sparingly In Stylesheets"*, *"Don't Waste
Resources On Elements That Have Stopped Changing"* — and is blunter than MDN about the consequence
([css-will-change §1.2](https://drafts.csswg.org/css-will-change/)):

> *"The browser already tries as hard as it can to optimize everything. Telling it to do so explicitly
> doesn't help anything, and in fact has the capacity to do a lot of harm; some of the stronger
> optimizations that are likely to be tied to `will-change` end up using a lot of a machine's resources,
> and when overused like this **can cause the page to slow down or even crash**."*

adaptv's mechanism violates all three simultaneously, from a stylesheet, on the app's root frame.

### 4.3 The memory cost lands on the device least able to pay it

Promoting the app shell frame means the entire visible app becomes one compositor texture.

> *"Every layer you create requires memory and management, and that's not free."* …
> *"**On devices with limited memory the impact on performance can far outweigh any benefit of creating
> a layer.**"* … *"Every layer's textures needs to be uploaded to the GPU, so there are further
> constraints in terms of bandwidth between CPU and GPU, and memory available for textures on the GPU."*
> … *"Do not promote elements unnecessarily."*
> — [web.dev, *Stick to compositor-only properties and manage layer count*](https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count)

⚠︎ **There is no published per-layer byte figure, and this document will not invent one.** I searched
Chromium docs and web.dev and found none; the widely repeated `width × height × 4` is arithmetic for an
RGBA texture, not a citation, and compositors allocate on painted content — a container that paints
nothing may get no texture at all. As arithmetic only: a full-viewport RGBA surface is ~14 MB at
1290 × 2796 and ~4.6 MB at 720 × 1600. **Treat those as an upper bound on one layer, not as a
measurement.** The number that decides anything is total layer count and total layer memory with and
without the boost, and §8.2 measures it directly.

What is not in doubt is the direction, and that web.dev names precisely the device class this feature
was built for.

### 4.4 The trigger is structurally too late

`will-change` is a **preparation**. Its entire value is telling the engine about a change that has not
happened yet, so it can layerize *before* the animation starts. Applying it after two consecutive
sub-threshold windows means applying it **≥ 666 ms after the jank the user already saw**.

Worse, applying it is not free: the promotion itself forces a fresh layerization and texture upload —
a frame drop — and removing it forces another. The mechanism pays the cost of promotion at the exact
moment it has established that there are no spare frames.

### 4.5 🔒 It does not latch on slow devices. It flaps, on all of them.

This is the finding that decides the verdict.

`wake()` resets `frameCountRef` and `lastTimeRef`. **It does not reset `consecutiveDropsRef`**, and
neither does `stopSampling()`. The counter only clears when a window measures at or above threshold.
So `CONSECUTIVE_DROP_THRESHOLD = 2` does not mean *"two consecutive bad windows"*; it means **"two bad
windows ever, within one route"** — they can be minutes apart.

And the first window after every `wake()` is *systematically* the most expensive one: `wake()` is bound
to `pointerdown` / `pointermove` / `wheel` / `scroll` / `keydown` / `touchmove`, so window #1 always
spans the frames that handle the input — hit-testing, event dispatch, style recalc for the new scroll
offset, decode of newly revealed images.

Put together: **two ordinary scroll gestures anywhere in a route session latch the boost on essentially
any device**, fast hardware included. Then, because the `else` branch clears the attribute on the very
next good window, it un-latches immediately, and re-latches on the next slow first-window.

**The observable behaviour is not "adaptive promotion on slow devices." It is a global promote/demote
oscillation during scrolling, on every device** — each cycle re-layerizing the app frame and every
scroller, and re-anchoring their fixed and absolute descendants (§4.1). The mechanism is a jank
*amplifier* under exactly the conditions it was written for.

> This is a falsifiable claim and it is cheap to falsify: §8.3.

### 4.6 The constants, one by one

PRIOR-ART.md's standard is a stated *why* per number. None of these has one, in the code, in the
comments, or in the commit that introduced them.

| Constant | Value | Provenance found | Assessment |
|---|---|---|---|
| `thresholdFps` | `46` | **none** | Not 45 (¾ of 60), not 48, not 50. Nearest upstream number is `REDUCED_FPS = 35`. Also platform-meaningless: iOS caps rAF at 60 Hz regardless of a 120 Hz panel ([`ANIMATION.md §1.1`](ANIMATION.md)), so 46 means "77 % of ceiling" on iOS and something else on a 90/120 Hz Android. |
| `FPS_SAMPLE_MS` | `333` | **none** | ≈ 20 frames at 60 Hz. Defensible as a window length; the arithmetic in `checkFps` is correct (N frames over N intervals). This is the only constant with no *technical* objection. |
| `CONSECUTIVE_DROP_THRESHOLD` | `2` | **none** | Buys ≥ 666 ms of latency (§4.4) and does not do what its name says (§4.5). |
| `IDLE_TIMEOUT_MS` | `1000` | **none** | Coincidentally matches upstream's `AUTO_END_TIMEOUT` for heavy animations, which is a different concept. Keeps the sampler running for 1 s (~60 no-op frames) after the last input. |

### 4.7 The sampler's own cost — the honest answer

The rAF loop is the part of this design that is *least* wrong, and it should not be the reason to delete
it. It is activity-gated (an improvement over the original, which ran unconditionally), each callback is
a `performance.now()`, an increment and a compare, and rAF does not run while the page is hidden.

Two real costs remain, and I will not overclaim either:

1. It requests a frame **every** frame during the 1 s idle tail, which prevents the CPU from reaching
   idle when nothing has changed. WebKit's guidance is explicit that this is the thing to avoid —
   *"the CPU is a leading cause of battery life variance"*, and the stated principle is to **"Drive CPU
   usage to zero in idle"**
   ([WebKit, *How Web Content Can Affect Power Usage*](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)),
   with the recommendation to use `IntersectionObserver` to run work only when visible. The 1 s tail is
   a direct violation of that principle, on the platform that wrote it.
2. It samples *only* during pointer/scroll activity — i.e. only when frames are already scarce.

⚠︎ **Unverified:** I found no published measurement isolating the cost of an empty rAF callback in
battery terms on a low-end Android. §8.4 is the experiment. My expectation is "small enough not to
matter on its own", and the verdict does not depend on it — §4.1 and §4.5 are each sufficient.

For completeness, the sampler is at least correct about backgrounding: *"`requestAnimationFrame()` calls
are paused in most browsers when running in background tabs or hidden `<iframe>`s, in order to improve
performance and battery life"*
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)), and WebKit
suspends rAF outright on inactive pages, so the explicit `visibilitychange` handling is belt-and-braces
rather than load-bearing.

---

## 5. The alternatives, and the wall iOS puts in front of every one of them

Support read from MDN BCD `main`, 2026-07-29. **`webview_ios` mirrors `safari`** (BCD declares
`"upstream": "safari_ios"`), because App Store Review Guideline 2.5.6 requires WKWebView outside the
EU/Japan entitlement. **`webview_android` mirrors `chrome`.**

| Signal | Chrome / Android WebView | Safari / iOS WKWebView | Usable as adaptv's trigger? |
|---|---|---|---|
| `PerformanceObserver` `long-animation-frame` (LoAF) | **123** | **no — `version_added: false` at every version**; still `experimental` | ❌ dark on half the targets |
| `PerformanceObserver` `longtask` | **58** | **no** (`false`) | ❌ dark on half the targets |
| `PerformanceEventTiming` / `interactionId` (INP) | 76 / 96 | **26.2** | ❌ lagging + interaction-only |
| `navigator.deviceMemory` | **63** | **no** (`false`) | ❌ dark on half the targets |
| `navigator.hardwareConcurrency` | 37 | **15.4, clamped to 4 or 8** | ❌ the clamp exists to defeat this use |
| `navigator.connection` | 61 / WebView 50 | **no** (`false`) | ❌ measures the network, not the device |
| `prefers-reduced-motion` | Baseline widely available since 2020-01 | same | ✅ but a *preference*, not a capability |
| `requestAnimationFrame` sampling | yes | yes | the **only** universal option — which is why the current design reached for it |
| `content-visibility: auto` | 85 | **18–25 partial, 26 full** | ✅ a *remedy*, not a trigger — and see the caveat below |
| `contain: layout \| paint \| size \| content \| strict` | 52 | **15.4** | ✅ same |
| `scroll-timeline` | 115 | **26** | ❌ too new to carry anything |

**The conclusion that matters: on iOS there is no passive performance-observation API at all.** LoAF,
Long Tasks, `deviceMemory` and `connection` are all absent, and `hardwareConcurrency` is deliberately
clamped — BCD records the reason verbatim: *"The value of this property is clamped to 4 or 8 cores, to
prevent device fingerprinting."* The brief asks which modern API adaptv should switch to; the honest
answer is **none of them can carry the trigger**, because the platform where the boost was supposed to
matter — a Capacitor WKWebView on a slow iPhone — exposes nothing but rAF.

Three caveats that would bite anyone who reached for the "modern" answers:

- ⚠︎ **`content-visibility: auto` on iOS 18–25 breaks find-in-page.** BCD records the Safari 18 entry as
  `partial_implementation: true`, *"Skipped content is not findable via find-in-page"*
  ([webkit.org/b/283846](https://webkit.org/b/283846)), superseded by a clean implementation in 26. That
  is a correctness regression across the entire currently-deployed iOS 18–25 base. It also requires
  `contain-intrinsic-size`, or unsized skipped elements collapse and the scrollbar shifts
  ([web.dev](https://web.dev/articles/content-visibility)).
- ⚠︎ **`navigator.deviceMemory`'s buckets changed.** BCD: *"From Chrome 147, reported values are 2, 4, 8,
  16, and 32. Before Chrome 147, reported values were 0.25, 0.5, 1, 2, 4, and 8."* Any threshold written
  against it is version-dependent.
- ⚠︎ **`contain: style` is recorded as removed in Safari 27.** Reported by BCD, not chased to a WebKit
  changelog — treat as unverified upstream, but do not build on style containment.

**How to detect any of this at runtime, if adaptv ever needs to:**
`PerformanceObserver.supportedEntryTypes`, which exists precisely because *"the list of supported entries
varies per browser and is evolving"*
([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/supportedEntryTypes_static)).
Never a UA sniff.

> ⚠︎ **Unverified:** the WebKit standards-position issue for LoAF. I could not find one, so do not claim
> "WebKit has declined it" — only that it is absent from every shipped version.

This cuts both ways, and it is worth being precise about it: it is a defence of the *choice* of rAF, and
simultaneously the strongest argument that adaptv should not be in this business. A framework cannot
ship a correctness patch whose trigger only works on half its targets — and the one trigger that works
everywhere is the one §4.4 and §4.5 show is unusable.

> ⚠︎ **`contain` is not a free substitute.** `contain: layout | paint | strict | content` creates the
> same fixed/absolute containing block as `will-change: transform` (MDN, above). Applied *statically* it
> is a fact a component author designs around; applied *dynamically* it is the same bug in a new hat. If
> containment is ever added to `scrollable-*`, it must be unconditional and it must land with a test.

---

## 6. What the neighbours do

Ionic pinned at `0428285866690b85763110e1e671a631b667b051` (`main`, 2026-07-28 — newer than
PRIOR-ART.md's v8.8.14 SHA). React Native at `67a813a94845c2536f210f87532bc9a42c06dbc6`.

### 6.1 The scoreboard

| Framework | Runtime FPS sentinel? | Their actual answer |
|---|---|---|
| **Ionic** | **none.** Zero matches in all of `core/src` for `fps`, `framerate`, `lowend`, `performanceMode`, `deviceMemory`, `hardwareConcurrency`. All 31 `requestAnimationFrame` sites are one-shot scheduling. | `contain` at every component boundary; `will-change` on 12 small elements, 4 gated on an *interaction-state class*; `prefers-reduced-motion` |
| **Capacitor** | **none** — the repo contains **zero** `requestAnimationFrame` calls at all | n/a |
| **Stencil** | **none** — zero `requestAnimationFrame`, zero `will-change` | n/a |
| **React Native** | **none in production.** `FrameRateLogger` measures dropped frames during scroll and **ships them to analytics**; nothing consumes the number at runtime, and there is no native module bound to it in OSS RN, so it is a documented no-op. The FPS numbers developers see are the **Dev-Menu** Perf Monitor. | `removeClippedSubviews` (static, platform default); `shouldRasterizeIOS` / `renderToHardwareTextureAndroid` (static props the *developer* sets) |
| Next.js / React Router / Astro | **none** (`requestAnimationFrame`+`fps` code search: 0 in each) | n/a |
| Quasar / Framework7 / Expo / Svelte | **not checked** — GitHub code-search rate limit. Do not read as confirmed-negative. | — |

### 6.2 🔒 Ionic has on-record evidence that both halves of adaptv's remedy backfire

This is the most valuable thing the survey found, and it is first-party.

**(i) `translate3d` on a scroll container *degrades* scrolling on WebKit.** Verbatim comment in
[`content.scss#L92-L109`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/components/content/content.scss#L92-L109):

> *"This adds `.inner-scroll` as part of the stacking context in WebKit. Without it, children of
> ion-content are treated as siblings rather than descendants. This can result in the children being put
> into their own layers, **degrading scrolling performance**. An optimization called 'layer backing
> sharing' usually kicks in to prevent this, but **having translate3d defeats this optimization.**"*
> — referencing [WebKit bug 216701](https://bugs.webkit.org/show_bug.cgi?id=216701)

Ionic builds the stacking context with `z-index: 0` **specifically to avoid `translate3d`** on their one
scroll container. adaptv applies `translate3d(0,0,0)` to *every* scroll container, under load. On the
same engine. For the opposite reason.

**(ii) Ionic had to ship a fix deleting a `will-change`.** Commit
[`74ce34fa68b926777a4166c5eb815866433ae91e`](https://github.com/ionic-team/ionic-framework/commit/74ce34fa68b926777a4166c5eb815866433ae91e),
*"fix(range): chrome bug with will-change"* (2019-01-28), removes an entire rule:

```diff
-:host(.range-pressed) .range-knob-handle {
-  will-change: left;
-}
```

That was a **narrowly scoped, interaction-gated** `will-change` on one knob, and it still produced a
browser bug worth a release. A global toggle is strictly a larger blast radius.

**(iii) Where Ionic does use `will-change`, it is armed for the duration of a gesture and cleared.**
`.item-sliding-active-slide` ([`item-sliding.scss#L21-L29`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/components/item-sliding/item-sliding.scss#L21-L29)),
`.reorder-list-active` ([`reorder-group.scss#L6-L10`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/components/reorder-group/reorder-group.scss#L6-L10)),
`.range-pressed` ([`range.scss#L150-L152`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/components/range/range.scss#L150-L152))
— each set by the gesture handler and cleared when the gesture ends. The one on their scroller is
`will-change: scroll-position`, not `transform`
([`content.scss#L109`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/components/content/content.scss#L109)).
**Ionic never sets `will-change` from JavaScript at all** (zero `willChange` hits in `core/src/**/*.ts{,x}`),
and gives developers no guidance to use it — the only `will-change` in `ionic-team/ionic-docs` styles the
docs site's own sidebar.

**(iv) Ionic ships zero `content-visibility`.** Their static work-bounding primitive is `contain`, at ~30
sites: `.ion-page { contain: layout size style }`
([`core.scss#L180`](https://github.com/ionic-team/ionic-framework/blob/0428285866690b85763110e1e671a631b667b051/core/src/css/core.scss#L180)),
`contain: strict` on overlays, `contain: size style` on `ion-content` — with `contain: none` deliberately
restored on `.inner-scroll` where a translucent header must show through.

### 6.3 React Native says the same thing in its own words

RN's two `will-change` analogues are static props, and the docs warn about exactly adaptv's failure mode
(https://reactnative.dev/docs/view, https://reactnative.dev/docs/performance):

> `renderToHardwareTextureAndroid`: *"**The downside is that this can use up limited video memory, so
> this prop should be set back to false at the end of the interaction/animation.**"*

> `shouldRasterizeIOS`: *"**Rasterization incurs an off-screen drawing pass and the bitmap consumes
> memory. Test and measure when using this property.**"*

> Performance guide: *"**Be careful not to overuse this or your memory usage could go through the roof.
> Profile your performance and memory usage when using these props. If you don't plan to move a view
> anymore, turn this property off.**"*

`removeClippedSubviews` — RN's nearest thing to `content-visibility` — is likewise a **static** default
gated on platform and a build-time feature flag, never on a measurement
([`FlatList.js#L161-L167`](https://github.com/facebook/react-native/blob/67a813a94845c2536f210f87532bc9a42c06dbc6/packages/react-native/Libraries/Lists/FlatList.js#L161-L167)),
and it is force-disabled where it breaks correctness (Android sticky headers,
[`ScrollView.js#L1830-L1838`](https://github.com/facebook/react-native/blob/67a813a94845c2536f210f87532bc9a42c06dbc6/packages/react-native/Libraries/Components/ScrollView/ScrollView.js#L1830-L1838)).

### 6.4 One more precedent, and it argues for exiting rather than fixing

Ionic **deprecated and then deleted** `ion-virtual-scroll` —
[`a0229bc`](https://github.com/ionic-team/ionic-framework/commit/a0229bc7b2edb061510de0f2042e7910d04accc0)
(2021, *"deprecate virtual scroll in favor of JS framework solutions"*) and
[`1eb6fd0`](https://github.com/ionic-team/ionic-framework/commit/1eb6fd04d7f8c7ccd7dac08d085dc90d9f6283cc)
(2022, removal). Their answer to "lists are janky" was to hand the problem to the framework layer, not
to add an adaptive mechanism. adaptv already made the same call, correctly, by building `List` on
`@tanstack/react-virtual`.

### 6.5 The through-line

> **Not one neighbour ships a runtime FPS sentinel that changes rendering.** The convergent pattern is
> three static layers: (1) bound the work statically — `contain`, `removeClippedSubviews`, virtualization;
> (2) hint the compositor **narrowly and temporarily**, armed by the gesture that is moving the element and
> cleared when it stops; (3) respect the user's declared preference (`prefers-reduced-motion`), not a
> guess about their hardware.
>
> The silence reads less like an unexploited gap and more like a deliberate abstention — and in Ionic's
> case it is documented as one.

⚠︎ **The boundary where measured-FPS adaptation *is* legitimate**, and it is worth naming so this
document is not over-read: WebGL / game-loop contexts (three.js adaptive resolution, `@react-three/drei`'s
`PerformanceMonitor`), where you are already rendering every frame and can degrade *resolution or effect
quality* continuously. That is a different situation from toggling a global CSS hint on a document-flow
UI. **Not independently verified here** — flagged as the shape of a legitimate counter-example rather
than cited as one.

---

## 7. The design

### 7.1 What triggers it

**Nothing measures frames. There is no trigger, because there is no runtime mode.**

The alternatives were weighed in §5 and none survives: LoAF and Long Tasks are absent on iOS,
`deviceMemory` is absent on iOS, `hardwareConcurrency` is clamped precisely to prevent this use, and rAF
sampling is available everywhere but is structurally too late (§4.4) and flaps (§4.5). A trigger that
works on three of six targets is not a framework mechanism; it is a per-platform branch, which
[`ARCHITECTURE.md §0.2`](ARCHITECTURE.md) exists to absorb rather than to ship.

The one signal adaptv *should* honour is the one it already has: **`prefers-reduced-motion`**, via the
existing `useReducedMotion`. It is universal, it is the user's stated intent rather than a guess about
their hardware, and it drives the only decision that is safe to be wrong about — whether a decorative
animation runs.

### 7.2 What it does when triggered — the skeptical answer

**Blanket `will-change` is the wrong lever, and there is no right lever at this altitude.** What
actually helps, in descending order of evidence:

| Lever | Status in adaptv | Verdict |
|---|---|---|
| **Don't render off-screen rows at all** | `List` already virtualizes via `@tanstack/react-virtual` | **Already the answer.** This is the real "performance boost", and it is a component, not a patch. `content-visibility: auto` would be a strictly weaker version of what `List` already does — and on iOS 18–25 it breaks find-in-page (§5). Ionic reached the same conclusion by deleting `ion-virtual-scroll` and handing virtualization to the framework layer (§6.4). |
| **Bound work statically with `contain`** | not used | **STUDY, do not blanket-apply.** It is the neighbours' primitive — Ionic puts `contain` at ~30 component boundaries (§6.2 (iv)) and adaptv has no equivalent. But `contain: layout\|paint\|content\|strict` creates the same fixed/absolute containing block as `will-change: transform` (§5), so it is only safe *statically*, per component, with a test — never toggled, and never applied wholesale to `scrollable-*`. Worth its own investigation; out of scope here. |
| **Animate only `transform` / `opacity`** | [`ANIMATION.md §1`](ANIMATION.md) A3, already doctrine | **Already the answer**, and it is the one that reaches 120 Hz on iOS at all (§1.1 there). |
| **Do less work during animation** (Telegram's `beginHeavyAnimation`) | not built | **The one genuinely interesting idea in the upstream**, and it is a `COORDINATION.md` concern (a refcounted "a gesture owns the frame right now" signal that expensive subscribers can pause on), not a styling patch. Out of scope here — noted so it is not lost. |
| **One static, bug-specific promotion** | [`PRIOR-ART.md §1`](PRIOR-ART.md) rank 1, not yet ported | **PORT.** See below. |
| Blanket runtime `will-change` | shipping today | **DELETE.** |

**The single promotion adaptv should have** is the one already on the port list and never built: Ionic's
`structure.scss` `transform: translateZ(0)` on `body`. It is the shape a promotion must take —

- **one element**, not a class of them;
- **static**, never toggled, so its containing-block effect is a design-time fact rather than a runtime
  surprise;
- **fixes a named, described bug** (WebKit does not always promote `body` on load; the first scroll then
  triggers a repaint that halts scrolling until the next gesture), with a symptom you can look for;
- **costs one layer**, on an element that is already viewport-sized.

⚠︎ It is not free either, and PRIOR-ART does not say so: a `transform` on `body` makes `body` the
containing block for `position: fixed` descendants. Since `body` here is `h-dvh` that is usually a
no-op, but the `Drawer` portal renders into a body-level target, so **that port must land with an
explicit drawer/overlay check on all six targets** — not as a one-line drive-by.

### 7.3 Where it lives

adaptv's convention is a capability accessor (no React) with a hook wrapper
([`ARCHITECTURE.md §4`](ARCHITECTURE.md)). **It does not fit, and that is a signal rather than an
obstacle.** That shape exists to hide a web/native branch behind a reactive *value*. There is no value
here — no consumer, and no adaptv mid-layer, ever asks "how fast are we going?" Building
`capabilities/performance.ts` to satisfy a convention would be adding surface to a feature whose whole
problem is that it has surface.

So: **CSS-only, and less of it.** One static declaration in `patches.css` (§7.2), zero JS, zero config,
zero exports.

### 7.4 How it degrades

adaptv's rule is that nothing silently no-ops. **Under this design there is nothing to degrade** — a
static CSS declaration either applies or the stylesheet did not load. That is the strongest possible
form of the rule, and it is a point in favour of the delete: today's mechanism *does* silently no-op, on
every browser where rAF is throttled or the page is backgrounded, and nobody would ever know.

### 7.5 Is any of it consumer-questionable? No.

The test is *is the alternative broken, or just different?*

| Thing | Alternative | Broken or different? | Where it goes |
|---|---|---|---|
| Runtime `will-change` toggling | not doing it | **Doing it is the broken state** (§4.1) | Deleted. Not a knob. |
| `patches.gpuBoost` | `false` | The flag's `true` branch is the bug | **Deleted**, not migrated |
| Ionic `body { translateZ(0) }` | first scroll dead-drops on WebKit | **Broken** | Doctrine, forced, no knob |
| `prefers-reduced-motion` honouring | ignoring the user's OS setting | **Broken** (a11y) | Doctrine, already forced |

**Nothing here belongs in `ui: {}`.** `ui: {}` is for resets whose right answer depends on what the app
*is* — `noSelect`, `hideScrollbars`, `touchCallout`. A layer-promotion heuristic is not a matter of
taste; either it renders correctly or it does not. Moving `gpuBoost` into `ui: {}` would be preserving a
bug behind a nicer name.

### 7.6 `hardware-boosted` as public API

**Agreed, and it goes further than the constraint asks: both halves die, for different reasons.**

1. **The public `@utility` — delete.** A consumer must never learn that a marker class exists, for the
   same reason they never learn about `data-caret-muted` or the `hover:` variant override. It is
   consumer-facing surface for an internal mechanism, and its only declaration is the one being deleted.
   No `cn.ts` change is needed (§1, correction 2).
2. **The internal marker — delete too, but only because the mechanism it marks is going.** The
   constraint is right that "no public utility" does not imply "no internal mechanism", and if the boost
   were surviving, an internal `data-adaptv-boost` attribute stamped by the primitives would be the
   correct shape ([`STYLING.md §2`](STYLING.md)'s escape-hatch rule: *express it as a prop → `data-*` →
   CSS rule, so there is no class to lose to*). It is not surviving, so there is nothing to mark.

### 7.7 🔒 The question the constraint exposes — and why it is the last nail

*How does a boost reach a consumer's own `<div className="overflow-y-auto">`?*

CSS cannot select on a computed `overflow` value, so the options are exhaustive and each one fails:

| Option | Assessment |
|---|---|
| **Marker class / attribute on adaptv's primitives only** | The honest default, and consistent with how safe-area handling and the scroll-direction lock already work — *primitives absorb the correctness; the consumer's own markup is untouched.* But it means the "app-wide performance patch" covers only the parts of the app adaptv rendered, while the shell frame it *does* cover is the single worst element to promote (§4.3). |
| **Promote coarsely — the shell root or the router outlet** | **Actively harmful and useless at once.** It is precisely the full-viewport, ~14 MB layer of §4.3, and it does not help any scroller, because promoting an ancestor does not composite a descendant's scroll. This is already what `APP_SCREEN_FRAME_CLASS` does today and it is the part to remove first. |
| **JS walks the DOM on trigger and promotes computed scrollers** | Does its `getComputedStyle` sweep over every element **at the exact moment the main thread is already missing frames** — a forced style flush as the response to a frame drop. Self-defeating by construction. |
| **Do not promote at all** | ✅ **Recommended.** |

Three of four options are bad, the fourth is "don't". A mechanism whose reachability problem has no good
solution is a mechanism with the wrong shape. **This question does not need answering, because the
feature it belongs to should not exist.**

---

## 8. How this would be measured

A performance feature with no way to prove it helps is a liability — and that applies equally to the
deletion. The harness below is the deliverable that outlives this document.

### 8.1 The A/B

Two builds of `playground/apps/frontend`, identical but for the mechanism (`patches.gpuBoost: true` vs
`false` is sufficient for the JS half; the CSS half needs the branch). One scripted workload: a fling
scroll through a 5 000-row `List`, a horizontal chip row scroll, and a `Drawer` open/drag/close.

### 8.2 On Android — real numbers are available

- Drive: `adb shell input swipe` in a loop, or WebDriver, against a Capacitor build.
- Attach: `chrome://inspect` → DevTools **Performance** for dropped-frame counts and the
  **Layers** panel for the layer tree and per-layer memory.
- Totals: `chrome://tracing` with the `memory-infra` category for GPU memory with and without.
- **Report:** dropped frames, 95th-percentile frame time, total layer count, total layer memory.

### 8.3 🔒 The two cheap experiments that settle this document

Neither needs a device lab, and each takes minutes.

1. **The flapping claim (§4.5) — instrument, don't argue.** Add a temporary
   `MutationObserver` on `<html>`'s `data-gpu-boost` that logs every add/remove with a timestamp, run
   one 10-second scroll on a **desktop Mac in Chrome**, and count the transitions. The prediction is
   that it toggles repeatedly on hardware that is nowhere near slow. If it toggles zero times, §4.5 is
   wrong and the verdict deserves re-examination.
2. **The layout-mutation claim (§4.1) — see it directly.** In the playground, set
   `document.documentElement.setAttribute("data-gpu-boost","true")` from the console on (a) a screen
   with a `WheelColumn`, and (b) any screen with a `position: fixed` element inside a `ScrollView`.
   Watch for the drum's geometry changing and for the fixed element re-anchoring or clipping.

### 8.4 On iOS — do not measure frames with JavaScript

Safari's Web Inspector Timelines can attach to the simulator or a device, but a JS-based frame probe
measures the thing it perturbs, and iOS's 60 Hz rAF ceiling ([`ANIMATION.md §1.1`](ANIMATION.md)) means
a JS sampler cannot see the render loop's real rate at all.

**Use Xcode Instruments' *Animation Hitches* template against the Capacitor host app.** It reads the
real render-server hitch signposts, needs no page instrumentation, and has no observer effect. Its
Energy Log is also what would settle §4.7's battery question — the one WebKit frames as *"drive CPU
usage to zero in idle"*
([WebKit](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)).

### 8.5 The device

Layer-memory effects reproduce only under a real GPU memory budget; DevTools CPU throttling does not
simulate them. **This needs one cheap physical Android** — a sub-$150, 4 GB, 720p handset — and it is
the single highest-leverage purchase for any performance claim adaptv makes. Until it exists, every
statement in this document about low-end behaviour is reasoning from specs, and is labelled as such.

---

## 9. Migration — exactly what gets deleted

| # | File | Change |
|---|---|---|
| 1 | `src/hooks/use-global-fps-sentinel.ts` | **delete the file** |
| 2 | `src/hooks/index.ts` | drop `export * from "./use-global-fps-sentinel"` |
| 3 | `src/interface/hooks.index.ts` | drop `export * from "../hooks/use-global-fps-sentinel"` (public API removal — note it in the changelog) |
| 4 | `src/shell/shell-layout.tsx` | drop the import, the `const gpuBoost = patches?.gpuBoost ?? true`, the `useGlobalFpsSentinel({ enabled: gpuBoost })` call, and `hardware-boosted` from `APP_SCREEN_FRAME_CLASS` |
| 5 | `src/config/app-config.ts` | delete the `gpuBoost` field from `AdaptvPatches` **and its doc comment**; do **not** add anything to `AdaptvUiConfig` |
| 6 | `src/styles/patches.css` | delete the whole `gpu boost` block — both `html[data-gpu-boost="true"]` rules and the comment above them |
| 7 | `src/styles/utils.css` | delete `@utility hardware-boosted`, its comment, and the `@apply hardware-boosted` line from **both** `scrollable-x` and `scrollable-y` |
| 8 | `src/components/text-area.tsx` | drop `hardware-boosted` from the class string |
| 9 | `src/components/pwa-splash-overlay.tsx` | drop `hardware-boosted` from the class string |
| 10 | `src/styles/utils.test.ts` | delete the `"routes the gpu-boost promotion through a variable, not an override"` test |
| 11 | `src/styles/safe-area.test.ts` | remove the `["adaptv.patches", "--adaptv-gpu-boost: transform;"]` row from the layer-ordering `it.each` table |
| 12 | `docs/DECISIONS.md` | §1.3's patch table row *"GPU layer promotion on FPS drop"* → superseded, pointing here; §1.1's `hooks/` count and the `useGlobalFpsSentinel` mention |
| 13 | `docs/STYLING.md` §3 | drop `data-gpu-boost` from the `data-*` inventory |
| 14 | `docs/ANIMATION.md` §2.1 | the aside *"the exact device class adaptv's `gpuBoost` sentinel exists for"* needs rewording |
| 15 | `playground/.../todos/todo-list.tsx` (×2) | drop `hardware-boosted` — consumer-side proof the utility is gone |
| 16 | `src/utils/cn.ts` | **no change** (§1, correction 2) |

**Then, separately and on its own PR:** port [`PRIOR-ART.md §1`](PRIOR-ART.md) rank 1 (`body {
transform: translateZ(0) }`) with the overlay check from §7.2, and only after §8.3's experiments have
been run and recorded.

**Acceptance** — the [`TESTING.md`](TESTING.md) six-target checklist, with two additions:
`data-gpu-boost` appears nowhere in the built stylesheet or bundle; and a scroll-heavy screen on targets
2, 3 and 6 is no worse than before by §8.2's numbers.

### 9.1 What actually landed

Rows 1–7, 9, 10, 11, 15 and 16 are **done as written**. There is no
`use-global-fps-sentinel.test.ts` to delete — the sentinel shipped without one, which is part of why
none of §4.6's constants was ever challenged.

Three deviations, each deliberate:

- **Row 8 (`src/components/text-area.tsx`) is NOT done.** `TEXT_AREA_INNER_AT_MAX_ROWS_OVERFLOW_CLASS`
  still reads `"overflow-y-auto hardware-boosted"`. The file was owned by a concurrent change and could
  not be touched. The class is now **inert** — `@utility hardware-boosted` is gone, so it emits no rule
  — but it is a dead string in a shipped component and should be dropped. Verified present in
  `dist/components.mjs` after `build:check`; it is the ONLY surviving `hardware-boosted` in the build.
- **Rows 12–14 are NOT done** (`DECISIONS.md` §1.1/§1.3, `STYLING.md` §3 + the `--adaptv-gpu-boost` row
  in §6's custom-property table, `ANIMATION.md` §2.1). Add `docs/COMPONENT-SURFACE.md`'s hooks roster,
  which also still lists `useGlobalFpsSentinel` and is not in the original table.
- **`body { transform: translateZ(0) }` was NOT ported.** §7.2's caveat resolves against the port, and
  it resolves on a spec fact rather than a measurement: the `Drawer` portals into `document.body`
  (`drawer-engine.tsx` — `setPortalTarget(document.body)`, `createPortal(tree, portalTarget)`) and both
  the backdrop and the panel are `position: fixed` (`backdropPosition` / `panelPosition` in the engine
  context). A `transform` on `body` therefore **does** re-anchor them — css-transforms-1 §3, the same
  sentence §4.1 cites against the boost. Today they resolve against the ICB; after the port they would
  resolve against body's padding box, which is `m-0 h-dvh` (`DOCUMENT_SHELL_CLASS`). Those two boxes are
  equal in the static case and **not** equal where the drawer's geometry actually lives: `100dvh` tracks
  the dynamic viewport while fixed positioning resolves against the layout viewport, so the panel's
  `bottom: -excessHeight` and the keyboard offsets would shift by the URL-bar delta on targets 1 and 4.
  Per §9 this belongs on its own PR anyway, after §8.3 — the port stays queued at
  [`PRIOR-ART.md §1`](PRIOR-ART.md) rank 1, now with a named element to check rather than a general
  "overlay check".

**Added, not in the table:** `src/styles/utils.test.ts` gains a
`"the gpu boost is gone and cannot be reintroduced by accident"` block — the compiled stylesheet carries
no `.hardware-boosted` rule, `scrollable-x` / `scrollable-y` carry no promotion hint of any kind, the
shipped CSS contains no `data-gpu-boost` / `--adaptv-gpu-boost` / `hardware-boosted`, and no
non-test file under `src/` mentions `useGlobalFpsSentinel`, `use-global-fps-sentinel`, `gpuBoost` or
`data-gpu-boost`. `scrollable-x`'s comment in `utils.css` now records WHY there is no hint there
(§4.2 + WebKit bug 216701), so the `@apply` is not "restored" as an oversight.

---

## 10. Where this sits

- [`ARCHITECTURE.md §0.1 / §0.2`](ARCHITECTURE.md) — the doctrine that a correctness patch is forced and
  invisible, and that a mechanism which cannot cover all six targets does not belong in the framework.
- [`ANIMATION.md §1 / §1.1`](ANIMATION.md) — the accelerated property set, and the iOS 60 Hz rAF ceiling
  that makes JS frame measurement structurally blind on the platform this feature targeted.
- [`STYLING.md §2 / §6.0.1`](STYLING.md) — the escape-hatch rule (`prop → data-* → CSS`) that would have
  been the right shape had the mechanism survived, and the `!important` ban whose workaround produced
  the `--adaptv-gpu-boost` variable.
- [`PRIOR-ART.md §0`](PRIOR-ART.md) — the provenance-header convention this file was written without,
  and §1 rank 1, the one promotion adaptv should actually have.
- [`DECISIONS.md §1.3`](DECISIONS.md) — the patch register this supersedes for `gpuBoost`.
- [`RESEARCH.md`](RESEARCH.md) — Telegram's `beginHeavyAnimation` belongs on the study list (§7.2); it is
  a `COORDINATION.md` gesture-arbitration concern, not a styling patch.
