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

`Select`/`Picker` (the *menu* appearance, not just the wheel) · grouped-settings form
(`FieldGroup` / `ion-list inset`) · `Icon`.

**A real `Select` is the clearest hole in the form-control set** — adaptv has button / input /
textarea / checkbox / switch / slider and stops. `WheelColumn` is a partial `Picker`.

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

Also already shipped and easy to mis-list as gaps: `Dropdown` (the menu/popover row), `Image` as a
full compound component with a build-time placeholder pipeline
([`../design/image.md`](../design/image.md)), `Pressable`, `Offline`, `BootError`, `UpdateRequired`,
`OrientationGuard`, `EdgeSwipeGestures`, `PwaSplashOverlay`, `UiNotFound`.
