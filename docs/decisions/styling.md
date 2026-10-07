# adaptv — the styling & theming contract

> **How a consumer customises the look of adaptv primitives.** The framework's most-touched surface,
> and until now the only major one with no decision written down: `VISION.md §9` listed "Styling
> system" as open, while `src/utils/styles.ts` had already shipped a precedence contract that, at the
> time, only 2 of the then-19 components actually used (bug **B8**, closed 2026-07-29 — see §2).
>
> Decided **2026-07-20**, informed by a source-level study of Ionic's `--ion-*` system, Ark UI/Zag's
> `data-scope`/`data-part` model, and Tailwind v4's `@theme`.
>
> **Revised 2026-10-05 (O24, register L24): Tailwind is no longer required.** §0, §0.1, §2, §3.3, §5,
> §5.4.1, §6, §7, §8 and §9 describe the new contract. ⏳ **The code catches up in two PRs** (TUD-221):
> the components move to layered CSS first, then `cn`, `mergeStyles` and the Tailwind peers leave and
> `@arrzdev/adaptv/tailwind.css` ships. Until both merge, `src/` still follows the 2026-07-28 contract,
> which is in this file's git history.

---

## 0. The decision in one paragraph

**adaptv has no CSS-variable theming system of its own, and works with any CSS.** A primitive's
default look is plain CSS in `@layer adaptv.components`, keyed on the `data-adaptv` / `data-part`
attributes every primitive carries; the consumer's `className` wins over it through the cascade, in
any dialect, with no `!important` and no class merging. What a consumer must not be able to undo by
accident is an inline style the primitive sets last (`locked`, §2). State is exposed as `data-*`
attributes, so a consumer can restyle globally from plain CSS without importing a single class name.
Custom properties are reserved for values that cross the JS→CSS boundary at runtime (insets, keyboard
height) and for the design tokens, which keep Tailwind's names so a plain-CSS app sets them in `:root`
and a Tailwind app in `@theme`. **adaptv ships no palette.** Tailwind is an optional convenience:
`@arrzdev/adaptv/tailwind.css` adds the safe-area utilities and the variants.

---

## 0.1 🔒 Tailwind is optional; adaptv's own styles are plain CSS in a layer

Decided **2026-10-05**, on the owner's request, closing **O24**. It **reverses** the 2026-07-28
decision that made Tailwind v4 a hard requirement. That decision's text is in git history; what
follows records why it no longer holds and what replaces each of its parts.

**Why the old decision fell.** Its decisive argument was never cost: it was that a `@custom-variant`
delivers a correctness fix (`hover:` that cannot stick after a tap, nor beat a focus ring) to the code
a consumer already writes, and that *"there is no CSS mechanism for this"*. That was an argument for
**rewriting the CSS at build time**, not for **Tailwind**. Since 2026-10-05 `src/vite/css-patch-rewrite.ts`
rewrites every emitted `:hover` and `:active` rule whatever produced it — Tailwind, SCSS, CSS modules
or plain CSS, `node_modules` included (→ [`../roadmap/patch-delivery.md`](../roadmap/patch-delivery.md)
§4). Correctness no longer depends on Tailwind; Tailwind is ergonomics. And adaptv is not published:
dropping `cn()` and three peer dependencies breaks nobody today, and after alpha it would break real
users.

**What each old coupling becomes.**

| Coupling (2026-07-28) | Now |
|---|---|
| Primitives emit Tailwind utilities for structure (`inline-flex`, `shrink-0`, the touch-action longhand) | Default look and soft structure are rules in `@layer adaptv.components` keyed on `[data-adaptv][data-part]`. Structure the consumer must not override by accident is inline style (§2). Primitives emit **no class names of their own**. |
| `patches.css` / `utils.css` use Tailwind at-rules (`@custom-variant`, `@utility`) | `styles.css` contains **no Tailwind at-rule**. The at-rules move to the optional `tailwind.css` (§5, §5.4.1). |
| `index.css` declares `@source "../**/*.{ts,tsx,mjs}"` so the app's Tailwind scans adaptv | Deleted. There is nothing in adaptv for Tailwind to generate, so the `dist-cutover` path problem that `@source` carried is gone. |
| `tailwind-merge` resolves `base < className < locked` | Cascade layers resolve `default < className`; inline style resolves `locked` (§2). Nothing to merge. |
| Tokens are the consumer's `@theme` | Tokens are CSS custom properties with the **same names**; `@theme` is one way to set them, `:root` another (§7). |

