# adaptv — the patch registry, and the CSS post-processor

> 📐 **A plan, not a change.** Decided by the owner **2026-09-09**: every patch adaptv applies answers
> to **two tiers** — a global toggle in `adaptv.config.ts`, resolved pre-paint to an attribute on
> `<html>`, and a **local opt-out on the element**. Both are generated from **one registry**, so the
> config key, the stamp and the escape hatch cannot drift apart.
>
> Two things are settled inside that: the local marker for a behavioural patch is
> **`data-adaptv-no-<patch>`**, not a class (§2.3); and the four patches the source marks *"no knob and
> never will"* stay that way, declared **`hatch: false`** in the registry rather than left implicit in
> a comment (§2.4).
>
> The second half of the file is the **CSS post-processor** (§4) — the mechanism that lets these
> patches reach a consumer who writes SCSS or plain CSS instead of Tailwind utilities. It is the
> larger and riskier piece, it is what makes the local tier reachable for the rewrite-shaped patches,
> and it does **not** require dropping Tailwind — that question is **O24** and is separate.

---

## The verdict, up front

| | |
|---|---|
| **The shape** | One registry per patch → a config key, an `html[data-adaptv-*]` stamp, and a `data-adaptv-no-*` local hatch. Generated, not hand-kept in three places. |
| **What is already built** | More than half of it. `UiPatchScope` (`"app" \| "all" \| "off"`) with per-option defaults, the pre-paint stamp, `patches: {caretRepaint, textMagnifier, viewportFreeze}`, a shipped CSS hatch (`&:active:not([data-press-engine])`) and a shipped JS hatch (`isProtectedTarget()`'s `closest()`). → §1 |
| **The finding that shrinks the work** | **Half the patches need no marker at all.** Where a patch is a CSS *property*, the hatch is re-declaring the property, and `@layer adaptv.*` already guarantees a consumer's unlayered rule wins at any specificity — for any consumer, in any CSS dialect, with nothing to learn. Only the **behavioural** patches need a marker, and there are five. → §2.2 |
| **The uniform part** | The **registry**, not the enforcement. Enforcement is irreducibly three shapes (layered CSS, a rewritten selector, a JS handler) and forcing one would break patches that work today. |
| **The risky part** | The post-processor's blast radius: `@custom-variant` only touches what a consumer opted into by typing `hover:`; a post-processor touches **every** `:hover` in the bundle, third-party CSS included — deliberately, per §6.2. The local hatch is what makes that survivable, so §2 ships first. → §4.3, §5 |
| **Locked decisions** | **No conflict.** The `data-*` spelling follows §3.1 and §5.4 of [`../decisions/styling.md`](../decisions/styling.md) rather than amending them. **L7** is in tension with §4 and §5 says how. |

---

## 1. What already exists

Not a proposal — a reading of the tree at `824f0ea`. The two-tier idea is half-built, in two different
half-shapes, which is the actual problem this file solves.

### 1.1 The global tier is built, and is richer than a toggle

Two config blocks, split by enforcement layer:

```ts
patches: { caretRepaint, textMagnifier, viewportFreeze }   // booleans — the JS patches
ui:      { noSelect, hideScrollbars, touchCallout }        // UiPatchScope — the CSS patches
```

`UiPatchScope` is `"app" | "all" | "off"`, with **per-option defaults** in `utils/platform.ts`
(`UI_SCOPE_DEFAULTS`: `noSelect: "app"`, `hideScrollbars: "all"`, `touchCallout: "app"`), because the
options do not share a right answer. `"app"` means standalone + native. **That is scope-by-context, not
on/off**, and the registry must keep it rather than flatten it to a boolean.

The resolution mechanism carries an invariant the rest of this file must respect
(`src/config/app-config.ts`):

> *"Resolved **once**, in the pre-paint init script, against the runtime platform; the result is a
> boolean-presence attribute on `<html>`. So `styles.css` stays a single static artifact — **there is
> no per-config CSS and no build matrix**."*

### 1.2 The local tier exists twice, ad-hoc, in both enforcement layers

- **CSS**, in the shipped `active:` variant: `&:active:not([data-press-engine])`, with a documented
  three-branch rationale (engine element → `[data-pressed]`; plain element → `:active`; marker missing
  → falls back to `:active`, so a wiring mistake degrades to stock Tailwind rather than to nothing).
- **JS**, in the magnifier suppressor: `isProtectedTarget()` walks `target.closest(EDITABLE_SELECTOR)`.

Both work. Neither is reusable by the next patch, and neither shares a name with its config key. **That
is the whole gap.**

---

## 2. The registry

### 2.1 The shape

One declaration per patch, in one file, generating every surface that mentions it:

```ts
{
  name: "textMagnifier",        // → config key, and data-adaptv-no-text-magnifier
  layer: "js",                  // "css-layered" | "css-rewrite" | "js" | "build"
  scope: "boolean",             // "boolean" | UiPatchScope  (keep today's split — §1.1)
  default: true,
  hatch: true,                  // false ⇒ no local opt-out exists, deliberately (§2.4)
  reach: "all",                 // "all" (node_modules included) | "app" — §6.2
  why: "WebKit 231161 — the double-tap loupe is not fixable in CSS",
}
```

Two consumers read it and cannot disagree, because they read the same row:

- the **post-processor** bakes `:not([data-adaptv-no-<name>])` into the selectors it rewrites;
- the **runtime** exposes one shared `isPatchDisabled(el, name)` doing the `closest()` walk §1.2 already
  does by hand.

The generation is the point. A config key, a stamp attribute and a hatch attribute kept in step by
memory is exactly the failure `styling.md §5.4.1` describes for `cn.ts`'s conflict table — *"kept in
step with the CSS by memory. The entry nobody wrote was `cursor`."*

### 2.2 🔑 Two species of patch — and only one needs a marker

The inventory below is the reason this work is smaller than it looks.

**Species A — the patch is a CSS property.** `user-select`, `scrollbar-width`,
`-webkit-touch-callout`, `-webkit-tap-highlight-color`, `outline`. The local opt-out is **re-declaring
the property**, and adaptv already guarantees it works — `patches.css`'s own header:

> *"Everything here is inside `@layer adaptv.*`, so a consumer's ordinary unlayered rule overrides any
> of it at any specificity — `!important` is not needed and is BANNED."*

A consumer writing plain SCSS sets `user-select: text` and wins, without knowing adaptv exists. **No
marker, no registry lookup, no mechanism.** This is what `selectable` and `scrollbar-visible` already
are — utilities that set the property back, blessed by §5.4.1 precisely because the property has no
Tailwind equivalent.

**Species B — the patch is behaviour.** A rewritten selector (`hover:`, `active:`), a
`preventDefault()` (magnifier), a scroll lock (viewport freeze), a mute-and-repaint (caret). **There is
no property for the consumer to re-declare.** A `:hover` moved inside `@media (hover: hover)` cannot be
moved back out by any author rule. These are the five that need `data-adaptv-no-*`.

### 2.3 🔒 The marker is an attribute, not a class

Decided by the owner **2026-09-09**, having weighed the class form.

- **§3.1** locks boolean `data-*` over classes, and namespaces per component — the composition
  argument, evidenced by [Radix #602](https://github.com/radix-ui/primitives/issues/602), open since
  April 2021.
- **§5.4** locks *"A knob is a prop. A class may only extend a vocabulary the consumer already has"*,
  and distinguishes `pb-safe-offset-2` ✅ from `edge-fade-10` ❌ — *"a name adaptv invented, for a knob
  on one component"*, which shipped and was pulled back. `adaptv-no-active` is the second shape.
- **`className` is the consumer's channel** (§2). A marker living there has to be understood by
  `mergeStyles`/tailwind-merge, and a consumer who replaces `className` wholesale deletes the marker
  with no warning. An attribute is a separate channel and survives that.
- It works in hand-written HTML with no Tailwind — which is the case §4 exists to serve.

**Species A keeps its class**, because `selectable` is not a marker: it is a utility that sets a real
property, and §5.4.1 already blessed it. Two spellings, because there are two mechanisms — not an
inconsistency.

### 2.4 🔒 `hatch: false` — four patches keep no local opt-out

Decided by the owner **2026-09-09**. The registry declares the absence explicitly instead of leaving it
implicit in a comment, which is the only part of these that changes.

| Patch | Why no hatch |
|---|---|
| Focus-ring reset for mouse/touch | **WCAG 2.4.7 Level AA.** The source already says it: *"that is broken, not a preference, and it does not get a config knob."* |
| Autofill cover | *"nobody has a legitimate reason to want the broken behaviour, so a flag there would only be a way to break the app"* |
| `-webkit-tap-highlight-color` on `a[href]` | *"DOCTRINE and stays universal: it is a second, uglier press feedback drawn on top of the one adaptv already draws"* |
| safe-area `env()` ordering (crbug/40699457) | same line as the autofill cover — *"no knob and never will"* |

**The rule the registry encodes**, refined by the owner **2026-09-10**: a hatch exists **unless using
it would harm the user** — an accessibility guarantee, or a UA fight where the un-patched state is
genuinely broken rather than merely different. That is a wider rule than *"both behaviours are
legitimate"*, and deliberately so: where opting out costs the user nothing, the developer gets the
choice (§6.3). It is still not *"every patch gets a hatch"* — uniformity lives in the *registry*,
not in the *hatch*.

Three of the four above fail that test on harm — unreadable autofilled text, a missing keyboard
focus indicator, a broken safe-area layout. The fourth, `-webkit-tap-highlight-color` on `a[href]`,
rests on **doctrine** instead (*"a second, uglier press feedback drawn on top of the one adaptv
already draws"*), which is a weaker footing than the other three. Worth knowing when someone asks
for it later.

The ring-shadow rewrite is a fifth case and needs no row of its own reasoning: it is **byte-identical
on browsers that were never broken** (measured on device), so there is nothing to detect and nothing
to turn off.

### 2.5 ⚠︎ Hatches must be expensive to add — the repo has the scar

`use-suppress-text-magnifier.ts` records a previous version that exempted `.clickable`, `a[href]`,
`button` and the ARIA roles — and the comment's verdict:

> *"which is precisely why it kept appearing on them"*

**Too many exemptions made the patch fail at its job.** So the registry must make a hatch a named,
justified row — never a generic `adaptv-disable-<anything>` namespace where any string works. Five
attributes that each exist because someone argued for them; not an open vocabulary.

---

## 3. The inventory (2026-09-09)

Every patch adaptv applies today, its enforcement layer, and what it gets.

| Patch | Layer | Global tier today | Species | Local tier |
|---|---|---|---|---|
| `hover:` sticky + focus | css-rewrite | none | B | `data-adaptv-no-hover` (§6.3) |
| `active:` press | css-rewrite | none | B | `data-adaptv-no-active`, **beside** `[data-press-engine]` — §6.1 |
| `noSelect` | css-layered | `ui.noSelect` | A | `selectable`, already shipped |
| `hideScrollbars` | css-layered | `ui.hideScrollbars` | A | `scrollbar-visible`, already shipped |
| `touchCallout` | css-layered | `ui.touchCallout` | A | re-declare `-webkit-touch-callout` |
| Focus-ring reset | css-layered | — | A | **`hatch: false`** (WCAG) |
| Autofill cover | css-layered | — | A | **`hatch: false`** |
| Tap-highlight on `a[href]` | css-layered | — | A | **`hatch: false`** |
| safe-area `env()` ordering | css-layered | — | A | **`hatch: false`** |
| `caretRepaint` | js | `patches.caretRepaint` | B | `data-adaptv-no-caret-repaint` |
| `textMagnifier` | js | `patches.textMagnifier` | B | `data-adaptv-no-text-magnifier` |
| `viewportFreeze` | js | `patches.viewportFreeze` | B | `data-adaptv-no-viewport-freeze` |
| ring-shadow | build | — | — | none by design (§2.4) |

**Thirteen patches, four enforcement layers, five new markers.**

---

## 4. The CSS post-processor

### 4.1 What it is for, and the limit it closes

Today the `hover:` and `active:` corrections ship as Tailwind `@custom-variant`s, so they reach only
consumers who write Tailwind utilities. [`../decisions/styling.md`](../decisions/styling.md) §0.1 states
the limit itself:

> *"The fix covers `hover:` utilities, not `:hover` anywhere. A consumer who writes `.card:hover { … }`
> in their own stylesheet — still possible under this decision — gets stock behaviour."*

A post-processor over the **emitted** CSS closes that: it sees whatever the consumer's pipeline
produced — Tailwind, SCSS, plain CSS, CSS modules — and rewrites the `:hover` and `:active` rules in
it. The correction stops depending on how the consumer spells their styles.

### 4.2 The mechanism is already shipped, twice

`src/vite/tailwind-empty-fallback.ts` is the working model and should be copied wholesale:

- **A `transform` hook on CSS ids, with NO `enforce`.** This is a measured slot, and both sides are
  documented failures: `enforce: "pre"` runs before Tailwind's own `pre` generate plugin and sees the
  bare `@import`, with no utilities to rewrite; `enforce: "post"` is after Vite's CSS output stage and
  the rewrite silently does not happen. **Adding an `enforce` here breaks it with green tests.**
- **The decision is a pure function** — `rewriteRingShadow(css) → string | null` — so it is unit-tested
  without a bundler.
- **It refuses rather than guesses.** When its ordering assumption about Tailwind's output breaks, it
  declines to rewrite and prints why, instead of producing subtly wrong CSS.
- `isTransformableCssId` is already shared with `css-layer-order.ts`, so a third consumer is expected.

It also runs in dev: Vite serves CSS through the same pipeline, so there is no separate "flight-time"
mechanism to build.

### 4.3 Three problems, and the first is the real one

1. **Blast radius — opt-in becomes opt-out.** `@custom-variant hover` only affects a rule the consumer
   *typed* as `hover:`. A post-processor affects **every** `:hover` in the bundle, including CSS from
   third parties — a date picker, an editor, `normalize.css` — some of which mean the raw thing. This
   was a policy decision, and it is **settled in §6.2**: everything in the app's final output,
   `node_modules` included — which is what `isTransformableCssId` already admits — with a per-patch
   `reach` field for the narrower case. The hatch (§2) is what makes that safe to live with.
2. **Rewriting selectors is not rewriting declarations.** The ring regex is safe because a declaration
   body contains no `;` or brace. Selector lists need real tokenizing — commas inside `:is()`, strings,
   escapes — and the wrap must be an `@media` at-rule, **not** a selector prefix like
   `html[data-hover]`, because a prefix changes specificity and §3.1's contract treats specificity as
   load-bearing (the shipped variant is (0,2,0) deliberately, down from (0,4,0)).
3. **Double-wrapping.** Tailwind v4 already emits `hover:` inside `@media (hover: hover)`. The
   transform must detect a rule that is already inside one and skip it.

### 4.4 🔑 The invariant it must not break

`styles.css` is **one static artifact**; config resolves at runtime to an attribute on `<html>` (§1.1).
So the post-processor may bake the **hatch** — static, config-independent — but must **never** bake a
**config value**. The two compose into one selector that needs no build matrix:

```css
html[data-adaptv-active-patch] .foo:active:not([data-adaptv-no-active]) { … }
```

Global toggle and local opt-out both resolved by attribute, at runtime, off one stylesheet. Baking the
config instead would produce per-config CSS and lose that property.

---

## 5. ⚠︎ The tension with L7, and what resolves it

**L7: *"Guardrails teach, never mutate — never silently rewrite consumer code."*** A post-processor
that rewrites the consumer's own `:hover` rules is, literally, silently rewriting consumer code.

Today the shipped fix escapes L7 on a technicality that is actually a principle: the `@custom-variant`
only reaches what the consumer opted into by typing `hover:`. §4 removes that opt-in. So:

- **The local tier is not a convenience — it is what keeps §4 on the right side of L7.** The two halves
  of this document are load-bearing for each other, and shipping §4 without §2 would be the wrong
  order.
- **The rewriting must be auditable.** A count per patch of what was rewritten, surfaced at build or in
  `adaptv doctor`, so the behaviour can be seen rather than inferred. This is the CLI contract's own
  instinct — *"a diagnostic that hid what was broken would be worse than one that named a vendor"*.
  Magic that cannot be inspected is how a framework becomes undebuggable, and this one would be
  rewriting CSS the developer wrote by hand.

---

## 6. Decided inside this plan (2026-09-10)

### 6.1 The hatch sits **beside** `[data-press-engine]`, it does not replace it

The owner asked for one mechanism end-to-end, and the hatch **is** that mechanism — every patch, one
attribute, one shared helper. `[data-press-engine]` is not a competing hatch and deleting it is a
behaviour regression on all eight press primitives:

- **It is a routing selector, not an opt-out.** It answers *"which press implementation owns this
  element"* — the engine's `data-pressed`, or native `:active` — and adaptv decides that, not the
  developer.
- **Native `:active` is excluded on engine elements on purpose, twice over.** `data-pressed` is
  **reentrant** — it drops when the finger drags off the target and returns when it slides back in
  (`components/button.tsx`), which native `:active` cannot do and which cannot be cleared from JS. And
  keyboard activation must **not** set it: `hooks/use-gesture-engine.ts` — *"no data-pressed: keyboard
  activation must not animate (motion contract)"* — where native `:active` fires on Enter/Space.

The tree already contains the same category one patch over: the magnifier's `EDITABLE_SELECTOR`
exemption is *where the patch does not apply by definition* (an `<input>` keeps the loupe because that
is correct), not *a developer opting out*. **Applicability is per-patch implementation; the hatch is
uniform.** That distinction is what makes the registry a single mechanism without flattening patches
that differ for real reasons.

**The composed variant, with specificity preserved:**

```css
@custom-variant active {
  &[data-pressed]:not([data-adaptv-no-active])                        { @slot; }
  &:active:not(:is([data-press-engine], [data-adaptv-no-active]))     { @slot; }
}
```

⚠︎ **`:not(:is(a, b))`, never `:not(a):not(b)`.** [`../decisions/styling.md`](../decisions/styling.md)
§3.1 records that the chained form cost (0,4,0) where the grouped one is (0,2,0) — *"two extra
class-level points every consumer override had to out-specify"*. Adding the hatch must not spend that
again; `styles/utils.test.ts` already asserts the compiled selector and is where this is proven.

### 6.2 Scope — everything in the app's final output, `node_modules` included

Decided by the owner: a library shipping a custom component should get the correction too, so the
post-processor works on the app's whole emitted CSS rather than only on first-party source. **The
shipped mechanism already behaves this way** — `isTransformableCssId` excludes `?raw` / `?url` /
`?worker` (those hand the source to the app as *data*, so injecting into them would be silent
corruption), `/.vite/`, and `?commonjs-proxy`, and admits every other real `.css`. No `node_modules`
exclusion exists, and `ring-shadow-fallback.ts` has been rewriting on that basis in production.

**Scope is nonetheless a per-patch registry field**, not a global constant: a correction that is safe
to force on a third-party date picker is not the same class of change as one that is only ever right
for the app's own surfaces. The registry carries `reach: "all" | "app"` beside `scope`, defaulting to
`"all"`, so the narrow case is expressible without a second mechanism.

### 6.3 `hover:` gets a hatch

Decided by the owner: *the toggle costs nobody anything, and the developer should be free to choose.*
This is the case that widened §2.4's rule from *"both behaviours are legitimate"* to *"unless using it
would harm the user"* — sticky hover after a tap is an annoyance, not a broken guarantee, so there is
no reason to withhold the choice.

**One detail the hatch must respect:** adaptv only owns *half* of the `hover:` fix. §0.1 of the styling
decision is explicit — Tailwind v4 already compiles `hover:` inside `@media (hover: hover)`, and *"the
sticky-hover-after-tap fix is THEIRS, not ours"*; adaptv adds the `:not(:is(:focus, :focus-within))`
half so hover cannot beat a focus ring. So `data-adaptv-no-hover` removes **adaptv's half only** and
leaves stock Tailwind behaviour, rather than dropping the element back to raw `:hover`. Opting out of
adaptv is not opting out of the framework underneath it.

---

## 7. Sequencing and acceptance

**§2 before §4.** The registry is additive, touches no consumer-facing behaviour, and is what makes the
post-processor legitimate (§5). The post-processor without it is an unopt-outable rewrite of code the
consumer wrote.

Neither half needs a clean tree the way [`core-binding-split.md`](core-binding-split.md) does — this
touches `src/config/`, `src/styles/`, `src/vite/` and three hooks, not the widest surface in the repo.
It is independent of the `dist` cutover and of `src-reorg`.

**Done means:**

- One registry file; the config type, the pre-paint stamp list and the hatch attributes are all derived
  from it, with a test asserting no patch is named in two places by hand.
- `isPatchDisabled(el, name)` shared; `isProtectedTarget()` and the `active:` branch both go through it.
- `hatch: false` is a type-level fact, so a hatch for the focus-ring reset **cannot be added by
  accident** — it has to be a deliberate edit to a row that says why it is false.
- `rewriteHover(css)`/`rewriteActive(css)` are pure and unit-tested, including a third-party stylesheet
  fixture, an already-wrapped `@media (hover: hover)` fixture, and a selector list with `:is()` in it.
- The built stylesheet is grepped in a test: zero unwrapped `:hover` outside the allowed scope — the
  same shape of check `ring-shadow-fallback.ts` asks for (`var(--tw-ring-inset,)` must be 0).
- `pnpm gate` green, and the hover/active behaviour re-verified on a real touch device — a rewrite that
  is correct in a unit test and wrong on a finger is the failure this whole area exists to prevent.

---

## 8. What would make this a mistake

- **§4 shipping alone.** Without the registry, an aggressive rewrite of consumer CSS with no per-element
  escape is a framework that fights its user. §5 is the argument; §7's ordering is the mitigation.
- **The hatch namespace growing.** §2.5's scar is a real one — the magnifier patch stopped working
  because it exempted too much. Five markers is a design. Fifteen is a retreat.
- **Uniformity applied to the enforcement rather than the registry.** Forcing species A through a
  marker would replace a mechanism that already works for every consumer in every CSS dialect — the
  `@layer` guarantee — with one they have to learn. The registry is what should be uniform.
- **Confusing this with O24.** None of this requires dropping Tailwind, and none of it is blocked on
  that question. It does, however, change the answer: once the correctness fixes live below the
  authoring layer, Tailwind is demoted from a correctness requirement to ergonomics — which is the
  state in which O24 becomes an ordinary cost/benefit call instead of a risk to correctness.
