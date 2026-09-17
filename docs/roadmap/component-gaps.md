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
grouped-settings form (`FieldGroup` / `ion-list inset`) · ~~`Icon`~~.

**`Icon` shipped** (`src/components/icon.tsx`), with no dependency and no bundled icon set: it takes
any set's `<svg>` through `render` and owns two quirks. **Exposure:** a decorative icon is
`aria-hidden`, never `role="none"`, because a named svg is announced through `role="presentation"`
by every reader Manuel Matuzović tested in February 2026 except JAWS (VoiceOver on macOS 26.3 says
"group"); a labelled one is `role="img"` + `aria-label`, the pattern announced as an image in every
pairing Scott O'Hara tested. `lucide-react` 0.544.0 never sets the role, and `ion-icon` sets it even
unlabelled. **Dynamic Type:** the box defaults to `1em`, so an icon inside `Text` follows it, and
`scaleWithSystem` multiplies a fixed-size sibling icon by the same measured factor
`Text scaleWithSystem` uses (Flutter's `Icon.applyTextScaling` is the same idea). The `@expo/ui`
universal `Icon` is not prior art for the web half: its `index.tsx` returns `null`, and only the
`.ios.tsx` / `.android.tsx` files render. Deliberately absent: a `mirror` prop (`rtl:-scale-x-100` is
already Tailwind vocabulary) and a sprite `href`, which brings two more quirks of its own — a `data:`
URL in `<use href>` renders nothing in WebKit or current Chromium while Vite inlines a sprite under
4 KB as exactly that in the production build only, and a `display: none` sprite drops its gradients
(Chromium 41337331, WebKit 243341). A **bundled, named icon set** — which is what would make
automatic RTL flipping possible — is an owner call, not a gap.

The form-control set now runs button / input / textarea / checkbox / switch / select. **`Slider` is
the remaining hole in it**, and the grouped-settings form (`FieldGroup`) is the next one after that.

The grouped-settings form is off the list: **`FieldGroup` shipped 2026-09-02**
(`src/components/field-group.tsx`, recorded below). `Slider`, `Select` and `Collapsible` each have
an open PR cut from the same base (#74, #75, #73), so `Icon` is the last Tier 1 hole with nothing
being built for it.

**`Icon` passes the admission test without a dependency** (evidence gathered 2026-09-13, not built).
Two quirks hold whatever the consumer passes in. **Accessible exposure differs by engine**: a
decorative svg must be `aria-hidden`, because `role="none"` does not remove one that carries a label
or a `<title>` (VoiceOver macOS 26.3 reads "group", TalkBack on Android 16 and NVDA read it —
[Matuzović, 2026](https://www.matuzo.at/blog/2026/role-presentation-no-alternative-for-aria-hidden)),
and a meaningful one is labelled with `role="img"` beside `aria-label`. The playground's own set
gets half of it: `lucide-react` adds `aria-hidden` when unlabelled and never adds the role when
labelled, and `ion-icon` stamps `role="img"` whether labelled or not. Since WebCore's fix for
[156774](https://bugs.webkit.org/show_bug.cgi?id=156774) (landed 2019-04-08) a labelled svg with no
accessible descendants is exposed as an image rather than an empty group; what iOS 26 VoiceOver
announces for a labelled svg without the role is unmeasured, and owed a simulator Accessibility
Inspector read. **iOS Dynamic Type reaches an icon
only by measurement**: `Text scaleWithSystem` grows the label and a `size-4` or `size={24}` icon
beside it does not, so a `1em` default plus the same opt-in `measureDynamicTypeScale()` is the fix;
Flutter's `Icon.applyTextScaling` is the same knob. Two more hold only if `Icon` takes a sprite
`href`: a `data:` URL in `<use>` renders nothing (WebKit never supported it; Chromium
[removed it](https://developer.chrome.com/blog/migrate-way-from-data-urls-in-svg-use), announced for
120), and Vite produces exactly that in production for an `import sprite from "./icons.svg"` under
4 KB, because its only guard is an import id that already contains `#` (`vite@8.0.11`,
[vitejs/vite#15453](https://github.com/vitejs/vite/issues/15453)) — blank in the build, fine in
dev, and still fine on the Chromium 119 WebView floor; and a `display: none` sprite drops gradients
in Chromium ([41337331](https://issues.chromium.org/issues/41337331)), with the WebKit report
([243341](https://bugs.webkit.org/show_bug.cgi?id=243341)) naming masks and clip paths as affected
too, and its Safari 26 reproduction made on a beta (with Safari Technology Preview 221), not a
release.

What it does **not** own, so nobody builds it in: RTL mirroring is `rtl:-scale-x-100`, because
Tailwind 4.2.4's `rtl:` is `:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *)` and the attribute
branches cover both engine gaps ionicons wrote CSS around (no `:dir()` below Chromium 120, and
WebKit [257133](https://bugs.webkit.org/show_bug.cgi?id=257133)); *which* glyphs flip is only
knowable from a named set (ionicons flips names containing `arrow` or `chevron`). `currentColor`
under forced colors is Windows-desktop only and already what lucide ships. `1em` and baseline
alignment are the same on every engine. The shape this points at is `render` (an element, on Text's
pattern) or `href`, one `label` prop that decides `role="img"` versus `aria-hidden`, and
`scaleWithSystem`; a bundled named set is an owner call, and the proposal is none.

A correction to the signal behind this tier: `@expo/ui`'s universal `Icon` **renders nothing on
web** — `packages/expo-ui/src/universal/Icon/index.tsx` is `return null`, `@platform android` and
`ios` — so `Icon` ranks here on Ionic, SwiftUI, Compose and `expo-router`, not on a web
implementation Expo paid for.

**`RadioGroup` is missing from every tier, and passes.** `ion-radio-group` and Compose's
`RadioButton` are inventoried in `../research/component-surface.md` §2.3 and §4.3, yet the §8 table
has no row, and adaptv has checkbox and switch with no single-choice group beside them. Two quirks:
a clipped `sr-only` input gives the control a speck-sized accessibility frame on iOS 18.0 and 26.1
simulator Safari (open PR #132 measured the sibling controls: ~1×2 pt for `Switch`, whose centre tap
then did nothing, while `Checkbox`'s speck sat mid-box so its tap still toggled — whether a tap lands
depends on where the speck sits); and a radio group is keyed on `name` within one tree and one form
owner ([HTML](https://html.spec.whatwg.org/multipage/input.html#radio-button-group)), so two mounted
instances of one component with a literal name uncheck each other whether they share a form or sit
outside any, which a `useId` name owns. The
segmented control (a §8 row that is also in no tier) is best read as an appearance of it, on
§9 item 4's `interface` idea — its sliding indicator is a composited `translate` and its RTL is
`rtl:` vocabulary, so it brings no quirk of its own.

## Tier 2 — the feedback layer

`Alert` · `ActionSheet` · `Toast` · ~~`Spinner`~~ · `ProgressBar`. Every native toolkit has these,
Ionic has them, and adaptv has only the inline `Spinner`.

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

**The spinner and progress presets need an inline indicator, and that indicator passes on its own
quirks** (evidence 2026-09-13). This does not reopen O22: an inline indicator delegates nothing and
adds no second engine, O22's own table calls these two "not a dialog at all", and Ionic — the model
O22 follows — ships `ion-spinner` inline and `ion-loading` as the overlay that renders it. So it is
proposed as the first slice of this item, not as display chrome. **An offscreen spinner keeps the
page from idling**: Quasar measured, over CDP on Chromium, up to 173 ms/s of style time for 100
offscreen `QSpinnerIos` instances and zero after `content-visibility: auto` with no animation on
the root and no SMIL
([`eab3ffa0ea`](https://github.com/quasarframework/quasar/commit/eab3ffa0ea8b912a5f1c744a3436f043b3693ee7));
the WebKit half is unmeasured, and `content-visibility` is Safari 18+. **Which spinner animations
stay composited is an SVG-specific list**: Chromium's `compositor_animations.cc` refuses an SVG
element with SMIL, one inside a resource container (`clipPath`, `mask`, `pattern`, `marker`, a
gradient or a filter — not `<symbol>`), one whose own transform carries more than its CSS transform
(a `<use>` with `x`/`y`, or an `<svg>`/`<symbol>` viewport with a `viewBox`), and any SVG element —
the root `<svg>` included — animating `translate`, `rotate` or `scale` rather than `transform`; and
it never composites `stroke-dasharray`, which is what the Material arc animates in both Ionic and
Quasar — so the
spinner stalls exactly while the main thread is busy. react-native-web's `ActivityIndicator` rotates
a static dashed circle with `transform` on a wrapper, and Tailwind's `animate-spin` keyframes are
`transform` too, so the idiomatic hand-written spin survives; the iOS spoke fade and the Material arc
are where it breaks. Third, and spec rather than engine: SVG children rotate around `0 0` unless the
origin is pinned (Quasar's `QSpinner.sass` says so in a comment). **A determinate `ProgressBar` does
not pass on its own**: Ionic and Konsta both draw it as a composited `scaleX`/`translateX` with a
class or `document.dir` for RTL, which leaves `role="progressbar"`, `aria-valuenow` and utilities the
consumer already has; the indeterminate bar carries the spinner's two engine facts and belongs in the
same module.

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

**`Badge`, `Chip` and `Avatar` fail the admission test** (read from source 2026-09-13), so they stay
unbuilt unless a quirk is measured. `Badge` is CSS in all three kits that ship it — Ionic's is
`inline-block`, `line-height: 1` and `:empty { display: none }` (its `badge.ios.scss` also opts the
size into Dynamic Type with `dynamic-font-min`, a quirk `Text` already owns), Framework7's iOS sheet is
empty, Konsta's is `inline-flex rounded-full leading-none min-w-5` placed with `-end-1.5 -top-0.5` —
and every rule, the logical offset included, is a utility the consumer already writes; the badge with
platform weight is the tab bar's, which is Tier 3. `Chip` is a rounded pressable: the press, the
haptic and the `touch-action` longhand are `Button`'s, sticky hover is already fixed by the `hover:`
variant, and a filter chip is `aria-pressed` on a `Button`. `Avatar` is `rounded-full` on an image,
and every quirk an image has — load and error state, layout-shift reservation, the iOS callout — is
already owned by `Image` with `Image.Error` for the initials.

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
([`../design/image.md`](../design/image.md)), `Fab` (Tier 4 above), `Pressable`, `Offline`,
`BootError`, `UpdateRequired`, `OrientationGuard`, `EdgeSwipeGestures`, `PwaSplashOverlay`,
`UiNotFound`.
