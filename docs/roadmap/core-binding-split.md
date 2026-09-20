# adaptv — the imperative core and the framework binding

> 📐 **A plan, not a change.** Decided by the owner **2026-09-09**: adaptv's primitives are split into
> a **framework-free imperative core** and a **thin React binding over it** — now, while the tree is
> small enough that the boundary is cheap to draw.
>
> **What is NOT decided is that adaptv ever ships a second binding.** Vue, Angular, Svelte and Solid
> are out of scope, unbudgeted, and unpromised → **O23** in
> [`open-questions.md`](open-questions.md). This work stands on organisation alone; portability is a
> consequence it buys, not the justification it rests on. A reader who takes this file as an on-ramp
> to `@adaptv/vue` has misread it — and §6 is the argument against that, from adaptv's own
> competitive analysis.

---

## The verdict, up front

| | |
|---|---|
| **The rule** | Behaviour that manipulates the DOM is a **framework-free module** that takes an element and returns a teardown. React appears only in the layer that renders markup and wires lifecycle. |
| **Why it is not a new idea** | **L9** ("reactive → hook over a `subscribe`/`get` accessor, *so non-React consumers can subscribe*") and **L11** ("push the platform branch to the lowest layer; geometry is DOM-free") already say this — for **capabilities**. `src/capabilities/` obeys it: **38 files, 5,815 LOC, zero React imports.** The primitives never got the same treatment. |
| **Why now** | Measured 2026-09-09: across the files that actually render, **markup is 6.9 % of the lines**. The other 93 % is logic wearing React's idiom. That ratio only gets worse — `drawer-engine.tsx` is already 1,860 LOC with **2** JSX tag lines. |
| **The size** | **~9,306 LOC across 18 files** move; ~1,754 LOC of thin hooks and ~5,971 LOC of view code stay where they are. No behaviour changes. |
| **The one genuine redesign** | `useGestureEngine` returns a **React-synthetic-event-typed props bag** to 8 primitives. It is the only place in the stack that hands back machinery-to-attach — a shape [`../design/architecture.md`](../design/architecture.md) §4 already forbids. → §3.4 |
| **Risk** | **High for its size**, and for the same reason as [`src-reorg.md`](src-reorg.md): nothing here changes behaviour, so "the gate is green" and "nothing broke" are different claims. The code with the most to move is also the most device-tuned code in the repo. → §4.4 |
| **Locked decisions** | No conflict. **L9** and **L11** are the precedent. **L1** and §5.0.0 of the register bound the *shape* of any future binding — a subpath, never a second package (§4.1). |

---

## 1. The argument

### 1.1 The organisation case stands alone

`src/components/drawer/` is the shape the rest of the tree does not have: `drawer-motion.ts`,
`drawer-easing.ts`, `drawer-constants.ts`, `drawer-fps.ts` and `drawer-chrome-tint.ts` are already
framework-free, and `drawer-engine.tsx` is what was left over. That leftover is 1,860 LOC. The split
is not being invented here — it was started, and it stopped halfway through one component.

The benefit is the ordinary one: a pure module is testable without a renderer, readable without
knowing hook rules, and reusable by adaptv's own non-React callers (the OTA updater and the CLI's
injected clients already are such callers).

### 1.2 The doctrine already says it, one layer down

[`../design/architecture.md`](../design/architecture.md) §4 states the ladder — accessor, headless
driver, component — and calls "platform-agnostic" everything above layer 1. That word means
**iOS-vs-Android-vs-web**, not React-vs-anything. §5.2 then makes the ladder a shipping rule: *"if a
primitive has a non-trivial hybrid layer, that layer ships as a public hook."*

This work extends the same sentence by one axis. The headless driver is currently agnostic about the
*platform* and married to the *framework*, and nothing in the doctrine intended that — it simply never
came up, because there has only ever been one binding.

### 1.3 What it buys, if the question is ever asked

If a second binding is ever built (**O23**), what remains is `binding + view`: thin subscriptions and
markup. That is the half of the work that *should* be per-framework — a Vue `<Drawer>` should be
written in Vue. What must not be per-framework is the drawer's flight sampling, its keyboard
avoidance, or its FPS guard, because those are where the device bugs live and three copies means two
of them are wrong.