**Two entry stylesheets.**

- **`@arrzdev/adaptv/styles.css`** — every consumer. Plain CSS: the layer statement, the safe-area and
  keyboard variables, the resets and patches, the component rules, and three plain utility classes
  (`selectable`, `scrollbar-hidden`, `scrollbar-visible`, §5.4.1). It works through any bundler.
- **`@arrzdev/adaptv/tailwind.css`** — optional, for Tailwind v4 apps. It imports `styles.css` and adds
  the 81 safe-area `@utility` names unchanged (`p-safe`, `pt-safe-offset-*`, `mb-safe-or-*`, …), the
  `app:` / `web:` / `dark:` / `light:` variants, the `hover:` / `active:` custom variants (§5), and
  the three utility classes again as `@utility`, so `md:scrollbar-hidden` works. A Tailwind app imports
  this file **instead of** `styles.css`, after `@import "tailwindcss"`.

**What a Tailwind user loses: nothing they type.** Every class name and variant they used keeps its
name. What they lose is adaptv's `cn()`: a Tailwind app that wants class merging installs
`tailwind-merge` and `clsx` itself, as with any other component library.

**What a plain-CSS user does not get:** the variant spellings. Each has a selector equivalent (§5
table), and the safe-area utilities have a `var()` equivalent (§5.4.1). The `hover:`/`active:`
correction reaches them anyway, through the emitted-CSS rewrite.

**Rejected: the additive path** the 2026-07-28 text proposed as its own revisit route — core in the
layer, utilities still emitted for Tailwind consumers. It keeps two styling paths per primitive, keeps
`tailwind-merge` as the precedence spine for one population and cascade layers for the other, and so
keeps every cost this decision removes. **Rejected: keeping Tailwind required** — the owner's request is
that a developer does not need Tailwind; the correctness argument no longer supports it.

**The cost, accepted rather than discovered.**

- **Emitted CSS may grow.** A utility rule was shared with the app (one `.flex` served both); a
  per-component rule is not. Client JS shrinks — `tailwind-merge` and `clsx` leave the bundle.
  Both are measured before/after in the PR that removes the peers, and recorded here.
  **Measured 2026-10-06** (the playground's client build, `.output/public`, gzip -9; before =
  `a05dc7b`, the last `main` before the component restyle):

  | Build | Client JS (gzip) | Emitted CSS (raw / gzip) |
  |---|---|---|
  | Tailwind playground, before | 608.3 KB | 87.1 KB / 14.7 KB |
  | Tailwind playground, after | 611.1 KB | 104.0 KB / 16.8 KB |
  | Same app, no Tailwind (`vite.plain.config.ts`) | 602.9 KB | 44.8 KB / 7.6 KB |

  The Tailwind playground keeps its own `tailwind-merge` + `clsx` (its pages call `cn()`), so its
  JS does not shrink; leaving them out is the 8.2 KB the no-Tailwind build saves. Its CSS grows
  by 2.1 KB gzip: the per-component rules that replaced shared utilities.
- **Inline style on locked elements.** Server-rendered HTML carries a `style` attribute where a class
  used to be (§2). Measured in the same PR.

### What follows, and is therefore non-negotiable

- **`tailwindcss`, `tailwind-merge`, `clsx` are not `peerDependencies`**, nor dependencies. adaptv's
  code imports none of them. A guard test asserts it, so one cannot come back through a convenience
  import.
- **`./utils` exports neither `cn` nor `mergeStyles`.** Internally a class-join helper (falsy values
  skipped, no conflict resolution) and the inline-tier merge (§2.1) replace them; neither is public.
- **`styles.css` contains no Tailwind at-rule.** `pnpm build:check` compiles the shipped `styles.css`
  with **no** Tailwind and fails on any `@utility`, `@custom-variant`, `@theme`, `@source`, `@apply`
  or `--spacing()` left in it — the silent-partial-failure mode the 2026-07-28 text warned about.
- **Every Tailwind token adaptv reads carries Tailwind's default as a literal fallback** (§7), so an
  app that defines no token renders the same defaults as one that uses Tailwind's.
- **The quickstart shows a plain-CSS app**, and the Tailwind setup as the second option.

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

