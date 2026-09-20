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

`Icon`.

The form-control set now runs button / input / textarea / checkbox / switch / slider / select,
grouped by `FieldGroup`. **`Icon` is the last Tier 1 item.**

The grouped-settings form is off the list: **`FieldGroup` shipped 2026-09-02**
(`src/components/field-group.tsx`, recorded below). `Slider`, `Select` and `Collapsible` each have
an open PR cut from the same base (#74, #75, #73), so `Icon` is the last Tier 1 hole with nothing
being built for it.

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

`Badge` · ~~`Divider`~~ · `Card` · `Chip` · ~~`Skeleton`~~ · ~~`FAB`~~ · `Avatar`. Cheap, high-frequency,
low-risk, mostly CSS in a DOM framework.

**`Skeleton` shipped** (`src/components/skeleton.tsx`, `src/styles/skeleton.css`) and passes the
admission test on three quirks: `prefers-reduced-motion` stops the pulse **in CSS**, before the
first paint and with no hydration mismatch (the `useReducedMotion` hook is `false` on the server, so
it is exactly the wrong tool); a background-only box paints as nothing under `forced-colors: active`,
so it carries `forced-color-adjust: none` and a `CanvasText` border there; and the placeholder is
`aria-hidden` while `Skeleton.Region` announces the state once through a live region, rather than
per row. Shape and size are the consumer's `className` — no `shape` prop
([`../decisions/styling.md §5.4.1`](../decisions/styling.md)).

✅ **`Fab` shipped 2026-09-02** (`src/components/fab.tsx`) — a `Button` fixed to a screen corner.
It was the one item in this tier that is *not* mostly CSS, and it clears the admission test with
three rules it owns on every target: the safe area (above the home indicator / navigation bar and
inside the side inset, through `--adaptv-inset-*`), the keyboard (it lifts to the live
`--adaptv-keyboard-height`, the larger of that and the bottom inset since the keyboard covers the
home indicator, minus whatever the layout viewport already shrank — the Android WebView resizes for
the keyboard, iOS does not — which matters because on native the OS webview resize is off and the
layout viewport is frozen — [`../design/behaviors.md §4`](../design/behaviors.md) — so a fixed
bottom control otherwise stays under the keyboard), and the hide/show motion under
`prefers-reduced-motion`. Placement is `end` / `center` / `start` (inline-relative, so RTL is right
by construction); the extended form is the same component with `Button.Text` children — no variant
prop.

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

**`Collapsible` shipped** (`src/components/collapsible.tsx`, 2026-09-02) and passes the two-quirk
test with three. `height: auto` cannot animate anywhere adaptv ships — `interpolate-size` is
Chrome 129+ only ([`../decisions/animation.md §2`](../decisions/animation.md)) — so the panel
transitions a measured pixel height and rests at `auto`, and a toggle mid-transition retargets from
the current height for free. React 19 serialises `hidden="until-found"` as plain `hidden`, so the
value is written after mount and reconciled on every commit; a `beforematch` open skips the
transition, because the browser has already stripped the attribute and is about to scroll. And
reduced motion, a 0s `--collapsible-duration` or a `display: none` ancestor means no transition ever
starts, so the settle is read from `getAnimations()` and completes synchronously — there is no timer
fallback. WebKit on the iOS 18 floor has no `until-found`; the attribute degrades to plain `hidden`
with no separate code path.
**`Slider` shipped** (`src/components/slider.tsx`, 2026-09-02, exported from
`@arrzdev/adaptv/components`) and passes the two-quirk test with room to spare. iOS WebKit ignores a
touch that starts on a native range *track*: only the thumb drags, and a tap on the track does
nothing. The painted `Slider.Track` handles the pointer on the whole control, so tap-to-set and
drag-from-anywhere work on every target. A horizontal drag also competes with `Swipeable`, `Drawer`
and `ScrollView` for the pointer, so the slider requests the gesture arbiter at the moment the
gesture locks horizontal (`GesturePriority.Slider = 250`, with `blocksScroll` and `onLost` ending the
drag) and a touch that goes vertical first abandons the gesture with the value unchanged, so
scrolling across a slider never moves it. Two smaller ones ride along: `pointercancel` ends the drag,
which on iOS only fires with sibling pointer listeners and the touch-action longhand
([`../decisions/register.md` B13](../decisions/register.md)); and float steps are quantised to the
step grid from `min` and rounded to the step's decimals, so 0.1 three times reads 0.3. A real
`<input type="range">` stays in the tree, visually hidden and focusable, for keyboard, screen readers
and forms. Lab `/lab/slider`; e2e `playground/e2e/slider.spec.ts` on chromium and webkit.
**`Select` shipped 2026-09-02** (`src/components/select.tsx`) — the *menu* appearance; `WheelColumn`
remains the wheel appearance. It passes the two-quirk test five times over: iOS renders `<select>` as
a wheel and scrolls the page when it is focused, so `Select` paints its own trigger and an anchored
listbox on every target and keeps a real `<select>` mounted, hidden and never focused, only so
`name` / `required` / autofill and form submission still work; hardware and gesture back close the
list instead of navigating (the Transient band, the rule `Dropdown` records); the list rides the
`Dropdown` positioning engine (fixed layer, flip, height cap with an inner scroller, shift); the
keyboard model — arrows that skip disabled options, Home/End, Enter/Space, Escape, typeahead — is
adaptv's, not the browser's; and options carry the press-core `touch-action` longhand because
`manipulation` kills `pointercancel` on iOS
([`../decisions/register.md`](../decisions/register.md) B13).
**`FieldGroup` shipped 2026-09-02** (`src/components/field-group.tsx`) — the grouped-settings form,
Ionic's `ion-list inset` and the iOS Settings pattern. It is a compound: `<FieldGroup>`
(`data-adaptv="field-group"`) holds `<FieldGroup.Section title footer>` (`data-part="section"`, with
`aria-labelledby` pointing at its own `data-part="header"`), whose rows are the only children of
`data-part="rows"`, and a `data-part="footer"`; `<FieldGroup.Header>` / `<FieldGroup.Footer>` slots
beat the shorthand props, the ergonomics `../research/component-surface.md §9` item 12 records.
`<FieldGroup.Row label description disabled render>` (`data-part="row"`, `data-disabled` and
`aria-disabled` together) takes an element-only `render` like `Text`
([`../decisions/styling.md §3.3`](../decisions/styling.md)): `render={<label />}` makes the row its
control's label, `render={<Link />}` makes it a navigation row. `data-part="label"` / `"title"` /
`"description"` are the row's parts, with `<FieldGroup.Label>` / `<FieldGroup.Description>` as the
slots. `getFieldItemPosition(index, total)` ships beside it (item 16 of the same list).

Two things it refuses, on the record so nobody adds them back. **No `data-position` on a row.** Rows
are the only children of the rows container, so Tailwind's `first:` / `last:` / `only:` already
spell the grouped corner radii, and [`styling.md §5.4.1`](../decisions/styling.md) forbids inventing
a name for what Tailwind can already say; the helper stays for rows that are *not* DOM siblings, a
virtualised list being the case. **The locked minimum on a row is structure only**: the row is
`flex` and its label column is `flex flex-col`, because leading/trailing and title-over-description
only exist while those are flex containers. Alignment (`items-center justify-between`) is a default
the consumer can replace with `items-start`, and every colour, radius, padding and gap is the
consumer's `className`, per [`styling.md §5.4`](../decisions/styling.md).

Also already shipped and easy to mis-list as gaps: `Dropdown` (the menu/popover row), `Image` as a
full compound component with a build-time placeholder pipeline
([`../design/image.md`](../design/image.md)), `Fab` (Tier 4 above), `Pressable`, `Offline`,
`BootError`, `UpdateRequired`, `OrientationGuard`, `EdgeSwipeGestures`, `PwaSplashOverlay`,
`UiNotFound`.
