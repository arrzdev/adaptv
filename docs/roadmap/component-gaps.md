# adaptv — component gaps

> The ranked list of primitives adaptv does not have yet, derived from
> [`../research/component-surface.md §7–§8`](../research/component-surface.md) on 2026-08-30. That
> doc keeps the full competitive inventory — Ionic's 95-component catalogue, React Native core,
> `@expo/ui`, SwiftUI, Jetpack Compose, `expo-router` — and the reasoning behind the ranking. This
> file is only what is left to build.

---

## The ranking rule

A component that exists in **Ionic *and* `@expo/ui` universal** is the strongest signal: both teams
paid the cross-platform unification tax for it. Next strongest is Ionic plus *both* native toolkits.
Weakest is one ecosystem only.

## The admission test — do not skip it

> 🔒 **Ship a primitive when there are at least two platform quirks it would own.**
>
> Fewer than that and it is a styled element with an import cost — more API to document and maintain,
> for nothing. The question is not *"what does the API need to express?"* (right for SwiftUI, where
> `Text` is the only way to render a glyph) but *"where does the framework get somewhere to stand?"*
> Every primitive is one more place adaptv is on the path when a quirk fires, and the developer who
> most needs the fix is exactly the one who will never apply it by hand.

Two costs to weigh against it every time. **A primitive nobody reaches for buys nothing** — if `<p>`
works and `<Text>` is optional, most people write `<p>` and Dynamic Type never happens, so the value
is made in the docs and the playground, not in the code. And **a wrapper costs a component layer per
node**: in a virtualised list of 1000 rows × 3 texts that is measurable, and should be measured
rather than assumed.

---

## Tier 1 — in the universal set *and* Ionic, and missing from adaptv

`Slider` · `Select`/`Picker` (the *menu* appearance, not just the wheel) · `Collapsible` ·
grouped-settings form (`FieldGroup` / `ion-list inset`) · `Icon`.

**`Slider` and a real `Select` are the clearest holes in the form-control set** — adaptv has
button / input / textarea / checkbox / switch and stops. `WheelColumn` is a partial `Picker`.

## Tier 2 — the feedback layer

`Alert` · `ActionSheet` · `Toast` · ~~`Spinner`~~ · ~~`ProgressBar`~~. Every native toolkit has
these, Ionic has them, and adaptv has only the inline `Spinner` and `ProgressBar`.

**An inline `Spinner` shipped** (`src/components/spinner.tsx`, lab page `/lab/spinner`). It is a
`1em`, `currentColor` `<span>` turning a static arc with one `transform` keyframe, and it owns
three things a hand-rolled spinner leaves out. **Off screen it idles:** one shared
`IntersectionObserver` stamps `data-spinner-offscreen` and the stylesheet pauses the animation. On
the lab page 100 paused spinners draw 0 frames per 2 s against 240 with the pause forced off
(Chromium, CDP trace). **Exposure:** unlabelled it is `aria-hidden`; with a `label` it is an
indeterminate `role="progressbar"`, and the label is announced once per loading episode through
one shared polite live region, however many spinners with that label mount. **Reduced motion** is
an opacity pulse on the drawing, never a stop. The motion's form is a guard, not a fix: a
`transform` keyframe on an outer `<svg>` (`animate-spin` on an icon) is composited too, and the
forms Chromium runs on the main thread are `rotate:` on an svg (traced) and, per its
`compositor_animations.cc`, SMIL, shapes inside the drawing and dash animation. A blocking **`Loading` overlay** (`ion-loading`) is still a gap; it belongs to the
overlay engine below.