The cost of *not* drawing the line now is not that the port becomes impossible. It is that the port
becomes a rewrite of code nobody dares touch.

---

## 2. The measurement (2026-09-09)

### 2.1 Method, and what these numbers are not

Counted over non-test `.ts`/`.tsx` in `src/`, by regex, on the tree at `824f0ea`:

- **React coupling** — the file imports `react` or `react-dom`.
- **DOM work** — occurrences of `document.` · `window.` · `.style.` · `addEventListener` ·
  `getBoundingClientRect` · `requestAnimationFrame` · observers · timers, and friends.
- **JSX region** — lines that open or close a tag, plus JSX-attribute lines (`name={` / `name="`),
  which object literals cannot produce because they use `name:`.

**These are a triage signal for ranking the work, not a semantic claim.** A high DOM count does not
prove a file is fully extractable; some of that work is legitimately React-lifecycle-shaped and will
stay. A first attempt at the JSX count used `<[A-Z]` and was wrong by ~10× on TS-heavy files, because
it matched generics like `useRef<HTMLDivElement>` — the numbers below are from the corrected count.
Re-derive rather than trust: the classifier is trivial to rewrite.

### 2.2 Where React actually is

| Surface | LOC | React |
|---|---:|---|
| `bin/` — the CLI, the largest single piece of the project | 22,843 | **none.** The one file naming TanStack is `bin/lib/opacity.mjs`, which exists to *erase* the name from output |
| `src/capabilities/` — the accessors | 5,815 | **none**, across 38 files |
| `src/vite/`, `src/native/`, `src/ota/`, `src/sw/`, `src/styles/`, `src/config/` | ~21,000 | none at runtime |
| `src/components/`, `src/hooks/`, `src/shell/`, `src/storage/` | 20,967 | **70 files, 18,173 LOC** |

Roughly half of `src/` and effectively all of `bin/` are already framework-free. **The question is only
ever about the 21k of UI code**, and §2.4 splits that.

### 2.3 Markup is 6.9 % of the code that renders

Over the 11,982 LOC in files that render anything:

| | Lines | Share |
|---|---:|---|
| JSX region (tags + attributes + closers) | **827** | **6.9 %** |
| Everything else | 11,155 | 93.1 % |

Per file, the pattern is sharper than the average:

| File | LOC | JSX region | Share |
|---|---:|---:|---:|
| `components/drawer/drawer-engine.tsx` | 1,860 | 2 tag lines | **~0 %** |
| `components/swipeable.tsx` | 1,079 | 31 | 2.9 % |
| `components/text-area.tsx` | 1,166 | 56 | 4.8 % |
| `components/switch.tsx` | 411 | 23 | 5.6 % |
| `components/image.tsx` | 843 | 72 | 8.5 % |
| `components/drawer/drawer.tsx` | 876 | 107 | **12.2 %** — the most view-shaped real primitive |
| `components/update-required.tsx` | 98 | 29 | 29.6 % — an actual view |

**The two files at the bottom are what a component is supposed to look like.** Everything above them is
a controller that happens to end in a `return`.

### 2.4 The four buckets

`src/components` + `src/hooks` + `src/shell` + `src/storage`, non-test, 20,967 LOC:

| Bucket | Test | LOC | Share | What happens to it |
|---|---|---:|---:|---|
| **pure** | no React import | 3,936 | 19 % | already done — it is the proof the shape works |
| **binding** | React, ≤110 LOC, ≤2 DOM ops | 1,754 | 8 % | stays React; a second binding rewrites it mechanically |
| **engine** | React, ≥13 DOM ops | **9,306** | **44 %** | **the work** — §2.5 |
| **view** | the rest | 5,971 | 28 % | stays React; genuinely per-framework |

### 2.5 The engine inventory — the work list

Ranked by size. `dom` is the DOM-operation count, `refs` counts `useRef`/`useCallback`/`useEffect`/
`useLayoutEffect` — a high `refs` with a low JSX count is the signature of an instance field and a
method wearing a hook's clothes.

