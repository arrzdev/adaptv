# adaptv — the styling & theming contract

> **How a consumer customises the look of adaptv primitives.** The framework's most-touched surface,
> and until now the only major one with no decision written down: `VISION.md §9` listed "Styling
> system" as open, while `src/utils/styles.ts` had already shipped a precedence contract that only
> 2 of 19 components actually used.
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
groups registered via `extendTailwindMerge` (`scrollable-*`, `clickable`/`non-clickable`, and the
`tailwindcss-safe-area` `p*-safe` utilities folded into the standard padding groups — so
`View safe="bottom"` beats a stray consumer `pb-0`).

> **⚠︎ Delta to close (bug B8): 17 of 19 primitives use bare `cn()` and therefore have no `locked`
> layer at all.** The "consumer can't break structural classes" guarantee is currently unenforced
> everywhere except `View` and `ExternalLink`. Every primitive must migrate to `mergeStyles`, and a
> primitive with nothing structural should pass `locked: undefined` **explicitly** so the omission is
> a decision rather than an oversight.

**The escape-hatch rule (learned from Ionic #24283):** when behaviour must be untouchable, do **not**
express it as a class the consumer can fight — express it as a **prop → `data-*` → CSS rule**, so
there is no class to lose to. `locked` covers *soft*-structural look only.

---

## 3. 🔒 Layer 2 — `data-*` state, on a two-axis namespace

adaptv already exposes state this way ad hoc: `data-pressed` (the reentrant press engine, since
native `:active` can't be cleared from JS and won't re-light on touch re-entry),
`data-keyboard-open` / `data-keyboard-height`, `data-caret-muted`, `data-gpu-boost`,
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

### 3.2 🔒 Measured scalars are CSS variables — and unprefixed

The split every library converged on: **enumerable state → data attribute; measured scalar → CSS
variable.** Four reasons a class can't do the job — the value space is continuous (`473.5px`), it's
computed post-layout *in the same frame* (a class means a React round-trip between measure and paint —
a visible flash), custom properties **inherit** so the measuring element and the consuming element can
differ, and they compose inside `calc()`.

**Unprefixed names.** Base UI and Zag independently landed on `--available-height`, `--anchor-width`,
`--transform-origin`; only Radix prefixes, and its own internals show why it regretted it — five real
vars in `popper.tsx`, then a per-component alias layer on top. adaptv follows Base UI/Zag.

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
eventually obsolete (Chrome 129+ only today — see `ANIMATION.md §2`).

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
| `--safe-area-inset-{top,right,bottom,left}` | native inset reporting | Android WebView `env()` is unreliable; the plugin layer must inject real values (§6) |
| `--keyboard-height` | `useKeyboard` accessor | the real OS keyboard height, not a `visualViewport` guess |
| `--pwa-launch-height` | `getLaunchViewportInitScript()` | freezes resolved `100vh` against the iOS standalone cold-start ICB expansion |
| `--viewport-cover-bleed` | critical CSS | launch-overscan bleed |

Use Ionic's fallback-chain idiom so a consumer override cascades without recomputation:

```css
padding-top: var(--adaptv-inset-top, env(safe-area-inset-top, 0px));
```

> **Do not** add `--adaptv-color-*`, `--adaptv-radius-*`, `--adaptv-spacing-*`, or per-component
> properties like `--drawer-padding-start`. That is §1's rejected model.

---

## 5. 🔒 Layer 4 — platform variants, already correct

adaptv stamps `data-adaptv-platform` (`web` | `native` | `standalone`) and `data-adaptv-os` on `<html>`
**pre-paint**, and derives Tailwind custom variants from it:

- **`app:`** → installed PWA (`display-mode: standalone`) **or** a native Capacitor build. The
  attribute branch is load-bearing: **a native WebView reports `display-mode: browser`**, so a media
  query alone misses it.
- **`web:`** → a real browser tab only. Attribute-scoped for the same reason.
- **`pressed:`** → `[data-pressed]`, the gesture-engine press state.

This is strictly better than Ionic's `.ios`/`.md` mode classes: it's pre-paint (no FOUC, no hydration
mismatch), and it separates *platform* from *installation context*, which Ionic conflates.

**Delta:** add `ios:` / `android:` variants off `data-adaptv-os` — currently only the platform axis has
variants, so per-OS styling still requires a hand-written `[data-adaptv-os="ios"] &` selector.

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

**Ship that as a copy-paste line in the quickstart**, and have `create-adaptv` scaffold it. This is also the pattern MUI documents for its own Tailwind integration (`@layer theme, base, mui, components, utilities;`).

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
@import "tailwindcss-safe-area";
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

- [ ] All 19 primitives use `mergeStyles`; `locked` is explicit (bug **B8**).
- [ ] A consumer `className` overrides `base` on every primitive; `locked` beats `className` where declared.
- [ ] `View safe="bottom" className="pb-0"` keeps its safe padding.
- [ ] Every stateful primitive emits `data-adaptv` + `data-part` + its state attributes; a global
      `[data-adaptv="…"]` rule restyles it with no imports.
- [ ] `patches.css` / `utils.css` / component CSS are wrapped in `@layer`; the cascade-only
      `!important`s are gone; an unlayered consumer rule overrides each of them.
- [ ] `ios:` / `android:` variants exist alongside `app:` / `web:` / `pressed:`.
- [ ] adaptv defines **zero** colour/spacing/radius tokens; primitives reference semantic Tailwind
      classes that resolve against the consumer's `@theme`.
- [ ] No `::part()`, no shadow DOM, no `--adaptv-color-*` anywhere in the codebase.

---

## 10. Where this sits

- `VISION.md §9` — "Styling system" open question is **closed by this doc**; §2 principles 1–2
  (correct-by-construction, behavior-is-props) are the doctrine it implements.
- `ARCHITECTURE.md §1.2` — `View`'s "behavior is props, look is className" is the canonical example.
- `BEHAVIORS.md §6` — the tailwind-merge safe-area class-group registration.
- `DECISIONS.md §3.1` — the conflict this doc resolves; **O1 closed**, **O13 closed**.
