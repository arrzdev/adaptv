# adaptv — the styling & theming contract

> **How a consumer customises the look of adaptv primitives.** The framework's most-touched surface,
> and until now the only major one with no decision written down: `VISION.md §9` listed "Styling
> system" as open, while `src/utils/styles.ts` had already shipped a precedence contract that, at the
> time, only 2 of the then-19 components actually used (bug **B8**, closed 2026-07-29 — see §2).
>
> Decided **2026-07-20**, informed by a source-level study of Ionic's `--ion-*` system, Ark UI/Zag's
> `data-scope`/`data-part` model, and Tailwind v4's `@theme`.

---

## 0. The decision in one paragraph

**adaptv has no CSS-variable theming system, and that is deliberate.** Look is `className` +
tailwind-merge, with a three-layer precedence contract every primitive must use. State is exposed as
`data-*` attributes on a two-axis `data-adaptv` / `data-part` namespace, so a consumer can restyle
globally from plain CSS without importing a single class name. Custom properties are reserved
*exclusively* for values that must cross the JS→CSS boundary at runtime (insets, keyboard height).
Cascade layers guarantee consumer styles win without `!important`. **Design tokens are the
consumer's Tailwind `@theme` — adaptv ships no palette.**

---

## 0.1 🔒 Tailwind is a hard requirement, and that is now an explicit decision

Decided **2026-07-28**. The doc previously *implied* this (§7 makes the consumer's `@theme` the token
system) without ever stating it, so it was an assumption rather than a decision. It is now the
latter, and the alternative was considered and rejected.

**adaptv does not work without Tailwind v4 in the consumer's build.** Not "looks unstyled" — *does not
work*. Three separate couplings, worth knowing individually because they fail differently:

1. **Primitives emit Tailwind utilities for structure**, not just decoration (`inline-flex`,
   `shrink-0`, `overflow-*`, the `clickable` `touch-action` longhand). Uncompiled, those class names
   generate no CSS and the primitive is structurally broken.
2. **`patches.css` and `utils.css` use Tailwind at-rules** (`@custom-variant`, `@utility`, `@source`).
   A non-Tailwind bundler passes them through as unknown at-rules and the browser **ignores them
   silently** — the plain-CSS patches (autofill, scrollbar, iOS callout) survive, the `hover:` fix and
   every `@utility` vanish with no error. Silent partial failure is the worst mode; say so in the
   quickstart.
3. **`index.css` declares `@source "../**/*.{ts,tsx}"`** — adaptv instructing the consumer's Tailwind
   to scan adaptv's own source. This also couples the styling layer to **shipping as source**: the
   `exports` map points at `./src/interface/*.ts` today, and the deferred `dist` cutover must move
   this path with it or every internal utility silently stops being generated.

### The positive reason: build-time rewriting is a capability, not ergonomics

The decisive argument is **not** cost-avoidance — it's that a `@custom-variant` lets adaptv ship a
cross-platform correctness fix that applies **automatically to idiomatic consumer code the consumer
already writes**, with nothing to remember. `hover:` is the worked example:

```css
@custom-variant hover {
  @media (hover: hover) {
    &:hover:not(:is(:focus, :focus-within)) { @slot; }
  }
}
```

A consumer writes `hover:bg-muted` as they always would, and it compiles to a rule that cannot stick
after a tap on touch and cannot beat a focus ring. **There is no CSS mechanism for this** — `:hover`
cannot be redefined, so in raw CSS the guard has to be hand-written at every call site, which means
it will be missed. Build-time rewriting is the only delivery vehicle, and it generalises: any
cross-platform quirk expressible as a variant override or an `@utility` becomes free for every
consumer. That is a category of leverage worth paying a peer dependency for.

**Two honest limits on it**, both of which belong in the quickstart:

- **The fix covers `hover:` utilities, not `:hover` anywhere.** A consumer who writes
  `.card:hover { … }` in their own stylesheet — still possible under this decision — gets stock
  behaviour. Coverage tracks how much of their hover styling stays in utilities.
- **Only the `:not(:is(:focus, :focus-within))` half is adaptv's.** Tailwind v4 already compiles
  `hover:` inside `@media (hover: hover)` by default (verified in `tailwindcss@4.2.4`
  `dist/chunk-3IR7ZFJX.mjs`). Overriding the variant *discards* that, so adaptv must re-supply the
  media query — it is required, not redundant — but the sticky-hover fix is Tailwind's, not ours, and
  `patches.css`'s first comment line currently implies otherwise.

**The rejected alternative** was moving structural classes into real CSS in `@layer adaptv.components`
keyed on the `data-adaptv` / `data-part` attributes §3 already mandates. That would have made
correctness Tailwind-independent (a SCSS-only consumer imports `styles.css`, gets working components,
overrides with unlayered CSS and no `!important`) and demoted Tailwind to ergonomics. Rejected for now
on cost — a per-component rewrite, plus shipping a whole stylesheet instead of tree-shaken utilities —
and because it would forfeit the leverage above for the primitives it touched.

> **Revisit as an *additive* path, not a replacement**, if a non-Tailwind consumer ever becomes a
> target: core in the layer, utilities still emitted for Tailwind consumers. Nothing in §2–§7 changes
> under that model; the variant-delivered fixes simply stop reaching the non-Tailwind tier, which is
> an accepted downgrade rather than a regression.

