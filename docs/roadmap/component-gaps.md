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

`Slider` · `Select`/`Picker` (the *menu* appearance, not just the wheel) · `Collapsible` · `Icon`.

**`Slider` and a real `Select` are the clearest holes in the form-control set** — adaptv has
button / input / textarea / checkbox / switch and stops. `WheelColumn` is a partial `Picker`.

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
([`../design/image.md`](../design/image.md)), `Pressable`, `Offline`, `BootError`, `UpdateRequired`,
`OrientationGuard`, `EdgeSwipeGestures`, `PwaSplashOverlay`, `UiNotFound`.