## 2. 🔒 Layer 1 — `className`, with precedence by the cascade (mandatory)

Revised **2026-10-05**. Every primitive has three tiers, and the cascade, not a merge function, orders
them:

| Tier | Owner | Where it lives | Beats |
|---|---|---|---|
| **default** | adaptv | a rule in `@layer adaptv.components`, selector `:where([data-adaptv="…"][data-part="…"])` | nothing |
| **consumer** | consumer | `className` (any dialect: unlayered CSS, a CSS module, a Tailwind utility) and `style` | default |
| **locked** | adaptv | inline `style`, written last by the primitive | both |

**Why `className` wins with no help.** Unlayered CSS beats every layer whatever its specificity, so a
plain-CSS or CSS-module class wins; Tailwind's `utilities` layer is ordered after `adaptv` (§6.0), so a
Tailwind utility wins. The default rule's `:where()` keeps its specificity at zero, so a consumer who
puts overrides in their own layer *after* adaptv's also wins, and adaptv's own state rules cannot fight
each other by specificity. The primitive renders the consumer's `className` and adds **no class of its
own**: there is nothing on the element for a consumer class to conflict with, which is what made
`tailwind-merge` necessary before (§5.5).

**Why `locked` cannot be a layer.** Unlayered CSS beats every layer, so a lock written as a later
`@layer adaptv.locked` would hold against a Tailwind consumer and lose to a plain-CSS one: a guarantee
that depends on the consumer's dialect, failing silently for half of them. Inline style is the only
author-level tier above unlayered CSS, so `locked` moves there. The two other options:

- **an inner element** the consumer's `className` does not reach. Correct, but it changes the DOM,
  which the component API and the consumer's selectors depend on. Used only where inline style cannot
  express the property.
- **`!important` in the layer** — forbidden (§6.0.1): it inverts layer order and becomes unbeatable.

**The rule for each lock:** inline style by default. A pseudo-element rule is out of `className`'s
reach already, so it stays a layer rule. A media query is resolved in JS (`useReducedMotion`) and the
result goes inline. An inner element only when none of these works — today, no primitive needs one.

### 2.0 Where each primitive's `locked` goes (recorded 2026-10-05)

Every value below was a `locked` Tailwind class on 2026-10-05; it becomes the inline declarations
named. Anything not listed was `base` and becomes a default rule in the layer.

