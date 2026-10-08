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

~~`Icon`~~ — Tier 1 is closed.

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

The form-control set now runs button / input / textarea / checkbox / switch / slider / select,
grouped by `FieldGroup`, and `Icon` closes the tier.

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

**`RadioGroup` shipped** (`src/components/radio-group.tsx`, lab page `/lab/radio-group`), on the two
quirks it owns. **Radios are keyed on `name`** within one document or form, so each instance with no
`name` takes an id-derived one and two mounted groups never clear each other; an explicit `name` is
kept for form submission. **A clipped `sr-only` input is a speck-sized accessibility frame** on iOS
Safari (PR #132 measured it on `Switch` and `Checkbox`), so each native radio lies invisibly over its
whole item. Everything else is the browser's radio: arrow keys, Space, disabled options, `required`
and `FormData`. Selection is the input's `change` event rather than the gesture engine's release,
because a radio's activation is idempotent and every non-pointer path (arrow keys, assistive tech,
an outer label) arrives as a click no press produced. Measured and left native, in
`playground/e2e/radio-group.spec.ts`: past the last radio Chromium wraps and WebKit stops; under RTL
Chromium flips ArrowLeft/ArrowRight and WebKit does not; WebKit's default Tab order skips radios.

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
`/lab/progress-bar`), because a determinate bar alone owns one quirk (forced colors, below), short
of the two the admission test asks, and the indeterminate one adds the spinner's two. `value` is
`0..1`, clamped; omitted, or not a finite number, it is indeterminate. It reuses the spinner's
machinery rather than a copy: the shared observer pauses an off-screen sweep (100 bars: 0–2 frames
per 2 s against 241–242 with the pause forced off, Chromium, CDP trace), the label goes through the
same announcer, and reduced motion is the same pulse. **Motion is `transform` only:** the fill is
`scaleX` and the sweep `translateX`. Across a fill transition, the layout width stays constant on
both engines, and Chromium traces 0 layouts and compositeFailed 0. A `width` fill, tried as a
mutant, laid out 23 times. **It owns one quirk the spinner never had: forced colors repaint a CSS
background.** Without its opt-out the fill reads `Canvas` and vanishes, so the indicator paints
`CanvasText`. **RTL** flips the origin and the sweep together, read from one `dir="rtl"` selector on
the bar or an ancestor, with the parts placed physically. Placing them with `inset-inline-start`
would read the element's own direction instead and, wherever the two disagree, start the sweep
halfway across the track. An ltr island inside RTL therefore draws RTL, and CSS `direction` without
the attribute draws LTR. Ionic's `buffer` and `reversed` are not built.

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
`adaptv/components`) and passes the two-quirk test with room to spare. iOS WebKit ignores a
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