**`ProgressBar` shipped in the same module** (`src/components/spinner.tsx`, lab page
`/lab/progress-bar`), because a determinate bar alone owns no quirk and the indeterminate one owns
the spinner's. `value` is `0..1`, clamped; omitted, or not a finite number, it is indeterminate. It
reuses the spinner's machinery rather than a copy: the shared observer pauses an off-screen sweep
(100 bars: 0–2 frames per 2 s against 241–242 with the pause forced off, Chromium, CDP trace), the
label goes through the same announcer, and reduced motion is the same pulse. **Motion is `transform`
only:** the fill is `scaleX` and the sweep `translateX`. Across a fill transition, the layout width
stays constant on both engines, and Chromium traces 0 layouts and compositeFailed 0. A `width` fill,
tried as a mutant, laid out 23 times. **It owns one quirk the spinner never had: forced colors
repaint a CSS background.** Without its opt-out the fill reads `Canvas` and vanishes, so the
indicator paints `CanvasText`. **RTL** flips the origin and the sweep. Ionic's `buffer` and
`reversed` are not built.

**Probably one overlay engine plus five thin presets, not five components.** Ionic's five overlays
all share one interface, and adaptv's `Drawer` is *already* an overlay with a gesture engine behind
it — so the engine largely exists.

✅ **The render-vs-delegate decision is made: render.**
[`open-questions.md` O22](open-questions.md) was answered by the owner on 2026-09-09, and it is the
same answer on the capability side ([`capability-gaps.md`](capability-gaps.md) Tier 2). One engine
plus five thin presets, one look on all six targets, full styling control, and modality that stays
inside `BackPriority.Overlay`. The per-platform exception that was on the table — delegating toast
on Android, where it is a real affordance outside the app window — was **considered and not taken**.
The cost carried knowingly is that accessibility for all five is adaptv's work.

## Tier 3 — the app frame (most leverage, most design work)

`TabBar` · nav header / toolbar with back button and large-title collapse · `SearchBar`.

Both ecosystems ship these and **both treat them as routing-level concerns** — `ion-tabs` /
`ion-router-outlet`, and `expo-router`'s `Stack` / `NativeTabs` — rather than as free-standing
components. adaptv owns its router, so this is the piece with the most leverage; it is also the one
that **cannot be lifted from either API directly**.

`expo-router`'s surface is worth reading closely before designing it — it is the layer adaptv already
competes in, and `../research/component-surface.md §7` inventories it prop by prop: typed `Link`
variants (`Link.Preview`, `Link.Menu`, `Link.Trigger`), `Stack.Screen` with its header primitive
family, `NativeTabs` with `NativeTabTrigger`, the declarative `Badge`/`Icon`/`Label` slot children,
and `Slot`/`Navigator` for headless composition.

## Tier 4 — display chrome

`Badge` · `Divider` · `Card` · `Chip` · `Skeleton` · `FAB` · `Avatar`. Cheap, high-frequency,
low-risk, mostly CSS in a DOM framework.

---

## Deliberately absent — do not "close" these

**The layout family** — `Row` / `Column` / `Spacer` / `HStack` / `Grid` / `ion-col`'s 24 props.
It exists in the neighbours because SwiftUI and Compose have no CSS and Ionic predates CSS grid.
adaptv is DOM + CSS: **flexbox already is that API**, and there is no platform quirk a `<Row>` would
absorb that flexbox does not already handle.

---

## What is already done (so the list is not re-derived wrong)

The root `README.md` has described the remaining tail as *"`Text` / `Modal` / `Tabs` polish"*.
**`Text` shipped** (`src/components/text.tsx`) and passes the two-quirk test on iOS Dynamic Type —
where the `font` **shorthand** is required, `font-size` does not work
([`../decisions/prior-art.md §10`](../decisions/prior-art.md)) — plus `text-size-adjust` on rotation,
line clamping, and per-instance selection semantics. **`Modal` and `Tabs` are the real remainder**
(Tier 2 and Tier 3 above).

Also already shipped and easy to mis-list as gaps: `Dropdown` (the menu/popover row), `Image` as a
full compound component with a build-time placeholder pipeline
([`../design/image.md`](../design/image.md)), `Pressable`, `Offline`, `BootError`, `UpdateRequired`,
`OrientationGuard`, `EdgeSwipeGestures`, `PwaSplashOverlay`, `UiNotFound`.