| LOC | dom | refs | File | Note |
|---:|---:|---:|---|---|
| 1,860 | 89 | 84 | `components/drawer/drawer-engine.tsx` | 43 `useRef`. The single biggest prize, and the most dangerous — §4.4 |
| 1,166 | 33 | 20 | `components/text-area.tsx` | autosize + caret work; the iOS shims are the extractable part |
| 1,079 | 41 | 60 | `components/swipeable.tsx` | already has `swipeable-physics.ts` beside it; finish the job |
| 774 | 14 | 41 | `components/pull-to-refresh.tsx` | same — `pull-to-refresh-physics.ts` exists |
| 745 | 62 | 13 | `hooks/use-keyboard.ts` | **the layer-1 accessor.** Belongs in `capabilities/` on its own merits, and **O21** already asks for its decision half to be pure — same argument, one function |
| 619 | 20 | 39 | `hooks/use-gesture-engine.ts` | the press state machine — §3.4, do this one first |
| 455 | 49 | 2 | `hooks/use-caret-repaint.ts` | pure WebKit shim; near-zero React content |
| 360 | 22 | 7 | `components/avoid-keyboard/use-keyboard-avoidance.ts` | the canonical layer-2 driver in the docs |
| 358 | 20 | 12 | `components/dropdown/dropdown.tsx` | `dropdown-position.ts` already split out |
| 322 | 26 | 5 | `components/drawer/drawer-keyboard.ts` | not a `.tsx`; still imports React |
| 311 | 23 | 12 | `components/wheel-column.tsx` | `wheel-column-geometry.ts` already split out |
| 303 | 55 | 2 | `hooks/use-freeze-viewport.ts` | pure shim |
| 245 | 16 | 2 | `hooks/use-suppress-text-magnifier.ts` | pure shim |
| 191 | 29 | 3 | `hooks/use-theme.ts` | |
| 164 | 24 | 2 | `hooks/use-insets.ts` | |
| 144 | 13 | 6 | `components/edge-swipe-gestures.tsx` | |
| 138 | 14 | 2 | `hooks/use-scroll-edge-fade.ts` | |
| 72 | 14 | 3 | `hooks/use-media-query.ts` | |

Four of these — `use-caret-repaint`, `use-freeze-viewport`, `use-suppress-text-magnifier`,
`use-media-query` — are platform shims with **≤3 React calls between them**. They are a first
afternoon's work with essentially no risk, and they establish the pattern before anything expensive
moves.

---

## 3. The target shape

### 3.1 The rule

> **If it touches an element, it takes the element.** A core module exports a function or a factory
> that receives an `HTMLElement` (or plain values) and returns a result plus a teardown. It imports
> nothing from a view framework, and it names no framework type in its signature — `PointerEvent`,
> not `React.PointerEvent`.
>
> The binding owns three things and no others: **creating** the core object, **giving** it its element,
> and **destroying** it. Plus the markup.

### 3.2 Three shapes that already exist in the tree

Nothing here needs inventing; the repo has all three, and they cover every case in §2.5.

| Shape | Example | Signature |
|---|---|---|
| **Pure function over values** | `components/swipeable-physics.ts` | `springStep(…)`, `resolveSwipeRelease(…)` |
| **Pure function over an element** | `components/drawer/drawer-motion.ts` | `tweenDrawerPanelTransform(panel, …)`, `readPanelTranslateY(panel)` |
| **Factory with `subscribe`/`get`** | `capabilities/gesture-controller.ts` | `createGestureController()` + a module singleton |

The target for a stateful engine is the union of the last two: `createX(options) → { attach(el),
destroy() }`, with any reactive read exposed as `subscribe`/`get` so **L9** applies unchanged and a
React hook over it is `useSyncExternalStore` plus nothing.

### 3.3 The one non-obvious constraint