### What follows, and is therefore non-negotiable

- **`tailwindcss`, `tailwind-merge`, `clsx` are `peerDependencies`** — they
  already are, which is the correct shape now that this is a requirement rather than an internal
  choice. ⚠︎ They are pinned **exact** (`4.2.4`); for a required peer that means a consumer on
  `4.2.5` gets an install failure. Widen to a caret range unless an exact pin is load-bearing.
- **The requirement is stated in the quickstart.** The `@layer` statement §6.0 describes is **no
  longer the consumer's job** — the Vite plugin injects it (§6.0.2). What the quickstart must state
  instead is that `adaptv()` comes **before** `tailwindcss()` in `vite.config.ts`.
- **§5.5's `extendTailwindMerge` rule is permanent and load-bearing.** Every new `@utility` must be
  registered in `cn.ts` with its conflicting groups, or `locked` silently stops being a guarantee for
  that property — see the `scrollable-y` case documented in `cn.ts`.
- **Structural classes go in `locked`** (§2), which is now the whole of bug **B8**'s remedy — there is
  no CSS-layer alternative path to weigh against it.

---

## 1. Why not Ionic's model (the `--ion-*` system)

Ionic is the closest prior art and the obvious thing to copy. **Copying it would be a mistake, and
the reason is structural.**

Ionic's ~12 CSS custom properties *per colour* (`--ion-color-primary` + `-rgb`, `-contrast`,
`-contrast-rgb`, `-shade`, `-tint`), its generic-indirection layer (`.ion-color-X` sets
`--ion-color-base`, which shadow-root CSS reads via `current-color()`), and its per-component
property surface (`ion-button` alone exposes **23**: `--background`, `--background-activated`,
`--padding-start`, `--ripple-color`, …) all exist to solve **one** problem: *Ionic's components are
Web Components with `shadow: true`, so ordinary CSS selectors cannot reach inside them.* Custom
properties and `::part()` are the only two things that cross a shadow boundary.

**adaptv renders light DOM React components. It has no shadow boundary.** A consumer's
`.my-app button { … }` already reaches every element adaptv renders. Adopting Ionic's model would buy
nothing and cost:

- **The "Alpha Problem" tax.** `var()` can't be nested inside `rgba()`, so Ionic ships a parallel
  `-rgb` twin for every colour — doubling the token surface. Ionic's own advanced-theming docs
  concede this as a design wart.
- **The maintainer-curated dead-end.** Ionic's single most-upvoted styling complaint is *"no CSS var,
  no part, shadow DOM sealed"* — [#24283 "expose every single thing as shadow part"](https://github.com/ionic-team/ionic-framework/issues/24283):
  *"Please don't force us to write JS to apply CSS styles."* Consumers cannot add parts; they must
  request each one and wait. `::part()` also **cannot chain** (`::part(a)::part(b)` is invalid) and
  rejects structural pseudo-classes.
- **Even Ionic's non-shadow tier surprises people.** [#17425](https://github.com/ionic-team/ionic-framework/issues/17425)
  documents `scoped: true` components silently ignoring consumer overrides, forcing `!important`.

> 🔒 **Decision: no `--adaptv-color-*` palette, no `::part()`, no per-component custom-property API.**
> adaptv's light-DOM rendering is a genuine advantage over Ionic here — spend it, don't re-import the
> constraint that forced Ionic's design.

**What *is* worth stealing from Ionic** — the `var(--specific, var(--generic, literal))` fallback
chain (§4), and the `.ios`/`.md` mode-class idea, which adaptv already has in better form as a
pre-paint `data-adaptv-platform`/`data-adaptv-os` stamp (§5).

---

## 2. 🔒 Layer 1 — `className` with three-layer precedence (mandatory)

The contract already exists in `src/utils/styles.ts` and is hereby promoted from an accident to the
rule:

```ts
mergeStyles({ base, className, locked })   //  base  <  className  <  locked
```

| Layer | Owner | Meaning |
|---|---|---|
| `base` | adaptv | The neutral default look. **Fully overridable.** |
| `className` | consumer | Overrides `base`. The primary customisation surface. |
| `locked` | adaptv | Structural / cross-platform-correctness classes. **Wins over both.** |

Precedence rides on tailwind-merge's last-wins conflict resolution, including adaptv's custom class
groups registered via `extendTailwindMerge` (`scrollable-*`, `clickable`/`non-clickable`, and adaptv's
own `*-safe` / `*-safe-offset-*` / `*-safe-or-*` families folded into the standard padding, margin and
inset groups — so `View safe="bottom"` beats a stray consumer `pb-0`).

> ✅ **Bug B8 is closed.** Every primitive now routes through `mergeStyles`, and one with nothing
> structural passes `locked: undefined` **explicitly**, so the omission reads as a decision.
> `src/components/style-precedence.test.tsx` asserts both halves on every primitive — a class that
> must win *and* a class that must lose — because the failure is silent in both directions: forgetting
> `locked` looks fine until a consumer's `touch-none` strands a gesture on iOS, and over-locking looks
> fine until someone cannot restyle it and files a bug adaptv cannot fix from their side.
>
> The migration paid for itself immediately: it exposed that `WheelColumn` shipped
> `"scrollable-y overscroll-contain"`, and since `overscroll` is a registered conflicting group of
> `pwa-scroll-behavior`, tailwind-merge dropped `scrollable-y` **entirely** — the wheel had no
> `overflow-y: auto` at all. That is §5.5's rule failing inside adaptv's own code.

