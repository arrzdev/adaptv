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

`Alert` · `ActionSheet` · `Toast` · `Spinner` · `ProgressBar`. Every native toolkit has these, Ionic
has them, adaptv has none of them.

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

`Badge` · ~~`Divider`~~ · `Card` · `Chip` · `Skeleton` · `FAB` · `Avatar`. Cheap, high-frequency,
low-risk, mostly CSS in a DOM framework.

**`Divider` shipped** (`src/components/divider.tsx`, rules in `src/styles/divider.css`). It passes the
two-quirk test three times over, and none of the three is a look: the line is **one device pixel at
every density**, and the obvious way to get there is wrong on both engines — a sub-pixel border
width is rounded UP to a whole CSS pixel by Chromium (two device rows at 2x, three at 3x) and floored
to NOTHING by WebKit at 3x (`calc(1px / 3)` is a LayoutUnit of 21/64; 0.328 × 3 rounds to zero rows),
so the border stays a whole `1px` and the element is scaled by `1 / floor(dpr)` with a transform,
which no engine snaps, from the `2dppx` / `3dppx` / `4dppx` buckets — the floor because both engines
first snap that `1px` DOWN to whole device pixels (`0.761905px` computed on a 2.625x Pixel, so `1 / dpr`
drew 0.76 of a pixel and `1 / 2` draws one; measured over CDP on the emulator, the iOS simulator at 3x
and a desktop browser, numbers in the PR's surface matrix); it is drawn as a **border and never a background**, because `forced-colors: active`
drops every author background to `Canvas` and a background hairline disappears; and it says what it
is — `role="separator"` with `aria-orientation` only when vertical, `role="none"` when `decorative`.
Colour, inset and margin stay the consumer's className (`border-red-500`, `mx-4`); the width, the edge
and `align-self: stretch` for the vertical rule are CSS on the identity attribute (§2 escape hatch).

**`Card` does not pass the admission test, measured 2026-09-02.** The one platform quirk a Card
would own is the rounded-corner clip: a `border-radius` + `overflow: hidden` parent whose child is
composited (`will-change: transform`, `translateZ(0)`, or animating) used to paint the child's
square corners over the parent's rounding on WebKit. A four-box probe (plain child, composited
child, animating child, composited parent and child; 24px radius, red child on a blue parent on
white) leaked **0 of 1075 device pixels outside the corner circle in every box** on chromium at 1x
and 3x, on playwright WebKit at 1x and 3x, and on iOS 26.1 Safari on the simulator at 3x. With that
quirk gone, a Card is `rounded-2xl bg-card shadow-sm p-4 overflow-hidden`: a className the consumer
already has, and styling.md §5.4.1 forbids inventing a utility Tailwind spells. Re-open only if a
consumer measures the leak on a WebView adaptv ships to.

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