`drawer-motion.ts` is already the target shape and is **still** the file the animation work warns
about, because the *authoring site* of a transition is load-bearing on WebKit — a `@keyframes` rule
settles cleanly where an inline `transition` or `element.animate()` leaves a visible tremor
([`native-keyboard-curve.md`](native-keyboard-curve.md) §1). Moving code between modules must not
change **where** a transition is authored. This is the specific way a "no behaviour change" refactor
can change behaviour here.

### 3.4 The one genuine redesign — `useGestureEngine`'s props bag

`hooks/use-gesture-engine.ts` returns a `GestureHandlers` bag typed on `React.PointerEvent` and
`React.KeyboardEvent`, and **eight primitives consume it** — `button`, `pressable`, `link`, `switch`,
`checkbox`, `swipeable`, plus `press-core.ts` and `use-gesture-capture.ts` on top.

Two reasons this is the first thing to move, not the last:

1. **The doctrine already forbids the shape.** [`../design/architecture.md`](../design/architecture.md)
   §4: *"A primitive returns a **value**, never platform-specific machinery-to-attach."* The rule was
   written about platforms; the engine is the stack's one exception to it on either axis.
2. **Synthetic events are the only thing in the tree that genuinely does not port.** React's synthetic
   event is not a DOM event and has no equivalent elsewhere. Every other file in §2.5 is native DOM
   already.

The fix is the same one that satisfies the doctrine: the engine binds **native** listeners to the
element it is given, and the props bag disappears. That is a real interface change to eight call
sites — hence "redesign", and hence the recommendation to do it while the call sites are eight.

### 3.5 Where the files go

Deliberately **not settled here**, because [`src-reorg.md`](src-reorg.md) §0 has an open proposal on
the same tree: divide by **execution face** (`src/vite/` → `src/build/`, absorbing `src/native/`).

The two axes are orthogonal and compose — the client-runtime face subdivides into core and binding —
but they must not land as two independent file-moves over the same directories. **Whichever runs
second inherits a merge conflict across ~40 files.** Sequencing is §5.

Two options, for whoever picks this up with `src-reorg` in hand:

- **A — by layer:** `src/core/` holds the framework-free modules; `src/components/` and `src/hooks/`
  keep only binding + view. Loudest boundary, biggest move.
- **B — beside the consumer:** keep today's directories and the `drawer/` convention — `x.ts` is core,
  `x.tsx` is binding. Nearly free, already half-built, and enforceable by the same gate (§5.3). **The
  weaker signal is the real cost:** nothing stops a `.ts` file from importing React, which is exactly
  what `drawer-keyboard.ts` does today.

The gate matters more than the layout. B with the gate beats A without it.

---

## 4. What this does not license

### 4.1 Not a second package

**L1** is single-package, and register §5.0.0 records why the scope cannot move: GitHub Packages
requires the npm scope to match the repo owner, so `@adaptv/vue` does not exist as an option without
going public and re-scoping. If a second binding is ever built, its shape is a **subpath export** —
`@arrzdev/adaptv/vue` beside `/router` and `/components` — and the peer dependency on `react` becomes
optional per subpath. Nothing in this work should assume otherwise, and nothing in it requires a
package split to be worth doing.

### 4.2 Not a rewrite of the view layer

The 5,971 LOC in the **view** bucket stays exactly as it is. JSX is not a problem to be solved; it is
the 6.9 %.

### 4.3 Not a compatibility shim

adaptv is unpublished and carries no migration paths (register **O14**). An extracted module replaces
its predecessor; the hook does not stay behind as a re-export "for now".

### 4.4 Not an occasion to re-tune anything

The heaviest files in §2.5 are the most device-tuned code in the repo: the drawer's easing is settled
over four device ladders, and [`native-keyboard-curve.md`](native-keyboard-curve.md) §2 already says
**do not retune the existing curve** while doing adjacent work. That instruction transfers here
verbatim, and extends: no constant, no easing, no threshold, and no timer value changes in a commit
that moves a file. A behaviour change hidden inside a refactor of this size is not reviewable.

---

## 5. Sequencing and acceptance

### 5.1 Preconditions