### 2.1 The inline-style tier

`mergeStyles` merges **both** channels, because inline `style` is its own cascade origin and beats
every author stylesheet at any layer or specificity — so a `data-*`-keyed CSS rule (the escape hatch
below) does *not* protect against it:

```ts
mergeStyles({ base, className, locked, baseStyle, style, lockedStyle })
// class → cn(base, className, locked)
// style → { ...baseStyle, ...style, ...lockedStyle }
```

Object spread gives exact last-wins semantics **per property**, so unlike the class path there is no
conflict-group registry to keep in step — strictly more reliable than `cn`, for the reason the
`WheelColumn` bug above demonstrates. The return type is conditional: `string` when only class layers
are named, `{ className, style }` the moment any style layer is *named* (even as `undefined`).

**Two honest limits.** It is not a security boundary — a consumer holding a `ref` can always assign
`el.style.*`, exactly as they can always write an unlayered `!important` against the class tiers; the
contract makes the *accidental* case impossible, not the deliberate one. And for properties the
gesture engine writes per frame directly to the node, a consumer's inline value loses to a **race**,
not to this contract; the clean channel there is §3.2 (engine writes a custom property, a layer rule
consumes it).

**The escape-hatch rule (learned from Ionic #24283):** when behaviour must be untouchable, do **not**
express it as a class the consumer can fight — express it as a **prop → `data-*` → CSS rule**, so
there is no class to lose to. `locked` covers *soft*-structural look only.

---

## 3. 🔒 Layer 2 — `data-*` state, on a two-axis namespace

adaptv already exposes state this way ad hoc: `data-pressed` (the reentrant press engine, since
native `:active` can't be cleared from JS and won't re-light on touch re-entry),
`data-keyboard-open`, `data-caret-muted`, `data-press-engine`,
`data-adaptv-splash`, `data-app-shell`. **Formalise it**, adopting Ark UI/Zag's two-axis idea:

```html
<div data-adaptv="drawer" data-part="content" data-state="open" data-side="bottom">
```

- **`data-adaptv="<component>"`** — the scope (kebab-case).
- **`data-part="<part>"`** — the sub-element (kebab-case).
- **`data-<state>`** — presence or value: `data-state="open|closed"`, `data-pressed`,
  `data-disabled`, `data-side`, `data-keyboard-open`.

Why this and not class names: a `(scope, part)` coordinate pair lets a consumer theme an entire
design system **from global CSS, without importing anything or touching a component file** — the
thing Ark can do and Radix structurally cannot (Radix parts carry no intrinsic identifying
attribute; you must supply your own `className`).

```css
/* restyle every drawer in the app, no imports, no wrapper components */
[data-adaptv="drawer"][data-part="content"] { border-radius: 20px 20px 0 0; }
[data-adaptv="drawer"][data-part="content"][data-state="open"] { box-shadow: …; }
```

And it composes with Tailwind's arbitrary variants for the local case:

```tsx
<Button className="data-[pressed]:scale-95 data-[disabled]:opacity-40" />
```

> **Rule: every stateful primitive exposes its state as `data-*`. State is never encoded in a class
> name adaptv owns**, because a class name is something the consumer's `className` can collide with,
> and an attribute isn't.

### 3.1 🔒 Boolean attributes, not `data-state="…"` — two independent reasons

The ecosystem is genuinely split. Radix and Ark multiplex state into one attribute (`data-state="open"`);
**Base UI and React Aria split it into independent booleans** (`data-open` / `data-closed`). adaptv takes
the second, because two separate lines of evidence point the same way:

**1. A shared flat `data-state` namespace does not survive composition.** Compose a tooltip trigger and a
dialog trigger on one element and *both* write `data-state` — one silently wins.
[Radix #602](https://github.com/radix-ui/primitives/issues/602) has been open since **April 2021**,
labelled *"Has Workaround"*, still unfixed. This is the single clearest design lesson available.

**2. Valueless attributes are strictly more ergonomic under Tailwind v4.**

```
data-[state=open]:animate-in   ← Radix: bracketed arbitrary-variant syntax
data-open:animate-in           ← bare, works natively in v4
```

**And namespace per component** — `data-drawer-open`, not a shared `data-open` — or reason (1) comes
back the first time someone composes two adaptv triggers.

**Adopt verbatim where three libraries already agree** (no reason to invent): `data-disabled`,
`data-orientation`, `data-highlighted`, `data-side`, `data-align`, `data-placeholder`, `data-invalid`,
`data-required`, `data-readonly`, `data-selected`, `data-dragging`.

**The `data-adaptv`/`data-part` call in §3 is independently validated.** Zag generates
`data-scope`/`data-part` from its anatomy; **shadcn re-derived the identical idea as `data-slot`** —
because its components are *copied into your repo*, so edited classNames give a parent nothing stable
to target. Two systems arriving at the same primitive from opposite directions is about as strong a
signal as design research produces.

### 3.2 🔒 Measured scalars are CSS variables — unprefixed when local, prefixed when global

The split every library converged on: **enumerable state → data attribute; measured scalar → CSS
variable.** Four reasons a class can't do the job — the value space is continuous (`473.5px`), it's
computed post-layout *in the same frame* (a class means a React round-trip between measure and paint —
a visible flash), custom properties **inherit** so the measuring element and the consuming element can
differ, and they compose inside `calc()`.

**Unprefixed for component-local scalars.** Base UI and Zag independently landed on
`--available-height`, `--anchor-width`, `--transform-origin`; only Radix prefixes, and its own
internals show why it regretted it — five real vars in `popper.tsx`, then a per-component alias layer
on top. adaptv follows Base UI/Zag for anything scoped to one component's subtree.

**🔒 Prefixed for the global contract variables** — amended **2026-07-29**. Base UI and Zag reasoned
about *component-local* scalars, where the declaring and consuming elements are one subtree apart and
a collision is nearly impossible. A variable published on `:root` and read app-wide is a different
risk: `--safe-bottom` and `--keyboard-height` are generic enough that a consumer plausibly owns names
like them already, and a silent collision there breaks layout globally rather than in one component.

So `--adaptv-inset-{top,right,bottom,left}`, `--adaptv-keyboard-height` and
`--adaptv-ring` carry the prefix; a `Drawer`'s own measured content height does not. **The test is
scope, not importance.**

**The unknown-height animation trick, worth porting verbatim** (Radix `collapsible.tsx`): suppress
animation → force layout → measure → restore animation → publish as a var.

```ts
node.style.transitionDuration = '0s'; node.style.animationName = 'none';
const rect = node.getBoundingClientRect();          // now measurable at full size
node.style.transitionDuration = original.transitionDuration;
node.style.animationName = original.animationName;
// → style={{ ['--adaptv-drawer-content-height']: `${height}px` }}
```

Support `'auto'` as a value (Base UI does; Radix doesn't). Note this forces a synchronous layout read
per open/close — a real if small jank source, and the thing `interpolate-size: allow-keywords` will
eventually obsolete (Chrome 129+ only today — see `docs/decisions/animation.md §2`).

### 3.3 🔒 `render` prop over `asChild`, with a tailwind-merge-aware default

**`asChild` has four failure modes, all evidenced** — 36 issues in `radix-ui/primitives` with `asChild`
in the title. It requires exactly one child; it needs `Slottable` as an escape hatch when the component
has its own children (icons); `cloneElement` can't inspect an RSC element
([#3165](https://github.com/radix-ui/primitives/issues/3165)); and in Radix's merge the **child clobbers
the primitive** for any prop present on both — set `type` or `role` on your child and you silently
override the primitive's value.

A `render` prop is a *prop, not a child*, so the single-child rule and the `Slottable` workaround simply
don't exist. Its function form receives `(props, state)` and can render state-dependent *content*, which
`cloneElement` structurally cannot. And Base UI's `preventBaseUIHandler()` lets a consumer **cancel** the
library's handler — Radix has no equivalent, which is a genuine capability gap, not a style preference.

**⚠︎ The trap that affects `mergeStyles` directly: no library resolves Tailwind conflicts on composition,
and they concatenate in *opposite* orders.** Radix does `[slot, child].join(' ')` → under `twMerge` the
**child** wins. Base UI puts the `className` prop *after* the render element's → the **prop** wins. Both
land both classes in the DOM and let stylesheet source order decide, which is arbitrary from the author's
seat.

> **🔒 So adaptv makes a tailwind-merge-aware merge the *default*, not an opt-in.** Radix only just added
> `SlotProvider mergeProps` as a pluggable strategy — right shape, wrong default, since every consumer
> ends up writing `cn()` anyway. `mergeStyles` (§2) already is that function; the composition path must
> route through it too, not through naive concatenation.

---

## 4. 🔒 Layer 3 — custom properties, for runtime values *only*

Custom properties are the **JS→CSS transport**, never the theming API. Legitimate uses are values
CSS cannot compute for itself:

| Property | Set by | Why it must be a variable |
|---|---|---|
| `--adaptv-inset-{top,right,bottom,left}` | `safe-area.css`, resolving the contract | the value space is continuous, and it must compose inside `calc()` |
| `--safe-area-inset-*` | Capacitor `SystemBars` on Android | the **input** to the contract above, injected with no event — `env()` reads 0/wrong in Android WebView (`crbug/40699457`) |
| `--adaptv-keyboard-height` | `useKeyboard` | the real OS keyboard height, not a `visualViewport` guess |
| `--pwa-launch-height` | `getLaunchViewportInitScript()`, put back by `restoreLaunchHeight()` after a client root clears `<html>` | freezes resolved `100vh` against the iOS standalone cold-start ICB expansion; lowered, never raised, to `innerHeight` + the top inset if that reads less at head or at a `resize` before the splash is revealed (iOS 26) |
| `--viewport-cover-bleed` | critical CSS | launch-overscan bleed |

Use Ionic's fallback-chain idiom so a consumer override cascades without recomputation. The
`var()`-before-`env()` ordering is the inverse of what most people write, and it is a **🔒 locked
contract** (`docs/decisions/register.md §6.0`, B18) — Capacitor's injected variable must win, with `env()` only as
the fallback:

```css
--adaptv-inset-top: var(--safe-area-inset-top, env(safe-area-inset-top, 0px));
```

**Every one of these is always defined**, at rest as `0px`. An absent variable forces each call site
to remember `var(--x, 0px)`, and the one that forgets breaks the whole `calc()`.

### 4.1 The third category — properties adaptv *reads* but never *defines*

`--adaptv-ring` (the `:focus-visible` outline colour, §D) is neither of the two things this doc
recognises. It is not JS→CSS transport — no JS writes it. It is not the rejected theming API of §1 —
adaptv ships no value for it, and the rule below still holds.

It is a **declared extension point**: adaptv consumes it with a literal fallback
(`var(--adaptv-ring, currentColor)`), so it works with the consumer defining nothing, and defining it
is the one-line fix for the case where the fallback is wrong (`currentColor` on a filled button gives
a light ring that washes out against a light page).

🔒 The constraint that keeps this from becoming §1's rejected model: **an extension point must have a
working literal fallback, and there must be very few of them.** The moment adaptv *needs* a consumer
to define one, it has shipped a token surface by the back door. Two is the ceiling worth having.

> **Do not** add `--adaptv-color-*`, `--adaptv-radius-*`, `--adaptv-spacing-*`, or per-component
> properties like `--drawer-padding-start`. That is §1's rejected model.

---

## 5. 🔒 Layer 4 — variants: the complete, closed list

Variants are the one part of the surface that is **not discoverable** — a hook shows up in
autocomplete, a variant appears nowhere. That is only acceptable with a single canonical list, and
this is it. **Six, and the set is closed.**

They split into two categories, and the split is the rule for whether a seventh ever gets added:

### Corrections — the consumer never learns these

They rewrite the meaning of code the consumer already writes. There is nothing to import and no name
to remember; existing `hover:bg-muted` simply becomes correct. **No hook can do this**, because there
is nothing to call — build-time rewriting is the only delivery vehicle, and it is the concrete reason
Tailwind is a hard requirement (§0.1).

| | What it fixes |
|---|---|
| **`hover:`** | `&:hover:not(:is(:focus, :focus-within))` inside `@media (hover: hover)`. The media query is Tailwind v4's own default, which overriding the variant *discards* — so adaptv must re-supply it. Ours is the `:not(…)` half: hover must not beat a focus ring. |
| **`active:`** | Two branches — `&[data-pressed]` for engine-driven elements, `&:active:not([data-press-engine])` for everything else. The gesture engine stamps `data-press-engine` so a consumer's plain `<button className="active:scale-95">` keeps native `:active` and does not silently stop working. Native `:active` cannot be cleared from JS and will not re-light on touch re-entry, which is why engine elements must not use it. |

### State — the consumer must know these exist

| | Meaning |
|---|---|
| **`app:`** | installed PWA (`display-mode: standalone`) **or** a native Capacitor build. The attribute branch is load-bearing: a native WebView reports `display-mode: browser`, so a media query alone misses it. |
| **`web:`** | a real browser tab only. Attribute-scoped for the same reason. |
| **`dark:` / `light:`** | the pre-paint theme stamp. |

### What is deliberately absent

- **`pressed:`** — removed. It was pure sugar over Tailwind v4's built-in `data-pressed:`, and having
  `pressed:` *and* `data-pressed:` *and* a hook is three ways to do one thing. Folded into `active:`.
- **`ios:` / `android:`** — not added. The value is static for the session, so a hook returns a
  constant with no subscription and **zero re-renders after mount**; the performance argument that
  justifies `app:`/`web:` does not apply, and `[data-adaptv-os="ios"] &` covers the CSS case.
- **Negations** (`keyboard-closed:`, …) — never. Tailwind v4's `not-*` composes with any variant, so
  shipping the inverse of every boolean doubles the surface for zero capability.

### The rule for adding a seventh

> **Does it fix code the consumer already wrote, or expose state they could read?**
> Fixes are invisible and belong here. State is importable and belongs in a hook, a prop, or the
> documented `data-*` attribute — which is also visible in devtools, and therefore more discoverable
> than either.

The primitives are the real answer for most of this: if `View safe="bottom"`, `<Pressable>` and
`<Image>` cover the common cases, the consumer never reaches for a variant at all. Progressive
disclosure, not two parallel APIs.

This whole layer is strictly better than Ionic's `.ios`/`.md` mode classes: it is pre-paint (no FOUC,
no hydration mismatch), and it separates *platform* from *installation context*, which Ionic conflates.

---

## 5.4 🔒 A knob is a prop. A class may only extend a vocabulary the consumer already has

Added **2026-07-30**, after `ScrollView`'s fade depth shipped as a class and was pulled back.

§2 says presentation is `className`. That is about letting a consumer *repaint* things — it is not a
licence to push **component parameters** out of the typed interface. The two get confused easily, and
the rule that separates them:

> A class is acceptable when it extends a vocabulary the consumer already has. It is wrong when the
> name is one only adaptv knows.

- `pb-safe-offset-2` ✅ — it is `pb-*`, extended to the safe area. Nothing to discover; nobody argues
  `pb-2` should be a prop.
- `edge-fade-10` ❌ — a name adaptv invented, for a knob on one component. It is now `fadeSize`.

**Two failure modes it prevents, both of which actually happened.**

*Guessing.* The point of a typed component interface is that nothing has to be looked up. A consumer
should not have to learn that the fade is a mask, let alone that the mask reads `--fade-length`.
Offering the variable as a documented "escape hatch" is the same defect wearing a nicer name.

*Two channels for one knob.* `fadeSize` and `edge-fade-*` briefly shipped together, and the prop won
every time — an inline custom property is its own cascade origin — so `fadeSize` beside
`md:edge-fade-12` sat at the prop's value and the breakpoint read as broken. A caveat in the docs is
not a fix for that; one channel is.

Note the prop **cannot** dodge the conflict by emitting the class instead: Tailwind's JIT only compiles
names it finds in a source scan, and one built at runtime from a prop is never in one — it emits no
rule and silently does nothing.

**Known, deliberate exception:** `selectable` is an adaptv-invented name and only `Text` exposes it as
a prop; elsewhere it is the class. Reviewed 2026-07-30 and left alone — adding it to `View`,
`ScrollView` and friends is more public surface than the inconsistency costs. Revisit if it bites.

---

### 5.4.1 🔒 Do not invent a utility Tailwind can already spell

Amended **2026-07-30**. adaptv shipped `clickable`, `non-clickable`, `scrollable`,
`scrollable-x` and `scrollable-y`. All five are gone; the call sites write raw Tailwind.

**A custom utility is not free — it costs a conflict table.** tailwind-merge resolves by
GROUP, and a group it has never heard of conflicts with nothing. So every invented
utility had to declare, by hand, every property it expanded to; `cn.ts` carried a
`conflictingClassGroups` block naming `overflow`, `overflow-x`, `overflow-y`, `touch`,
`overscroll`… kept in step with the CSS by memory. The entry nobody wrote was `cursor`,
so `cn("non-clickable", "cursor-wait")` emitted **both** and Tailwind's print order
picked the winner — the consumer's, by luck, and silently the other way round the day
that order changes.

**And it hides a bundle.** `clickable` was `touch-action` *and* `cursor: pointer` in one
class, applied as `locked`. Locking the touch longhand is correct (WebKit 240917); locking
the cursor was an accident of packaging, and it made `cursor-wait` on a pending button
unreachable. Raw utilities cannot bundle, so the tiers had to separate — the touch
longhand `locked`, the cursor `base`, and a consumer's `cursor-*` now wins through
tailwind-merge's own group.

**The bar for a new utility**, and the three that still clear it: the property has no
Tailwind equivalent at all. `scrollbar-hidden` / `scrollbar-visible` (`scrollbar-width` +
`::-webkit-scrollbar`) and `selectable` (the opt-in against the app-wide reset) stay.
Anything expressible as `overflow-y-auto touch-pan-x …` is written that way, at the call
site, where tailwind-merge already knows how to resolve it.

---

## 5.5 ⚠︎ Correction — how class conflicts *actually* resolve in Tailwind v4

An earlier draft of this doc implied "the consumer's `className` wins." **That is false in Tailwind v4**, and the correction matters because `mergeStyles` depends on understanding why.

Tailwind emits every utility into one sorted `@layer utilities` block. **The order of classes in the `class` attribute is irrelevant** — it's just a token bag for the scanner. Verified by compiling:

```
input:  "p-8 p-2 p-4 pt-1 px-3 m-9 m-1 text-sm text-2xl rounded-none rounded-full"
output: .m-1 .m-9 .rounded-full .rounded-none .p-2 .p-4 .p-8 .px-3 .pt-1 .text-2xl .text-sm
```

Sort is **property group first, then a natural sort of the suffix**. So `p-8` beats `p-2`, `rounded-none` beats `rounded-full`, `text-sm` beats `text-2xl` — **decided by Tailwind's sort, not by who authored the class.** A adaptv `base` of `p-8` would beat a consumer's `p-2`.

**This is exactly why `mergeStyles` is mandatory, not a convenience.** The CSS cascade cannot express "this one, not that one" — so the fix is to **never emit both classes**. `tailwind-merge` resolves conflicts in JS *before* the string reaches the DOM, keeping the last per conflict group. Tailwind's own docs concede the point: *"you should just never add two conflicting classes to the same element."*

Two consequences for adaptv:

- **`tailwind-merge` v3 is the Tailwind-v4-compatible line** (v2.x targets v3). adaptv pins **3.4.0** ✓.
- Any `@utility` family adaptv adds **must** be registered via `extendTailwindMerge`, or `twMerge` won't know the classes conflict. `cn.ts` already does this for `scrollable-*` / `clickable` / the safe-area padding groups — that list must grow with every new utility, and that's now a rule, not a nicety.

## 5.6 🔒 Library tokens use `@theme default`

If adaptv ever ships theme tokens (§7 says it shouldn't ship a palette, but `--spacing`-adjacent or radius defaults may be justified), they go in **`@theme default`**, never plain `@theme`. Verified empirically:

| Import order | lib uses `@theme default` | lib uses plain `@theme` |
|---|---|---|
| app theme **before** lib import | **app wins** | lib wins ❌ |
| app theme **after** lib import | **app wins** | app wins |

`@theme default` makes the app win **regardless of import order**. Plain `@theme` silently clobbers the consumer when imported later. This is what Tailwind itself does — every built-in token in `tailwindcss/index.css` is wrapped in `@theme default`.

Related trap if adaptv ever ships tokens whose value is another `var()` the consumer re-scopes (e.g. `.dark`): you need `@theme inline`, because `var()` resolves in the scope where the *variable is declared*, not where it's used. This is the bug shadcn/ui's `@theme inline` block exists to avoid.

---

## 6. 🔒 Cascade layers — the fix for the `!important` problem

### 6.0 ⚠︎ The import-order trap that must not be shipped

**If a library's CSS containing `@layer utilities { … }` is imported *before* `@import "tailwindcss"`, the cascade layer order inverts.** Per the CSS spec, layer order is fixed by **first mention** — so the library's block registers `utilities` first, and the effective order becomes `utilities, theme, base, components`. Preflight then overrides every utility in the app.

adaptv's `src/styles/index.css` is imported *by* the app after Tailwind, so it's correct today — but this must be **documented as a hard requirement**.

**And it's worse than "import order matters," in a way that's easy to get wrong.** Layer order is fixed by **first occurrence**, and a layer name that appears for the first time in a *later* statement is **appended to the end** — not inserted where it's written. So a consumer who tries to place adaptv's layer explicitly:

```css
@layer theme, base, components, utilities;          /* Tailwind emits this */
@layer theme, base, adaptv, components, utilities;   /* consumer "inserts" adaptv */
```

…gets `adaptv` **after `utilities`**, where it beats every Tailwind utility — the exact opposite of the intent, and it looks like a adaptv bug. Verified empirically.

The fix is spec-sanctioned: `@layer` statements are among the only rules allowed **before `@import`**. So the consumer's entry stylesheet must open with:

```css
@layer theme, base, adaptv, components, utilities;   /* MUST precede every @import */
@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";
```

This is also the pattern MUI documents for its own Tailwind integration
(`@layer theme, base, mui, components, utilities;`).

#### ✅ 6.0.2 The consumer no longer writes that line — the plugin injects it

Shipping the line as a quickstart copy-paste was the original plan, and it was the wrong shape:
adaptv already generates `capacitor.config.json`, the route tree, the entries, the web manifest and
the service worker, so one line of CSS is the same category of build detail the framework should
absorb. Making it the consumer's job means it is forgotten, and forgetting it looks like an adaptv bug.

**`adaptv:css-layer-order`** (`src/vite/css-layer-order.ts`, `enforce: "pre"`) transforms any CSS
module that imports a Tailwind entry and prepends the statement if it is not already there.
Idempotent — a consumer who wrote it by hand is unaffected.

Two things about it are load-bearing:

- **The plugin must be listed before `tailwindcss()` in `vite.config.ts`.** Tailwind's own CSS
  transforms are *also* `enforce: "pre"`, so relative order is array order, not enforce order. This
  replaced one requirement with another — but the new one **fails loudly**: when no stylesheet
  declares a Tailwind entry, the plugin warns through the same channel as every other adaptv Vite
  plugin, naming the fix. Silent breakage would have been strictly worse than the explicit line.
- **The equivalence was proven from output, not reasoned.** Deleting the hand-written line from the
  playground and rebuilding produced a **byte-identical stylesheet, same content hash**; swapping the
  plugin order reproduced §6.0's inverted layer order exactly, with the warning firing once.

The line still belongs in the docs for contexts the plugin does not run in — Storybook, test
harnesses, anything consuming `styles.css` outside adaptv's build.

### 6.0.1 🔒 adaptv must never use `!important` inside its own layer

`!important` **inverts** layer order: for important declarations the **first** layer wins. So an `!important` inside `@layer adaptv` — declared before `utilities` — becomes the **single strongest author declaration on the page**, unoverridable by anything short of an inline `!important`. That is the precise trap Ionic fell into: its `.ion-color-*` classes carry `!important` on all six generated variables, which is why contextual overrides there are unwinnable.

Three rules follow, and they're absolute:

1. **Everything adaptv emits goes inside `@layer adaptv.*`.** One escaped unlayered rule beats all consumer *layered* CSS.
2. **No `!important` inside the layer**, ever. The only survivors are rules fighting a *UA* stylesheet, which layers can't reach — and those must be justified in a comment.
3. **`:where()` in addition to layers, not instead.** Layers handle the consumer boundary; `:where()` keeps adaptv's own defaults from fighting adaptv's own variants *within* the layer, and rescues consumers who (commonly) put their overrides in the same layer.

Two consumer-facing consequences worth documenting up front, because both will be reported as adaptv bugs:

- **Their own plain CSS beats their own Tailwind utilities** — unlayered beats *all* layers, `utilities` included.
- **`@property` registrations are layer-sensitive too** (the "at-rules ignore layers" folklore is wrong). Put adaptv's registrations in `@layer adaptv.tokens` so a consumer's unlayered `@property` for the same name wins.

Second-order effect, also verified: when library CSS is imported *after* Tailwind, its `.p-2` lands after Tailwind's `.p-8` inside `utilities` — so the **library** wins. **Prebuilt library CSS that reuses stock Tailwind class names is actively hostile to consumers.** adaptv must never ship one.

**This is the one genuinely new mechanism, and it retires a real wart.** `patches.css` currently wins
by brute force:

```css
* { -webkit-user-select: none !important; user-select: none !important; }
* { scrollbar-width: none !important; }
```

`!important` on `*` means a consumer who wants selectable text must out-`!important` adaptv — the
exact specificity war Ionic consumers complain about. Cascade layers make precedence **declarative**:

```css
@layer adaptv.reset, adaptv.patches, adaptv.components, adaptv.utilities;
/* everything the consumer writes is unlayered → beats every layer above, at any specificity */
```

Unlayered styles always beat layered ones, regardless of specificity. So:

- adaptv's resets and patches go in `@layer adaptv.*` and **stop needing `!important` entirely**.
- The consumer's own CSS wins automatically, with no escape hatch to document.
- `:where()` for adaptv's zero-specificity defaults where a layer is too coarse.

`locked` classes (§2) stay outside the layer system — they're tailwind-merge-resolved at the class
level, not the cascade level, which is the correct tool for "same property, competing utilities."

> **Delta:** wrap `patches.css` / `utils.css` / component CSS in `@layer`, and strip the `!important`s
> that exist purely to win the cascade. Keep `!important` only where it fights a *UA* stylesheet that
> layers can't reach.
>
> This also resolves open question **O13** ("are the always-on `patches.css` rules doctrine or
> flags?"): **doctrine, but layered.** They stay always-on because they're the app-feel baseline, and
> they stop being a trap because the consumer can now override any of them with an ordinary rule.

---

## 7. 🔒 Theming = the consumer's Tailwind `@theme`

adaptv ships **no colour palette, no spacing scale, no radius scale.** Tailwind v4's `@theme` already
*is* a design-token system that compiles to CSS custom properties, and the consumer is already using
it. Shipping a second, parallel token layer would mean every consumer maintains two sources of truth.

```css
/* the app's main.css — the ONLY place tokens are defined */
@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";

@theme {
  --color-primary: oklch(0.55 0.22 264);
  --color-background: oklch(0.98 0 0);
  --radius-card: 1.25rem;
}
```

adaptv primitives reference **semantic** Tailwind classes (`bg-background`, `text-foreground`) that
resolve against whatever the consumer defined. `PwaSplashOverlay` already does exactly this
(`bg-background`) — generalise it.

**Modern-CSS bonus adaptv should take, which Ionic cannot:** with no IE11/legacy constraint,
`color-mix()` and OKLCH **eliminate the `-rgb` twin-variable tax entirely**. A shade/tint is
`color-mix(in oklch, var(--color-primary), black 12%)` at use site — no precomputed `-shade`/`-tint`
tokens, no parallel `-rgb` channel. This is a place where adaptv strictly improves on Ionic's API.

**Dark mode** stays as-is: `@custom-variant dark (&:where(.dark, .dark *))` driven by the pre-paint
theme stamp, so there's no flash of the wrong theme before hydration.

---

## 8. What a consumer actually writes

```tsx
// 1. local look — className, merged with correct precedence
<Button className="bg-primary text-white rounded-2xl">Save</Button>

// 2. local state styling — data-attribute variants
<Button className="data-[pressed]:scale-95 data-[disabled]:opacity-40" />

// 3. platform-conditional look
<View className="app:pt-safe web:pt-4" />
```

```css
/* 4. global restyle of a primitive — no imports, no wrappers */
[data-adaptv="drawer"][data-part="content"] { border-radius: 20px 20px 0 0; }

/* 5. override a adaptv patch — plain CSS beats @layer, no !important */
.article-body { user-select: text; }

/* 6. tokens */
@theme { --color-primary: oklch(0.55 0.22 264); }
```

Six mechanisms, each with one obvious job, and **no per-component API surface to memorise or maintain.**

---

## 9. Acceptance (testably done)

- [x] All primitives use `mergeStyles`; `locked` is explicit (bug **B8**).
- [x] A consumer `className` overrides `base` on every primitive; `locked` beats `className` where declared.
- [x] The same holds for the inline-style channel (`baseStyle < style < lockedStyle`, §2.1).
- [x] `View safe="bottom" className="pb-0"` keeps its safe padding.
- [ ] Every stateful primitive emits `data-adaptv` + `data-part` + its state attributes; a global
      `[data-adaptv="…"]` rule restyles it with no imports.
- [x] `patches.css` / `utils.css` / component CSS are wrapped in `@layer`; the cascade-only
      `!important`s are gone; an unlayered consumer rule overrides each of them. One survivor, the
      autofill `-webkit-box-shadow`, fights a UA sheet and is justified in place.
- [x] The variant list is closed at six and documented in one place (§5).
- [x] The consumer writes **no** `@layer` line — the `adaptv:css-layer-order` Vite plugin injects it
      (§6.0), and warns when it can find no stylesheet to inject into.
- [x] adaptv owns its safe-area utilities; `tailwindcss-safe-area` is not a dependency.
- [ ] adaptv defines **zero** colour/spacing/radius tokens; primitives reference semantic Tailwind
      classes that resolve against the consumer's `@theme`.
- [x] No `::part()`, no shadow DOM, no `--adaptv-color-*` anywhere in the codebase.
- [x] No primitive ships a default border width — guarded by inverted tests, with the reasoning in
      `VISION.md §2.1` and a `⚠︎ Do NOT re-add` note in each primitive.

---

## 10. Where this sits

- `VISION.md §9` — "Styling system" open question is **closed by this doc**; §2 principles 1–2
  (correct-by-construction, behavior-is-props) are the doctrine it implements.
- `docs/design/architecture.md §1.2` — `View`'s "behavior is props, look is className" is the canonical example.
- `docs/design/behaviors.md §6` — the tailwind-merge safe-area class-group registration.
- `docs/decisions/register.md §3.1` — the conflict this doc resolves; **O1 closed**, **O13 closed**.