| Primitive (part) | Locked properties | Goes to |
|---|---|---|
| Press targets — `Pressable`, `Button`, `Link`, `ExternalLink`, `Select` trigger and option, `Dropdown` item, `Checkbox` root, `RadioGroup` item, `Switch` track, `Input` group and field, `TextArea` shell | `touch-action: pan-x pan-y pinch-zoom` (WebKit 240917); when disabled also `user-select: none` + `-webkit-user-select` | inline |
| `Checkbox`, `RadioGroup`, `Switch` (root/item/track) | `position: relative` | inline |
| `Checkbox` box, `RadioGroup` box | `position`, `display: flex`, `flex-shrink`, alignment, `overflow: hidden` | inline |
| `Checkbox` icon, `RadioGroup` indicator, `Slider` thumb, `Switch` thumb | `pointer-events: none`, position (thumb: `top: 50%`, `translate`) | inline (the thumbs already have a `lockedStyle`; merge into it) |
| `Checkbox` / `RadioGroup` / `Switch` input | the cover-the-label box | inline |
| `Slider` root, track, range | `position`, `inset`, `left`, touch-action (disabled: passthrough) | inline |
| `Button` slot and label | `display: inline-flex`, `flex-shrink: 0`, `align-items`, `min-width` | inline |
| `Input` leading / trailing slot, grouped field | `display`, `flex-shrink`, `order`, `flex`, `min-width`, chromeless `border`/`background`/`padding`/`box-shadow`/`color: inherit` | inline |
| `TextArea` shell, inner | box sizing, `display`, width, `flex`, `resize: none`, `line-height`, chromeless set incl. `outline: none`, `overflow-y` at max rows | inline |
| `Image` root, slot layers, LQIP, `<img>` | `position`, `inset`, `isolation`, `overflow`, size, `z-index`, `visibility`, `opacity`, `border-radius: inherit`, `max-*: none`, `font-size: 0`, `line-height: 0` | inline (joins the existing `aspectRatio` / fit `lockedStyle`) |
| `Drawer` overlay, panel, scroller, shell, header | the engine's position and `z-index`, `inset`, flex column, `height: auto`, `min-height: 0`, `max-height: none`, `overflow`, `overscroll-behavior`, `flex-shrink: 0` | inline (joins the existing `lockedStyle`) |
| `Select` content, `Dropdown` content | `z-index: 50`, `overflow-y: auto`, `overscroll-behavior: contain` | inline (joins `Select`'s existing `lockedStyle`) |
| `WheelColumn` fieldset, item | scroll axis, `overscroll-behavior-y`, touch passthrough, item size | inline |
| `ScrollView` | scroll axis (`overflow-x/y`), `overscroll-behavior`, touch passthrough, `scrollbar-width` | inline; the `::-webkit-scrollbar` half of the indicator stays a layer rule keyed on the root's attributes (a pseudo-element, unreachable from `className`) |
| `Fab` | `transition: translate 200ms ease-out`, none under reduced motion | inline, with reduced motion read in JS as `Image` already does |
| `PullToRefresh` root, `ProgressBar`, `FieldGroup` row and label | `position`, `overflow`, `display: flex` (+ column) | inline |
| `PwaSplashOverlay` root, layer | `position: fixed` / `absolute`, `inset: 0`, `z-index: 100` | inline |
| `View safe="…"` | `padding-*: var(--adaptv-inset-*, 0px)` for the named edges | inline |
| `Text selectable` | `user-select: text` + `-webkit-user-select` | inline |
| `Divider`, `Skeleton`, `Spinner` | none (`locked: undefined` today) | — |

> ✅ **Bug B8 stays closed under the new mechanism.** `src/components/style-precedence.test.tsx`
> still asserts both halves on every primitive — a class that must win and a locked property that must
> hold — but now on **computed style in a real browser**, not on the class string, because the class
> string no longer carries the precedence. The e2e precedence suite runs it twice: once with a plain
> CSS class as the consumer, once with a Tailwind utility. The `WheelColumn` story (tailwind-merge
> dropped `scrollable-y` because `overscroll` was registered as conflicting) is why the new mechanism
> has no conflict table to keep in step.

### 2.1 The inline-style tier

Inline `style` is its own cascade origin and beats every author stylesheet at any layer or specificity,
which is why it now carries `locked`. The internal helper merges it per property:

```ts
style → { ...baseStyle, ...style, ...lockedStyle }   // baseStyle < consumer style < locked
```

Object spread gives exact last-wins semantics **per property**: there is no conflict-group registry to
keep in step. `baseStyle` stays for defaults that must be computed in JS (the LQIP's
`background-image`); a static default belongs in the layer instead.

**Two honest limits.** It is not a security boundary — a consumer holding a `ref` can always assign
`el.style.*`, exactly as they can always write an unlayered `!important`; the contract makes the
*accidental* case impossible, not the deliberate one. And for properties the gesture engine writes per
frame directly to the node, a consumer's inline value loses to a **race**, not to this contract; the
clean channel there is §3.2 (engine writes a custom property, a layer rule consumes it).

**The escape-hatch rule (learned from Ionic #24283):** when behaviour must be untouchable, express it
as a **prop → `data-*` or inline style**, so there is no class to lose to.

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

**Since 2026-10-05 the pair is also how adaptv styles itself** (§2): every element a primitive renders
with a default look carries `data-adaptv` and `data-part`, because its default rule is keyed on them.
A part that has no attribute yet gets one; adding an attribute is not an API change, renaming one is.

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

`Collapsible` (`src/components/collapsible.tsx`) does not need the suppress-and-measure step: its
panel is `overflow: hidden` while it transitions, so `scrollHeight` is the natural height with
nothing to suppress. It publishes no variable — the target goes on as an inline `height` that the
CSS transition retargets, and the panel rests at `auto` with the inline value removed.

### 3.3 🔒 `render` prop over `asChild`; composition joins classes, it does not merge them

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

**The composition order, revised 2026-10-05.** No library resolves Tailwind conflicts on composition,
and they concatenate in *opposite* orders: Radix does `[slot, child].join(' ')`, Base UI puts the
`className` prop *after* the render element's. The 2026-07-20 answer was to route composition through
`mergeStyles` so tailwind-merge resolved it. With nothing of adaptv's in the class attribute (§2) there
is nothing of adaptv's to resolve:

> **🔒 adaptv joins the two class lists — the render element's first, then the `className` prop — and
> merges nothing.** The default look is in the layer and the locks are inline, so neither can be lost
> in the join. Two *consumer* classes that conflict are the consumer's tool's job: a Tailwind app that
> wants one of them dropped runs its own `tailwind-merge`, as it would for any other library.

---

## 4. 🔒 Layer 3 — custom properties, for runtime values *only*

Custom properties are the **JS→CSS transport**, never the theming API. Legitimate uses are values
CSS cannot compute for itself:

| Property | Set by | Why it must be a variable |
|---|---|---|
| `--adaptv-inset-{top,right,bottom,left}` | `safe-area.css`, resolving the contract | the value space is continuous, and it must compose inside `calc()` |
| `--safe-area-inset-*` | Capacitor `SystemBars` on Android | the **input** to the contract above, injected with no event — `env()` reads 0/wrong in Android WebView (`crbug/40699457`) |
| `--adaptv-keyboard-height` | `useKeyboard` | the real OS keyboard height, not a `visualViewport` guess. On Android native the WebView has already shrunk by it, so `calc()` against the viewport counts it twice there (`docs/design/keyboard-signal.md` §3) |
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
to remember `var(--x, 0px)`, and the one that forgets breaks the whole `calc()`. `--pwa-launch-height`
is an exception: its script returns early outside a standalone display, so a browser tab never gets
it, and a reader needs its own fallback (the playground's splash reads
`var(--pwa-launch-height,100lvh)`). Measured 2026-09-13 in a Safari tab on the iOS 18.0 (`22A3351`) and
iOS 26.1 (`23B86`) simulators, origin/main `9f11f0d` on the dev server: on `/lab/safe-area` its computed
value was empty on both, while `--adaptv-inset-bottom` read `0px`.

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

**Revised 2026-10-05:** variants are Tailwind syntax, so all six ship in the optional
`@arrzdev/adaptv/tailwind.css`, never in `styles.css`. Each has a plain-CSS spelling, given below; that
spelling is the contract, the variant is a shorthand for it.

They split into two categories, and the split is the rule for whether a seventh ever gets added:

### Corrections — the consumer never learns these

They rewrite the meaning of code the consumer already writes. There is nothing to import and no name
to remember; existing `hover:bg-muted` simply becomes correct. Since 2026-10-05 the same correction is
applied to **every** emitted `:hover` and `:active` rule, whatever dialect wrote it, by
`src/vite/css-patch-rewrite.ts` ([`../roadmap/patch-delivery.md`](../roadmap/patch-delivery.md) §4).
The Tailwind variants stay in `tailwind.css` so a Tailwind build outside adaptv's Vite plugin
(Storybook, a test harness) still gets the fix, and so `hover:` and a hand-written `:hover` compile to
the same guard.

| | What it fixes | Plain CSS |
|---|---|---|
| **`hover:`** | `&:hover:not(:is(:focus, :focus-within))` inside `@media (hover: hover)`. The media query is Tailwind v4's own default, which overriding the variant *discards* — so adaptv must re-supply it. Ours is the `:not(…)` half: hover must not beat a focus ring. | write `:hover`; the rewrite adds the guard |
| **`active:`** | Two branches — `&[data-pressed]` for engine-driven elements, `&:active:not([data-press-engine])` for everything else. The gesture engine stamps `data-press-engine` so a consumer's plain `<button className="active:scale-95">` keeps native `:active` and does not silently stop working. Native `:active` cannot be cleared from JS and will not re-light on touch re-entry, which is why engine elements must not use it. | write `:active`; the rewrite adds both branches |

### State — the consumer must know these exist

| | Meaning | Plain CSS |
|---|---|---|
| **`app:`** | installed PWA (`display-mode: standalone`) **or** a native Capacitor build. The attribute branch is load-bearing: a native WebView reports `display-mode: browser`, so a media query alone misses it. | `@media (display-mode: standalone) { … }` and `html[data-adaptv-platform="native"] …` |
| **`web:`** | a real browser tab only. Attribute-scoped for the same reason. | `html[data-adaptv-platform="web"] …` |
| **`dark:` / `light:`** | the pre-paint theme stamp. | `:where(.dark, .dark *)` / `:where(.light, .light *)` |

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
>
> And since 2026-10-05: **a seventh needs a plain-CSS spelling first.** A variant with no selector
> equivalent would be a capability only Tailwind users have.

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

### 5.4.1 🔒 adaptv's class vocabulary: three plain classes, and the safe-area family for Tailwind

Amended **2026-07-30**, revised **2026-10-05**.

**The 2026-07-30 lesson, kept because it still decides what may exist.** adaptv shipped `clickable`,
`non-clickable`, `scrollable`, `scrollable-x` and `scrollable-y`, and deleted all five. A custom
utility cost a hand-kept conflict table in `cn.ts`; the entry nobody wrote was `cursor`, so
`cn("non-clickable", "cursor-wait")` emitted both and Tailwind's print order picked the winner. And
`clickable` bundled `touch-action` (correctly locked, WebKit 240917) with `cursor: pointer` (locked by
accident), which made `cursor-wait` on a pending button unreachable. The tiers had to separate.

**What remains is a vocabulary the consumer types, in two tiers.**

| Names | Ships in | Why it exists |
|---|---|---|
| `selectable`, `scrollbar-hidden`, `scrollbar-visible` | `styles.css`, as plain classes in `@layer adaptv.utilities`; `tailwind.css` registers the same names as `@utility` so variants compose (`md:scrollbar-hidden`) | the per-element escape from an app-wide reset (`ui.noSelect`, `ui.hideScrollbars`). The reset sits in `adaptv.reset`, which is ordered before `adaptv.utilities`, so the class wins on layer order with no `!important` — in every dialect. |
| the 81 safe-area utilities: `{p,m,inset}{,x,y,s,e,t,r,b,l}-safe`, `…-safe-offset-<n>`, `…-safe-or-<n>`, same names as before | `tailwind.css` only | `pb-safe-offset-2` extends a vocabulary a Tailwind user already has (§5.4). A plain-CSS user writes the declaration instead (below). |

**The plain-CSS spelling of the safe-area family** is the variable it was always built on (§4):

```css
.footer   { padding-bottom: var(--adaptv-inset-bottom); }                         /* pb-safe */
.footer   { padding-bottom: calc(var(--adaptv-inset-bottom) + 0.5rem); }          /* pb-safe-offset-2 */
.footer   { padding-bottom: max(var(--adaptv-inset-bottom), 1rem); }              /* pb-safe-or-4 */
```

The variables are always defined (`0px` at rest), so no call site needs a fallback.

**The bar for a new name is unchanged:** the property has no Tailwind equivalent at all, *and* it can
be written as a plain class. Since there is no `tailwind-merge` any more, there is no conflict table
to register it in — the cost that killed `clickable` is gone, and so is the reason it was tempting to
bundle.

## 5.5 ⚠︎ Correction — how class conflicts *actually* resolve in Tailwind v4

Kept because it is why adaptv used to need `tailwind-merge`, and why it no longer does.

Tailwind emits every utility into one sorted `@layer utilities` block. **The order of classes in the
`class` attribute is irrelevant** — it is a token bag for the scanner. Verified by compiling:

```
input:  "p-8 p-2 p-4 pt-1 px-3 m-9 m-1 text-sm text-2xl rounded-none rounded-full"
output: .m-1 .m-9 .rounded-full .rounded-none .p-2 .p-4 .p-8 .px-3 .pt-1 .text-2xl .text-sm
```

Sort is **property group first, then a natural sort of the suffix**. So `p-8` beats `p-2`,
`rounded-none` beats `rounded-full` — decided by Tailwind's sort, not by who authored the class. While
adaptv's defaults were utilities, a default `p-8` beat a consumer's `p-2`, so the two could never be
emitted together and `tailwind-merge` had to drop one in JS.

**Since 2026-10-05 the two never meet:** adaptv's `p-8` is a declaration in `@layer adaptv.components`,
the consumer's `p-2` is in `utilities`, and the later layer wins whatever the sort. Two conflicting
classes **both written by the consumer** still resolve by Tailwind's sort — that is Tailwind's
behaviour, and the consumer's `tailwind-merge`, if they want one, is the fix.

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

> **Scope, since 2026-10-05: Tailwind apps only.** A plain-CSS app has no `utilities` layer to order
> against: its own rules are unlayered and beat every `adaptv.*` layer, and `styles.css` declares its
> own sub-layer order on its first line. Nothing below applies to it.

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
@import "@arrzdev/adaptv/tailwind.css";
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

`locked` (§2) stays outside the layer system — since 2026-10-05 it is inline style, the one author
tier that beats unlayered CSS, because a lock in a layer would lose to any plain-CSS consumer.

> **Delta:** wrap `patches.css` / `utils.css` / component CSS in `@layer`, and strip the `!important`s
> that exist purely to win the cascade. Keep `!important` only where it fights a *UA* stylesheet that
> layers can't reach.
>
> This also resolves open question **O13** ("are the always-on `patches.css` rules doctrine or
> flags?"): **doctrine, but layered.** They stay always-on because they're the app-feel baseline, and
> they stop being a trap because the consumer can now override any of them with an ordinary rule.

---

## 7. 🔒 Theming = custom properties with Tailwind's names, set however the app likes

Revised **2026-10-05**. adaptv ships **no colour palette, no spacing scale, no radius scale.** What it
does is *read* a fixed set of tokens, by the names Tailwind v4 already uses, so that each renders
exactly what the Tailwind utility rendered on 2026-10-05:

```css
@layer adaptv.components {
  :where([data-adaptv="dropdown"][data-part="content"]) {
    background: var(--color-surface);          /* semantic: no fallback, see below */
    border-radius: var(--radius-md, 0.375rem); /* Tailwind's own token: its default */
    padding: calc(var(--spacing, 0.25rem) * 1);
  }
}
```

So one stylesheet serves both kinds of app, and neither maintains a second source of truth:

```css
/* plain CSS — the app's main.css */
@import "@arrzdev/adaptv/styles.css";
:root { --color-surface: oklch(0.99 0 0); --radius-md: 0.5rem; }
```

```css
/* Tailwind — the app's main.css */
@import "tailwindcss";
@import "@arrzdev/adaptv/tailwind.css";
@theme { --color-surface: oklch(0.99 0 0); --radius-md: 0.5rem; }
```

**Rules for the token reads.**

- **The name is Tailwind's** (`--color-*`, `--radius-*`, `--spacing`, `--text-*`), never an
  `--adaptv-*` name — that is §1's rejected model, and a Tailwind app would then define every token
  twice.
- **Tailwind's own tokens** (palette, `--spacing`, `--radius-*`, `--text-*`) are read with a literal
  fallback, the value Tailwind 4.2.4 ships for them — a plain-CSS app that defines none renders what a
  Tailwind app renders.
- **The semantic tokens Tailwind does not define** (`--color-surface`, `--color-background`,
  `--color-foreground`, `--color-border`, `--color-muted`, `--color-primary`, `--color-primary-fg`)
  are read **without** a fallback. That reproduces today exactly: an undefined token made `bg-surface`
  emit no rule, and an undefined `var()` makes the declaration unset. Giving them literal values would
  be shipping a palette by the back door (§4.1); whether the defaults should reference them at all is
  out of scope here.
- **The set is listed** in `styles.css`'s header, so the theming surface is countable.
- ⚠︎ **To verify in the implementation, not to assume:** Tailwind v4 emits a theme variable only when
  something uses it. If a token set in `@theme` does not reach a component whose app never uses the
  matching utility, `tailwind.css` must make Tailwind keep it. The precedence e2e suite carries the
  case: a Tailwind app sets `--color-surface` in `@theme`, never writes `bg-surface`, and the menu
  still paints it.

**Modern-CSS bonus adaptv should take, which Ionic cannot:** with no IE11/legacy constraint,
`color-mix()` and OKLCH **eliminate the `-rgb` twin-variable tax entirely**. A shade/tint is
`color-mix(in oklch, var(--color-primary), black 12%)` at use site — no precomputed `-shade`/`-tint`
tokens, no parallel `-rgb` channel.

**Dark mode** stays as-is: the pre-paint theme stamp puts `.dark` / `.light` on `<html>`, a plain-CSS
app keys on `:where(.dark, .dark *)`, and `tailwind.css` declares the `dark:` / `light:` variants over
the same selector, so there is no flash of the wrong theme before hydration in either.

---

## 8. What a consumer actually writes

**Plain CSS** (or SCSS, or CSS modules — the cascade is the same):

```tsx
// 1. local look — any class; it beats adaptv's defaults through the layer
<Button className="save-button">Save</Button>

// 2. safe area — the variable
<View className="screen-footer" />
```

```css
.save-button   { background: var(--color-primary); border-radius: 1rem; }
.screen-footer { padding-bottom: calc(var(--adaptv-inset-bottom) + 1rem); }

/* 3. local state styling — the data attributes */
.save-button[data-pressed] { scale: 0.95; }

/* 4. platform-conditional look */
html[data-adaptv-platform="web"] .screen-footer { padding-bottom: 1rem; }

/* 5. global restyle of a primitive — no imports, no wrappers */
[data-adaptv="drawer"][data-part="content"] { border-radius: 20px 20px 0 0; }

/* 6. override an adaptv patch — unlayered beats @layer, no !important */
.article-body { user-select: text; }

/* 7. tokens */
:root { --color-primary: oklch(0.55 0.22 264); }
```

**Tailwind** — the same seven, shorter:

```tsx
<Button className="bg-primary rounded-2xl data-pressed:scale-95">Save</Button>
<View className="pb-safe-offset-4 web:pb-4" />
```

```css
[data-adaptv="drawer"][data-part="content"] { border-radius: 20px 20px 0 0; }
@theme { --color-primary: oklch(0.55 0.22 264); }
```

Each mechanism has one obvious job, and there is **no per-component API surface to memorise or
maintain.** If the app wants two of its own Tailwind classes merged, it brings its own
`tailwind-merge`; adaptv no longer exports `cn()`.

---

## 9. Acceptance (testably done)

- [x] Every primitive has an explicit `locked` decision (bug **B8**), now recorded per part in §2.0.
- [ ] A consumer class overrides the default on every primitive, **in a real browser, for a plain-CSS
      class and for a Tailwind utility**; a locked property holds against both.
- [ ] The same holds for the inline-style channel (`baseStyle < style < lockedStyle`, §2.1).
- [ ] `View safe="bottom" className="pb-0"` keeps its safe padding, in both kinds of app.
- [ ] Every element a primitive renders with a default look carries `data-adaptv` + `data-part`; a
      global `[data-adaptv="…"]` rule restyles it with no imports.
- [x] `patches.css` / `utils.css` / component CSS are wrapped in `@layer`; the cascade-only
      `!important`s are gone; an unlayered consumer rule overrides each of them. One survivor, the
      autofill `-webkit-box-shadow`, fights a UA sheet and is justified in place.
- [x] The variant list is closed at six and documented in one place (§5).
- [x] A Tailwind consumer writes **no** `@layer` line — the `adaptv:css-layer-order` Vite plugin injects
      it (§6.0), and warns when it can find no stylesheet to inject into.
- [x] adaptv owns its safe-area utilities; `tailwindcss-safe-area` is not a dependency.
- [ ] `styles.css` contains no Tailwind at-rule, and a playground route built **without Tailwind**
      passes the component and precedence e2e suites (Chromium touch + WebKit).
- [x] `tailwindcss`, `tailwind-merge` and `clsx` are not in `peerDependencies`; `./utils` exports
      neither `cn` nor `mergeStyles` (`src/tailwind-optional.test.ts`).
- [ ] adaptv defines **zero** colour/spacing/radius tokens; every Tailwind token it reads has
      Tailwind's default as a literal fallback (§7).
- [x] No `::part()`, no shadow DOM, no `--adaptv-color-*` anywhere in the codebase.
- [x] No primitive ships a default border width — guarded by inverted tests, with the reasoning in
      `VISION.md §2.1` and a `⚠︎ Do NOT re-add` note in each primitive.

---

## 10. Where this sits

- `VISION.md §9` — "Styling system" open question is **closed by this doc**; §2 principles 1–2
  (correct-by-construction, behavior-is-props) are the doctrine it implements.
- `docs/design/architecture.md §1.2` — `View`'s "behavior is props, look is className" is the canonical example.
- `docs/design/behaviors.md §6` — the safe-area vocabulary.
- `docs/decisions/register.md §3.1` — the conflict this doc resolves; **O1 closed**, **O13 closed**;
  **L24** — Tailwind optional (2026-10-05), closing **O24**.
- [`../roadmap/patch-delivery.md`](../roadmap/patch-delivery.md) §4 — the emitted-CSS rewrite that made
  Tailwind optional.