**Every open PR merged and the tree clean.** This touches the widest surface of any pending item, and
it produces conflicts with anything editing the same files. That is the owner's stated reason for
recording it rather than starting it.

Also settle its order against [`dist-cutover.md`](dist-cutover.md) (#3) and
[`src-reorg.md`](src-reorg.md) (#11): the cutover flips `exports` to built output, so it wants a
stable file layout under it, and `src-reorg` moves the same directories (§3.5).

### 5.2 Order

1. **The four pure shims** — `use-caret-repaint`, `use-freeze-viewport`,
   `use-suppress-text-magnifier`, `use-media-query`. ~1,075 LOC, almost no React content, establishes
   the pattern and the gate on cheap files.
2. **`use-gesture-engine`** — the interface redesign (§3.4), while it has eight call sites.
3. **`use-keyboard` → `capabilities/`** — it is a layer-1 accessor filed under hooks; the move is
   correct independent of everything else here.
4. **The half-split components** — `swipeable`, `pull-to-refresh`, `wheel-column`, `dropdown` each
   already have a physics/geometry sibling. Finish those, and the pattern is proven at real size.
5. **`drawer-engine`** — last, alone, and with the device ladders re-run.

### 5.3 The gate — what makes it structural

A rule nobody enforces decays; the repo has already made this argument twice (rendering.md §3.1.2 on
generating rather than remembering, and `src/execution-boundary.test.ts` on the browser/node split).

`src/execution-boundary.test.ts` is the working model and should be copied, including its two-check
structure: **an allow-list** naming every module permitted to import React, and **an import-graph
closure** from the core entry points asserting React never appears in it — because an allow-list alone
can be widened by editing one line, and a closure alone misses files no entry imports.

**Without this test, the work is a one-time tidy that regresses within a month.** With it, the split
is a property of the build.

### 5.4 What "done" means

- Every file in §2.5 is either framework-free or reduced to binding + view.
- The React-import closure over the core entries is **empty**, asserted by a test in the gate.
- No signature in a core module names a framework type.
- `pnpm gate` green, and the device ladders re-run for the drawer and the keyboard
  ([`owed-device-verification.md`](owed-device-verification.md) is where those live).
- Bucket counts re-measured and this file updated — or, since it will have shipped, **deleted** and
  its rule re-tensed into [`../design/architecture.md`](../design/architecture.md) §4, per the eviction
  test in [`README.md`](README.md).

---

## 6. What would make this a mistake

**The strongest argument against it is in adaptv's own competitive analysis.**
[`../decisions/positioning.md`](../decisions/positioning.md) §1 documents *how* Ionic is dying, and the
mechanism is precisely multi-binding maintenance: `@ionic/angular` + `@ionic/react` + `@ionic/vue` at
~1.5M combined downloads, human commits down 82 % from peak, 80 % of the last year's from three
people, and `@ionic/react-router` still pinned to React Router **v5** with the v6 issue open since
November 2021 at 409 👍 — the highest-voted issue in the repo. Three bindings is not a feature they
shipped; it is the reason none of them is current. adaptv is one person.

That argument lands on **O23** — whether to ship a second binding — and it lands hard. It does **not**
land on this file, and the distinction is the whole reason the two are separate:

- Extracting a framework-free core is **one** artefact, better organised.
- Shipping `@adaptv/vue` is **N** artefacts to keep current, forever.

The failure mode to actually guard against is treating this document as the first half of the second
thing. The honest risks are narrower and worth stating:

- **Churn on the repo's most fragile code** for a benefit that may never be collected. §5.2 orders the
  work so the fragile part is last and can simply be left undone — steps 1–4 are worth having on their
  own, and stopping after any of them is a valid outcome.
- **A boundary that costs more than it returns.** If a core module ends up needing five arguments to
  avoid knowing about React, the split was drawn in the wrong place. That is evidence, not a setback:
  record it here and move the line.
- **Indirection for its own sake.** A 40-LOC hook that becomes a 40-LOC controller plus a 15-LOC hook
  is worse. The `≥13 DOM ops` threshold in §2.4 exists to keep those files out; the **binding** bucket
  is not a to-do list.
