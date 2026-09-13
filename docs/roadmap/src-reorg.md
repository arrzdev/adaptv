# adaptv — reorganising `src/`

> 📐 **A plan, not a change.** Two questions, answered in order.
>
> **§0 — *what shape does a thing like adaptv want?*** Answered against the real source trees of nine
> peer frameworks, **2026-09-01**. Short version: adaptv is missing the one division every peer has,
> and it can have most of that division for three moves and no new convention.
>
> **§1–§7 — three specific proposals** the owner made, surveyed against the tree on **2026-08-30**.
> One is worth doing narrowly; two are not. §0 **confirms all three verdicts** and renames one
> directory inside the first.
>
> **Risk: high for its size.** Nothing here changes behaviour, which is exactly why it is dangerous —
> a reorg is the one kind of change where "the gate is green" and "nothing broke" are different
> claims. §7 is the part to read before starting.

---

## The verdict, up front

### A. What would be ideal → §0

| | |
|---|---|
| **What adaptv is** | One package with **four execution faces** — a CLI, a build-time plugin, a client runtime, and an edge entry — plus a ~10-module **shared** set that two faces both import. |
| **What every peer does** | Divides the framework package by **where the code executes** first, and by feature or layer second. SvelteKit is `core/` · `runtime/` · `exports/`; Next.js is `build/` · `server/` · `client/` · `shared/`; Astro, Nuxt and React Router encode the same axis three other ways. |
| **What adaptv does** | Divides by **layer** only. The execution face is real — `tsdown.config.ts` and `scripts/verify-dist.mjs` each hand-maintain a `browser` list and a `node` list — but it appears **nowhere in the tree** and **nothing enforces it**. |
| ✅ **The recommendation** | **Not the full SvelteKit shape** — that is a ~240-file move for a distinction 90 % of the tree does not need. **Name the minority face instead:** `src/vite/` → `src/build/` (its name is already wrong), absorb `src/native/` into it, and turn the boundary into a gate. **Three moves, ~40 files, one new test.** → [§0.5](#05-the-three-moves-worth-making) |
| 🔓 **Locked decisions** | **No conflict.** L1, L9, L11, L14, L20, L21 all survive intact — the execution axis is *orthogonal* to the layer ladder, not a competitor. The peers **confirm L1**: every package split they have is forced by an external consumer adaptv does not yet have. → [§0.6](#06-what-this-changes-and-what-it-does-not) |

### B. The three proposals → §1–§4

| # | Proposal | Verdict | One line |
|---|---|---|---|
| 1 | **Group by domain** | ⚠︎ **Yes, for two subsystems only** | OTA and route-tints are genuinely torn across four directories each; `components`/`hooks`/`capabilities`/`utils` are not scattered — they are a **layer** decomposition that **L9** and **L11** are written in terms of. *§0 confirms this and renames the build half of each slice `build/`, not `vite/` — Nuxt's exact pattern.* |
| 2 | **Tests in their own folder** | ❌ **No** | 125 of 133 `src/` tests sit beside the file they test; the `#adaptv/*` alias already makes test imports path-independent, so co-location costs nothing it would recover — and the navigation pain the owner is describing is one directory (`src/vite/`, 64 entries), which proposal 1 fixes directly. *The peers split 3–3 on this; the two closest analogues co-locate. → [§0.6](#06-what-this-changes-and-what-it-does-not)* |
| 3 | **Domain-first filenames** (`user.route.ts`) | ❌ **No in `src/`** | The convention already lives in this repo, in the place it earns its keep: the **playground app** (`settings.page.tsx`, `providers.layout.tsx`). The framework's directories already state the domain, and `src/sw/` already uses the **inverted** form (`sw.navigation.ts`), so adopting it would create a second convention rather than one. *No peer does subject-first; the two that use filename conventions at all — Astro's `vite-plugin-*/`, Nuxt's `module.ts` — are **kind-first**, like `src/sw/`.* |

---

## 0. What adaptv is — and what its peers do with it

> The prior question. §1–§7 evaluate three proposals; this section asks what shape the thing *wants*,
> judged against how nine other frameworks solve the same problem. Read it before §1 — it changes one
> directory name inside §2.2 and it settles the ordering in §6.

### 0.1 Four faces, one package

Not a claim about the design — a reading of [`../../package.json`](../../package.json) and
[`../../tsdown.config.ts`](../../tsdown.config.ts). **One published package, four kinds of code that
never run in the same process.**

| Face | Where it lives | Src files | Runs on | Enters the user's phone? |
|---|---|---:|---|---|
| 🖥 **CLI** | `bin/` (`.mjs`, type-checked through `tsconfig.bin.json`) | 37 | the dev's machine, as a process | ❌ never |
| 🔧 **Build-time plugin** | `src/vite/` · `src/native/` | 40 | the dev's machine, inside Vite | ❌ never |
| 📱 **Client runtime** | `components` `hooks` `capabilities` `shell` `storage` `utils` `routes` `styles` `sw` `ota` | 175 | the user's browser / WebView | ✅ **every byte** |
| ☁️ **Edge entry** | `src/interface/server-entry.ts` | 1 | a Cloudflare Worker | ❌ (SSR only) |
| 🔀 **Shared** | `src/config/` + 10 modules inside the runtime dirs | 5 + 10 | **both** build-time and runtime | ✅ partly |
| 📖 **Public surface** | `src/interface/*.index.ts` | 14 | — (curated barrels, **L20 🔒**) | — |

**The distinction is not cosmetic.** A build-time module may open a socket, shell out, and depend on
`sharp`; a runtime module is measured in kilobytes on a cold 3G launch. Today **nothing in the tree
says which is which** — `src/native/` sits beside `src/capabilities/` and reads like a runtime
capability, while being 100 % `node:fs`.

<details>
<summary>The evidence, module by module — where the faces actually cross</summary>

**The `node:` blast radius is 26 files, and 22 are in one directory.** Non-test files importing a
`node:*` builtin: 22 in `src/vite/`, 2 in `src/native/` (`installed-plugins.ts`, `stamp-privacy.ts`),
1 in `src/ota/` (`native-fingerprint.ts` — `node:crypto`), 1 test-helper in `src/styles/`. Nothing
else in `src/` touches Node. **The tree already sorts by face; it just does not say so.**

**One of those four sits in a directory a browser barrel points into.** `src/interface/ota.index.ts`
is a `platform: "browser"` tsdown entry and its directory contains a `node:crypto` module. It is safe
**only because the barrel is curated** — `ota.index.ts` exports `policy`, `updater` and one type from
`store-release`, and never `native-fingerprint`. So **L20's curated barrel is doing platform-safety
work nobody wrote it to do** (§2.5 is the reason that still holds). Since the OTA slice that is
checked rather than trusted, by `src/interface/ota.barrel.test.ts` — which also covers the half
`execution-boundary.test.ts` cannot: a barrel that falls *behind* its directory.

**`src/config/` imports no `node:*` at all** — which is why the Node-platform tsdown entry is safe in
the *other* direction too, and why the question in [§0.6](#06-what-this-changes-and-what-it-does-not)
about where it belongs is genuinely open rather than forced.

**Ten modules are imported from both faces.** Measured as "reachable from `src/vite|native|config`
*and* from a runtime directory":

| Module | build-time importers | runtime importers |
|---|---:|---:|
| `config/app-config` | 10 | 3 |
| `config/types` | 1 | 5 |
| `utils/platform` | 1 | **27** |
| `shell/boot-fallback` | 3 | 1 |
| `shell/theme-init-script` | 1 | 3 |
| `shell/route-tints` | 2 | 2 |
| `shell/critical-css` | 1 | 1 |
| `ota/policy` | 2 | 3 |
| `ota/manifest-signing` | 1 | 1 |
| `native/installed-plugins` | 2 | 1 |

This is Next.js's `shared/` bucket, unnamed and scattered across five directories.

**The one invariant that keeps the browser build from swallowing `node:fs` is a code comment.**
[`../../tsdown.config.ts`](../../tsdown.config.ts) builds `config` as a **Node** entry, and says why
that is safe: *"every browser-surface import of a `config/*` module is `import type` (erased at
build), so no browser entry drags a `node:` builtin into its graph."* **Verified true today** — all
8 such imports are `import type`. **Nothing checks it.** [`../../biome.json`](../../biome.json)'s
`noRestrictedImports` bans `./` and `../`, and nothing else; there is no rule on `node:*` and no test
over the tree. One `import { defineApp }` in a component and the browser bundle changes shape.

**The CLI reaches into five directories by string.** 18 `loadAdaptvModule("…")` call sites resolve
paths at runtime, invisible to `tsc` and Biome but each checked for existence by
`bin/lib/load-ts.test.mjs` (§7): 7 into `vite/`, 5 into `ota/build/`, 2 into `config/`, 3 into
`native/`, and **1 into `utils/color.ts` — a file in the browser build.**

</details>

### 0.2 The peers, and whether adaptv may copy them

Read from the live trees, **2026-09-01**. The column that matters is the last one: **L1 🔒** locks
adaptv to a single package, so a division that is package-shaped for someone else is only useful here
if it survives being demoted to a directory.

| Peer | Packages | Divisions of the *one big* package | The principle | Available to adaptv? |
|---|---|---|---|---|
| **[SvelteKit](https://github.com/sveltejs/kit/tree/main/packages/kit/src)** | 11 (6 are deploy adapters) | `core/` · `runtime/` · `exports/` · `utils/` · `types/` | **when the code runs**: build (`core/`), in the app (`runtime/`), what the consumer imports (`exports/`) | ✅ **entirely** — the closest precedent |
| **[Next.js](https://github.com/vercel/next.js/tree/canary/packages/next/src)** | 1 published | `build/` · `server/` · `client/` · `shared/` · `cli/` · `lib/` · `export/` · `compiled/` | **which environment executes it**, with a fourth `shared/` bucket for code both bundler layers need | ✅ entirely |
| **[Astro](https://github.com/withastro/astro/tree/main/packages/astro/src)** | multi | `core/` · `runtime/{client,server}` · `cli/` (one dir per verb) · **23 × `vite-plugin-*/`** | same axis; the build half is one flat directory **per plugin** | ✅ entirely |
| **[Nuxt](https://github.com/nuxt/nuxt/tree/main/packages/nuxt/src)** | multi | `core/` (all build) · `app/` (all runtime) · 5 feature modules, each `module.ts` **+** `runtime/` | same axis expressed **per feature**: the build half and the shipped half in one folder | ✅ entirely |
| **[TanStack Start](https://github.com/TanStack/router/tree/main/packages)** | 42 | `start-plugin-core` (build) vs `start-client-core` / `start-server-core` (runtime); inside `react-start`, a `plugin/` subdirectory exported as `./plugin/vite` | same axis, as **packages** — but the framework package still keeps its build surface in a directory | ⚠︎ as directories only |
| **[React Router v7](https://github.com/remix-run/react-router/tree/main/packages)** | 10 | `react-router-dev/` → `vite/` · `cli/` · `config/` · `typegen/`; `react-router/lib/` → `router/` (env-free) · `dom/` · `server-runtime/` · `rsc/` | env-free core plus **one directory per executing environment** | ✅ entirely |
| **[Expo](https://github.com/expo/expo/tree/main/packages)** | 121 | `@expo/cli/src/` = one dir per verb; `@expo/config-plugins/src/` = `ios/` · `android/` · `plugins/` · `utils/` | packages exist for **native autolinking** — each capability ships `ios/`, `android/` and an `expo-module.config.json` that a `node_modules` walk must find | ❌ the package split · ✅ everything inside one |
| **[Ionic](https://github.com/ionic-team/ionic-framework)** | 8 | `core/src/` → `components/` (97) · `utils/` (18 subdirs) · `global/` · `css/` · `themes/` | packages exist only for **incompatible peer deps** (React vs Angular vs Vue); every *layer* is a directory in `core/` | ❌ the package split · ✅ the rest |
| **[Capacitor](https://github.com/ionic-team/capacitor)** | 4 + plugins | `core/src/` = **8 flat files**; `cli/src/` → `tasks/` · `ios/` · `android/` · `util/` | packages encode **who consumes the artifact** — bundler, Node, CocoaPods, Gradle | ❌ the package split |

**Nine peers, one axis.** Every single one divides its framework code by *where it executes* before
it divides by anything else. Six can do it inside one package and do. The three that cannot —
Expo, Ionic, Capacitor — split into packages **for a reason adaptv does not have**, and their
internals are still directories.

<details>
<summary>The three package-shaped divisions, and why none of them applies to adaptv <b>yet</b></summary>

1. **Compiled native code a build system discovers by walking `node_modules`.** Expo's ~85 capability
   packages each ship `ios/` + `android/` + `expo-module.config.json`; Capacitor's plugins ship a
   `capacitor` key. `@capacitor/ios` and `@capacitor/android` have **no `main`, no `types`, no
   JavaScript at all** — npm as a pure pipe for Swift and Gradle sources. A directory is invisible to
   a CocoaPods or Gradle resolution walk, so this one genuinely cannot be a folder.
   **adaptv has exactly one of these on the horizon:** the first-party `@adaptv/shell` Capacitor
   plugin ([`native-shell-plugin.md`](native-shell-plugin.md), roadmap #2). **L1's own escape hatch
   names it** — *"promote to `packages/*` only when the native plugin or `create-adaptv` need separate
   publishing."* The peers confirm that clause is drawn in exactly the right place.
2. **Incompatible peer-dependency sets.** Ionic's six binding packages exist because one package
   cannot peer-depend on both React and Angular. adaptv is React-only by design.
3. **Per-host deploy adapters.** SvelteKit's six. adaptv's equivalent is `static-host.ts` vs
   `native-bundle.ts` — two files, and **L14 🔒** requires their *separation*, not their publication.

Everything else in all nine is internal organisation that transplants to directories: verb-per-
directory CLIs (Expo, Capacitor, Astro), platform-per-directory build tools (`config-plugins`'s
`ios/` + `android/` mirroring 26 concern-named files each), concern-per-directory runtimes (Ionic's
18 `utils/` subdirs). And a calibration point worth keeping: **`@capacitor/core/src` is eight flat
files with no subdirectories** — the entire JS runtime of a production native bridge. Directory depth
is not what makes a framework serious.

</details>

### 0.3 The ideal shape, stated plainly

If the tree were written today against that evidence, it would be **SvelteKit's**, because SvelteKit
is the peer whose constraints match: a framework of this scope, in one package, with a build half, a
shipped half, and a curated public surface.

```
src/
  build/          ← src/vite/ (36) + src/native/ (4).  Node. The dev's machine. Never bundled.
    plugins/        ban-server-apis, css-layer-order, ring-shadow-fallback, manifest,
                    default-icons, adaptv-image, deploy-server, shell-emit, sw-build,
                    sw-dev, static-host, native-bundle            (14)
    modules/        the virtual-module providers                   (5)
    native/         privacy manifest, plugin discovery, doctor     (4, was src/native/)
    support/        icon-set, adaptv-dir, capacitor-config, stamp, build-tag,
                    verify-patches, app-shell, thunk-specifiers…  (16)
    adaptv-plugin.ts  the composition — the array whose ORDER is the contract
  runtime/        ← the 175 files that reach a phone. The L9/L11 ladder, unchanged, one level down.
    components/ hooks/ capabilities/ storage/ shell/ routes/ styles/ sw/ utils/
  shared/         ← config/ + the 10 modules §0.1 measured crossing the boundary
  interface/      ← unchanged. This is already SvelteKit's `exports/`.
```

Two things to notice about that block. **adaptv already has two of the five divisions** —
`src/interface/` *is* `exports/`, and `src/utils/` *is* the shared floor. And the layer ladder
(`components → hooks → capabilities → utils`) survives untouched inside `runtime/`: the execution axis
is **orthogonal** to the layer axis, which is why Next.js has both `client/` *and* layers inside it.

### 0.4 The distance, and why the full move is the wrong trade

**~240 of 241 source files move.** Every `#adaptv/*` specifier in **710 import lines**, all **93**
relative lines in the barrels, all 13 `tsdown` entries, all 16 CLI string loads, **255** doc
references and **49** in-code path comments (§2.4). That is the entire tree, in one axis, for one
property.

And the return is lopsided:

| Division | What it buys | Files it costs |
|---|---:|---:|
| `build/` | ✅ **the whole point** — names the 40-file minority face, and puts `src/native/` on the correct side of it | 40 |
| `shared/` | ⚠︎ real, but the set is 10 modules and their *current* homes are meaningful (`utils/platform` has 27 runtime importers; moving it to `shared/` would be filing by its 1 build-time importer) | ~15 |
| `runtime/` | ❌ **nothing.** A prefix shared by nine directories that are already all runtime discriminates between nothing. SvelteKit needs `runtime/` because `core/` is its sibling; adaptv gets the same discrimination by naming only the minority | ~175 |

> 📐 **The finding.** The axis the peers share is the right one and adaptv is missing it — but adaptv
> is missing it as a **rule**, not as a **tree**. The tree already sorts this way: 22 of the 26
> Node-touching files are in one directory. What is absent is a name that says so and a gate that
> keeps it true.

### 0.5 The three moves worth making

| | Move | Files | Why it earns its cost |
|---|---|---:|---|
| **A** | **A `node:` boundary test.** ✅ **Landed** as [`../../src/execution-boundary.test.ts`](../../src/execution-boundary.test.ts). It walks `src/`, asserts no `node:*` import outside a named allow-list — exactly `src/vite/**`, `src/native/**`, `src/ota/native-fingerprint.ts` and `src/styles/compile.test-helper.ts`, re-derived from the tree and confirmed — and asserts every browser-surface import of `config/*` is `import type` (8 of them, all type-only). `*.test.ts` is out of the allow-list, but only because a second assertion proves no test file is reachable from a published entry. | **0** | Turns [`../../tsdown.config.ts`](../../tsdown.config.ts)'s hand-verified comment into `pnpm gate`. Same shape as the guards already in `src/interface/capabilities.barrel.test.ts`. **It is the net under every later move, not a standalone item** — each step below is provable because it is there. |
| **B** | `src/native/` → `src/build/native/` | **4** | 100 % Node, and its current name reads as a runtime capability sitting beside `capabilities/`. It is adaptv's `@expo/config-plugins` — build-time native-project mutation — and both Expo and Capacitor put that inside the build tool. |
| **C** | `src/vite/` → `src/build/`, with `plugins/` · `modules/` · `support/` inside | **36** | **The name is already wrong.** [`../design/vite-plugin-map.md §3`](../design/vite-plugin-map.md) lists 15 of its files as *"support modules (not plugins)"*, and **11 of the CLI's 16 string loads target it** — `bin/` treats `src/vite/` as "adaptv's Node library", not "the Vite plugin". SvelteKit calls this `core/`; Astro calls it `core/` + `vite-plugin-*/`; TanStack calls it `start-plugin-core`. **This subsumes §3.5's fallback suggestion** and does the extra job of naming the face. |

**The order is A → OTA slice → router slice → B + C**, and §6 sequences it. A is not the first of
three moves; it is the floor the other two stand on. The slices come before C for a reason worth
stating on its own, because it is also the reason the paragraph after it is right:

> 📐 **Cohesion decides the tree; the execution boundary is a rule, not a directory.**
> Build-time, runtime and CLI are not separable products. The pieces together are what makes adaptv a
> **framework** rather than parts of an incomplete puzzle — an app author writes one config, runs one
> CLI, and imports from one package, and the seam between the faces is one they never see. A tree
> that leads with the execution face divides the thing along that invisible seam and scatters each
> subsystem across it. So the tree is organised by **cohesion — domain first** — and the boundary
> that genuinely must hold is held by **move A's test**, which is exactly what a rule is for.
>
> **That settles the ordering mechanically too.** Move C renames `src/vite/` → `src/build/`. Run it
> first and the OTA and router build-halves land in `src/build/`, then move *again* into
> `src/ota/build/` and `src/router/build/` — two moves where there should be one, and each one
> rewrites the CLI string loads that [§7](#7-how-to-prove-a-move-changed-nothing) says no gate
> catches. Slices first, and every one of those files moves exactly once.

**Do not** add `src/runtime/` or `src/shared/`. Not merely because they are expensive — [§0.4](#04-the-distance-and-why-the-full-move-is-the-wrong-trade)
prices them at ~190 files — but because they are the same mistake one scale up: a directory whose
whole content is *"this half runs somewhere else"* buys nothing move A's test does not already
assert, and it spends the cohesion the slices exist to gain. If the shared set ever needs a name, the
cheap form is a comment header in each of the ten files, not a directory.

> ⚠︎ **A and B are cheap; C is not, and the cost is concentrated in the one place §7 says no gate
> catches.** Renaming `src/vite/` rewrites 11 CLI string loads that fail only when that command runs.
> **The acceptance test for C is `adaptv build ios` and `adaptv ota publish` on the playground**, not
> a green gate.

### 0.6 What this changes, and what it does not

| Verdict | Under this lens |
|---|---|
| **§1 — the layer ladder is load-bearing** | ✅ **Confirmed, and by every peer.** Next.js has `client/` *and* layers inside it; Nuxt has `app/` *and* composables inside it. Layer and execution face are different axes, and the peers keep both. **L9/L11 are untouched.** |
| **§2 — OTA + router slices** | ✅ **Confirmed, and this is Nuxt's exact pattern**: a feature folder holding a build half and a runtime half. But **rename the build half `build/`, not `vite/`** — Nuxt calls it `module.ts` + `runtime/`, TanStack calls it `plugin/`, and neither names the bundler. `src/ota/build/` and `src/router/build/`. §2.2 is updated. |
| **§2.3 — `patches/` cannot move** | ✅ Unchanged. **L21 🔒** and a published path. |
| **§2.5 — barrels stay hand-written** | ✅ **Strengthened.** §0.1 found the curated barrel is *already* the only thing keeping `node:crypto` out of the browser `ota` entry. A globbed barrel would ship it. |
| **§3 — tests stay co-located** | ⚠︎ **Stands, but the peers do not back it up as cleanly as the rest.** Measured: **Next.js** 147 co-located siblings under `packages/next/src/`, **SvelteKit** 45 `*.spec.js` beside source, **React Router** 157 in `__tests__/` next to source — against **Astro** 0 (all 827 in `packages/astro/test/`), **Nuxt** 0, **TanStack** 1 (333 in `packages/*/tests/`). **3–3.** The tie-break is that the two closest structural analogues — SvelteKit and Next.js — co-locate, and that §3.3's reasons are repo-specific and unmoved by any of this. No verdict change; the confidence is honestly lower than §3.5 implies. |
| **§4 — no domain-first filenames** | ✅ **Confirmed; no peer does subject-first.** The two that use a filename convention at all use **kind-first**: Astro's 23 `vite-plugin-*/` directories, Nuxt's `module.ts`. That is `src/sw/`'s existing direction, which is §4.1's argument arriving from outside the repo. |
| **§3.5 — the `src/vite/` subdirectory fallback** | ⬆️ **Promoted into move C.** Same three groups (`plugins/`, `modules/`, `support/`), same ~36 files, plus the rename that makes the directory mean something. |

**Nothing here conflicts with a locked decision.** L1, L9, L11, L14, L20, L21 all survive; the peers
positively **confirm L1** and its native-plugin escape hatch (§0.2). One question is genuinely open
and belongs to the owner, not to this plan:

> ❓ **Is `src/config/` build-time or shared?** [`../../tsdown.config.ts`](../../tsdown.config.ts)
> builds it as a **Node** entry; five runtime files import it (type-only). Next.js would call it
> `shared/`, SvelteKit would split it into `core/config/` + `types/`. **Move A makes either answer
> safe, so this does not block anything** — but if the answer is "build-time", `src/config/` belongs
> under `src/build/` in move C, and if it is "shared", it stays exactly where it is. Recommendation:
> **leave it**, and let the test carry the invariant.

<details>
<summary>One inconsistency found while surveying — it does not belong to this plan</summary>

- **`./server-entry` and `./root-route` were in `exports` but not in the publish spec.**
  `package.json` exported 16 subpaths; `scripts/verify-dist.mjs`'s `jsEntries` listed 12, and
  `tsdown.config.ts` built 13. `./server-entry` (the Cloudflare Worker handler — the fourth face)
  had **no dist entry at all**, and `./root-route` was built but absent from the publish spec.
  **Closed in `9bf94b2`**: `jsEntries` is now read off `exports`, so a subpath nothing builds is
  a named failure; `server-entry` builds from its own `workerEntry` in `tsdown.config.ts`.
  → [`dist-cutover.md`](dist-cutover.md) carries the rest of the cutover, not here.

</details>

---

## 1. What `src/` actually is today

**374 files — 241 source, 133 test.** Plus 33 `.test.mjs` under `bin/`. `pnpm exec vitest list`
reports **167 files / 2 618 tests** (2026-08-30).

| Directory | Source | Tests | What it holds |
|---|---:|---:|---|
| `vite/` | 36 | 28 | The build-time plugin array + its support modules → [`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) |
| `components/` (incl. 3 subdirs) | 43 | 28 | The primitives. `drawer/`, `dropdown/`, `avoid-keyboard/` already got their own folders |
| `hooks/` | 40 | 19 | The reactive half of **L9** |
| `capabilities/` | 19 | 18 | The imperative half of **L9**; the only files allowed a platform branch (**L11**) |
| `shell/` | 16 | 8 | Everything above the route |
| `sw/` | 16 | 4 | Hand-rolled Workbox service worker |
| `utils/` | 14 | 8 | Leaf helpers |
| `interface/` | 14 | 1 | The **curated** public barrels the `exports` map points at |
| `styles/` | 10 | 4 | CSS + one test-only helper |
| `ota/` | 6 | 6 | OTA policy, ledger, signing, updater |
| `storage/` | 6 | 4 | The three tiers of **L10** |
| `config/` | 5 | 2 | `adaptv.config.ts` types + loader |
| `routes/` | 5 | 0 | Root route, client/router entries, route-tree stub |
| `native/` | 4 | 3 | Doctor, plugin discovery, privacy manifest |
| *(root)* | 7 | 0 | `virtual-adaptv-*.d.ts` — ambient decls for the virtual modules |

### The tree is layered, not domained — and that is load-bearing

The cross-directory import counts say what the shape actually is:

| Edge | Count | | Edge | Count |
|---|---:|---|---|---:|
| `components → utils` | 41 | | `shell → hooks` | 14 |
| `components → hooks` | 34 | | `vite → shell` | 9 |
| `hooks → capabilities` | 32 | | `components → capabilities` | 7 |
| `capabilities → utils` | 26 | | `vite → ota` | 5 |
| `vite → config` | 19 | | `hooks → ota` | 4 |

`components → hooks → capabilities → utils` is a clean one-way ladder, and it is the ladder **L9**
("reactive → hook, imperative → API") and **L11** ("the accessor is the only hybrid file") describe.
Today a reader can check L11 by opening one directory. That property is what proposal 1 spends.

---

## 2. Proposal 1 — group by domain

### 2.1 What is actually scattered

Two subsystems are torn across four directories each, and in both cases the split is **build-time vs
runtime**, not layer:

**OTA** — 6 directories, 20 files, plus 5 string references from `bin/`. ✅ **Sliced 2026-09-01**;
the table below is the state it was diagnosed in:

| Where | Files |
|---|---|
| `src/ota/` | `ledger`, `manifest-signing`, `native-fingerprint`, `policy`, `store-release`, `updater` (+ 6 tests) |
| `src/vite/` | `ota-config-module.ts`, `ota-emit.ts`, `ota-zip.ts` (+ 3 tests) |
| `src/hooks/` | `use-ota-updates.ts`, `use-store-release.ts` |
| `src/components/` | `update-required.tsx` (+ test) |
| `src/` | `virtual-adaptv-ota-config.d.ts` |
| `src/interface/` | `ota.index.ts` |

**Route tints** — the same feature, split for a documented reason (**B33**: the tint must be on the
page *before* a router exists to be asked, so it is extracted from route **source** at build time):

| Where | File | Half |
|---|---|---|
| `src/vite/route-tints.ts` | the extractor | build |
| `src/vite/route-tints-module.ts` | the virtual module that serves the table | build |
| `src/shell/route-tints.ts` | the runtime table lookup | runtime |
| `src/shell/theme-init-script.ts` | inlines it pre-paint | runtime |
| `src/shell/use-route-tint.ts` + `src/hooks/use-chrome-tint.ts` | the React surface | runtime |

Both are cases where the ask lands: *"the router all in one place, including the router's patches."*

<details>
<summary>A third candidate — the keyboard — and why it is <b>not</b> one</summary>

`capabilities/keyboard.ts`, `capabilities/keyboard-height-cache.ts`, `hooks/use-keyboard.ts`,
`components/avoid-keyboard/`, `components/drawer/drawer-keyboard.ts`, `styles/keyboard.css`. Six
places, one topic — but every one of them is at a **different layer**, and `drawer-keyboard.ts` is a
drawer concern that happens to read the keyboard. Collapsing them into `src/keyboard/` would put an
accessor, a hook, two components and a stylesheet in one folder with no ordering between them, and
would take `drawer-keyboard.ts` away from the twelve files it actually shares state with. The
keyboard is *distributed*, not *scattered*. Not every recurring word is a subsystem.
</details>

### 2.2 Concrete before → after

Only the two slices above. Everything not listed stays where it is.

> 📐 **`build/`, not `vite/`.** Revised **2026-09-01** by [§0.6](#06-what-this-changes-and-what-it-does-not).
> The sub-directory names the **face** (this half runs on the dev's machine), not the bundler that
> happens to call it — Nuxt's `module.ts` + `runtime/`, TanStack's `plugin/`, neither of which says
> "vite". It also matches move **C**, so a slice landing before or after the `src/vite/` rename reads
> the same either way.

| Before | After |
|---|---|
| `src/ota/*.ts` | `src/ota/*.ts` *(unchanged)* |
| `src/vite/ota-emit.ts` · `ota-zip.ts` · `ota-config-module.ts` | ✅ `src/ota/build/…` |
| `src/hooks/use-ota-updates.ts` · `use-store-release.ts` | ✅ `src/ota/use-ota-updates.ts` · `use-store-release.ts` |
| `src/components/update-required.tsx` | **stays** — it is a public primitive in the component barrel (§2.4) |
| `src/virtual-adaptv-ota-config.d.ts` | ✅ `src/ota/virtual-adaptv-ota-config.d.ts` |
| `src/vite/route-tints.ts` · `route-tints-module.ts` | `src/router/build/route-tints.ts` · `route-tints-module.ts` |
| `src/vite/route-tree-opacity.ts` · `router-autoimport.ts` · `root-route-module.ts` | `src/router/build/…` |
| `src/shell/route-tints.ts` · `use-route-tint.ts` · `create-adaptv-router.ts` · `create-root-route.tsx` | `src/router/…` |
| `src/routes/*` | `src/router/entries/*` |
| `patches/@tanstack__router-generator@1.167.21.patch` | **stays at `patches/`** — see §2.3 |

⚠︎ **The `.d.ts` carries a consumer-facing glob with it.** `virtual-adaptv-ota-config.d.ts` is one
of seven ambient declarations delivered by the app-side `include` line
`node_modules/@arrzdev/adaptv/src/virtual-adaptv-*.d.ts` — a flat glob that stops matching the
moment one of the seven leaves the root of `src/`. Moving it makes that line
`src/**/virtual-adaptv-*.d.ts`, in the app's tsconfig **and** in `tsdown.config.ts`'s `copy`
(where the seven still land flat in `dist/`). One consumer-side character; nothing else in §2.4
priced it. → [`../DEVELOPMENT.md`](../DEVELOPMENT.md), [`dist-cutover.md`](dist-cutover.md)

⚠︎ `src/ota/native-fingerprint.ts` imports `node:crypto` and `src/ota/updater.ts` is a browser module,
so **`src/ota/` is already a two-face directory** and the slice makes it a three-part one
(`src/ota/build/` · runtime files · the curated barrel that keeps them apart). That is fine — it is
Nuxt's shape — but it is exactly why move **A** should land first. → [§0.1](#01-four-faces-one-package)

### 2.3 ⚠︎ The patches cannot move, and it is not a style question

`patches/` is a **published surface**. `package.json` `files` ships it, and
`src/vite/verify-patches.ts` prints the block a consumer pastes into their own
`pnpm-workspace.yaml`:

```
'@tanstack/router-generator@1.167.21': node_modules/@arrzdev/adaptv/patches/@tanstack__router-generator@1.167.21.patch
```

That string is generated from `patchInstructions()`, which hardcodes `patches/`. The five
`patchedDependencies` keys in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml) point at the
same path. **L21 🔒** locks the *filename* (`@scope__name@version.patch`) — `parsePatchFilename()`
refuses an unversioned name — but the *directory* is a contract with anyone who has already copied
that block. Moving it is a breaking change for zero navigational gain, since five patch files in one
flat directory are not hard to find.

**Do this instead:** leave the files, and have `src/router/README`-level knowledge live where it
already does — [`../design/patches.md`](../design/patches.md) names which patch serves which
subsystem.

### 2.4 What it costs

| Surface | Exposure | Caught by |
|---|---|---|
| `#adaptv/*` specifiers | **710 import lines** in `src/`; only the moved files' specifiers change (the alias is `./src/*`, so a move rewrites the prefix) | `pnpm typecheck` |
| `src/interface/*.index.ts` | **93 relative `../` lines** across 14 barrels — these are deliberately exempted from the `noRestrictedImports` ban in [`../../biome.json`](../../biome.json), so every barrel line is a literal path that moves | `pnpm typecheck` |
| `package.json` `exports` | `"./root-route": "./src/routes/root-route.tsx"` is the only entry pointing outside `interface/`. **The consumer-facing subpath name does not change**, so already-generated route trees keep resolving | `pnpm build:check` |
| `tsdown.config.ts` | 13 hardcoded entry paths (`src/interface/*.index.ts`, `src/routes/root-route.tsx`) | `pnpm build:check` |
| `bin/` string loads | **18 `loadAdaptvModule("…")` call sites** across 8 `bin/` modules — plain strings, resolved at runtime. Re-counted 2026-09-02: **7 into `vite/`**, 5 `ota/build/`, 2 `config/`, 3 `native/`, and **1 into `utils/color.ts`, a file in the *browser* build** | `bin/lib/load-ts.test.mjs` — every target must exist (§7) |
| Filesystem-reading tests | **15 tests** read the tree by path (`barrels.test.ts`, `capabilities.barrel.test.ts`, `plugin-box.test.ts`, `offline-page-name.test.ts`, the four `styles/*.test.ts`, …) | `pnpm test`, loudly |
| Docs | **255 inline `src/…` references across 38 files**, plus 10 markdown links | ❌ **nothing** |
| In-code comments | **49 distinct `src/…` path strings across 63 files** (`→ src/vite/icon-set.ts` style cross-references) | ❌ **nothing** |

### 2.5 🔒 The barrels must stay curated

**L20** and [`../decisions/facade-and-opacity.md §1`](../decisions/facade-and-opacity.md) settle that
adaptv's barrels are curated — *"every symbol in a adaptv barrel is there because someone decided it
should be"*. Five tests enforce it by comparing hand-written lists against the directory — the
three below plus `hooks.barrel.test.ts` and `storage.barrel.test.ts`, all sharing one walk and one
barrel reader in `src/test-utils/barrel-guard.ts`:

- `src/components/barrels.test.ts` — every component module is exported unless it is in a named
  `WITHHELD` set (`press-core` and the per-engine internals), and the set holds exactly what the
  barrel withholds. It exists because `Text` shipped fully built and **unreachable**.
- `src/interface/capabilities.barrel.test.ts` — every capability module is exported unless it is in a
  named `WITHHELD` set, each entry paired with the file that owns it.
- `src/interface/ota.barrel.test.ts` — added with the OTA slice, and the one where the curated barrel
  is also doing platform safety (§0.1). Its `WITHHELD` set names `native-fingerprint` and each
  `build/` file **individually**, never as a prefix, and a second test fails if any `node:`-importing
  file in `src/ota/` is not on that list. `use-store-release` is exported from `hooks.index.ts`, so
  "exported" here means *reachable from either published barrel*.

A domain reorg makes those directories heterogeneous, and the tempting fix is to glob the new folder
and generate the barrel. **That would make both tests vacuous** — a generated barrel trivially equals
the directory it was generated from. If a slice moves, its barrel entry is edited **by hand**, and
the guard test's `*_DIR` constant is repointed. This is the single line in the plan most likely to be
"simplified" by someone downstream, so it is stated as a constraint, not a preference.

### 2.6 What could go wrong

| Mechanical | Needs judgement |
|---|---|
| `git mv` + rewriting the moved files' `#adaptv/` prefix | Where the boundary of a "domain" is — `update-required.tsx` is OTA *and* a public primitive |
| Repointing `tsdown.config.ts` and `exports` | Whether `src/routes/` is "the router" or "the app entry points" — `client-entry.tsx` is neither |
| The 93 barrel lines | Which of the 255 doc references are load-bearing vs prose |
| The 15 path-reading tests (they fail loudly) | The 16 `bin/` string loads (they fail **only when the CLI runs**) |

**The one that will actually bite:** `src/vite/adaptv-plugin.ts` returns a **single flat array whose
order is the contract** — [`../design/vite-plugin-map.md §2`](../design/vite-plugin-map.md) documents
four adjacent pairs, *each of which is a bug that shipped once*. Slicing plugins out to domain
folders does not change the array, but it makes the array's imports come from eight places, and it
makes the map doc harder to keep true. **Do not move a plugin whose position §2 explains** —
`ban-server-apis`, `css-layer-order`, `ring-shadow-fallback`, `adaptv-image`, `shell-emit`,
`sw-build`, `static-host`, `native-bundle`. The OTA and router modules named in §2.2 are all either
virtual-module providers or support modules, which is why they are the safe slice.

### 2.7 Recommendation

✅ **Do the OTA slice and the router slice. Do not touch anything else.** Two PRs, ~35 files,
each independently revertible. Stop there — the remaining directories are a layer decomposition that
two locked decisions are phrased in terms of, and "everything by domain" would trade a documented
invariant for a filing preference.

---

## 3. Proposal 2 — tests in their own folder

### 3.1 The numbers first

| | |
|---|---|
| Test files in `src/` | **133** |
| …that sit beside the file they test | **125** |
| …with no co-located subject ("orphans") | **8** — `barrels`, `data-adaptv`, `style-precedence`, `capabilities.barrel`, `boot-failure`, `offline-page-name`, `gitignore`, `fs-allow` |
| Test files under `bin/` | **33** `.test.mjs`, in `bin/lib/` (31) and `bin/ui/` (2) |
| Test-only helpers that are **not** named `*.test.*` | **1** — `src/styles/compile.test-helper.ts` |
| Tests that read the source tree from disk | **15** |

### 3.2 The honest case for it

Three real points, and they should not be waved away:

1. **`src/vite/` is 64 entries in one flat directory** — 36 source, 28 test. It is the least
   navigable place in the repo, which is *why* it has a map document all to itself.
2. **`package.json` `files` currently ships `src/`**, so 133 test files go into the published
   tarball today.
3. Co-location makes a directory listing a poor table of contents — you read every name twice.

### 3.3 Why it should not be done anyway

<details>
<summary>The four arguments, in order of weight</summary>

**a. The stated benefit is already claimed by another roadmap item.** Point 2 above dies with the
`dist` cutover ([`dist-cutover.md`](dist-cutover.md)): `exports` repoints at `dist/`, `src` leaves
`files`, and no test ships. Doing a 133-file move to win something a one-line `exports` flip already
wins is the wrong trade.

**b. Point 1 is a *directory-size* problem, not a *co-location* problem.** Moving tests out takes
`src/vite/` from 64 entries to 36 — still the largest directory in the tree, still flat, still
needing its map. Proposal 1's OTA + router slices take out 9 source and 9 test files and give the
rest a boundary. **Proposal 1 is the fix for the pain proposal 2 was aimed at.**

**c. Co-location here is load-bearing in two ways the ask does not account for.** The barrel-guard
tests (§2.5) *read the directory they live next to* and filter `.test.ts` out of it — the guard and
the guarded are deliberately siblings. And 15 tests resolve source files by path from `process.cwd()`;
a `tests/` mirror doubles every one of those paths into a "where is the file, where is the test"
pair that can drift independently. The repo has already been bitten by exactly one kind of drift
(two barrels), and the fix was to put the comparison *closer* to the code, not further.

**d. The usual argument for co-location — brittle relative imports — is already solved here, in the
other direction.** [`../../biome.json`](../../biome.json) bans `./` and `../` repo-wide in favour of
`#adaptv/*`. A test in `tests/vite/route-tints.test.ts` would import
`#adaptv/vite/route-tints` — exactly what it imports today. So moving tests costs nothing in
imports **and gains nothing**: the usual reason teams co-locate (shorter, less brittle paths) does
not apply, and neither does the usual reason they separate (a build that must exclude them —
`tsdown` builds from barrel entries, so tests are already never bundled).

</details>

### 3.4 The part of this the ask did not mention

`bin/lib/` is **39 test files against 32 source files** — the only directory in the repo where tests
outnumber source, and the strongest instance of the owner's complaint. It is also the directory where
a move is *least* safe: `bin/**` is exempted from the import ban, the modules are `.mjs` (type-checked
through `tsconfig.bin.json`, but every reach into `src/` is a string), and `bin/lib/opacity.test.mjs`, `cli-spec.test.mjs` and friends are the only
enforcement the [`cli-contract`](../design/cli-contract.md) has. If any part of proposal 2 is ever
attempted, `bin/` is the part to attempt **last**, not first.

### 3.5 Recommendation

❌ **No.** The one measurable benefit is delivered for free by the `dist` cutover, the navigation
benefit is delivered better by proposal 1, and co-location is currently doing structural work in 15
tests and both barrel guards.

> ⚠︎ **Where the peers do not back this up.** Three of six co-locate unit tests (Next.js 147,
> SvelteKit 45, React Router 157 in sibling `__tests__/`); three keep them out of `src/` entirely
> (Astro 827, Nuxt 203, TanStack 333). It is 3–3, and the tie-break is only that the two closest
> structural analogues are on the co-location side.
> → [§0.6](#06-what-this-changes-and-what-it-does-not). The verdict stands on §3.3's repo-specific
> reasons, not on peer practice.

If the navigation complaint persists after proposal 1 lands, the next move is **move C** —
`src/vite/` → `src/build/` with `plugins/` · `modules/` · `support/` inside (the three groups
[`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) already sorts them into). That is the
same ~36 files this section originally proposed as a fallback, plus the rename that makes the
directory name true. → [§0.5](#05-the-three-moves-worth-making)

---

## 4. Proposal 3 — domain-first filenames

### 4.1 The repo has already answered this, twice

**The convention is already here — in the app layer.** The playground uses it exactly as described:

```
playground/apps/frontend/src/routing/pages/settings.page.tsx
playground/apps/frontend/src/routing/layouts/providers.layout.tsx
playground/apps/frontend/src/data/delete-data.mutations.ts
```

adaptv's own build even reads it: `src/vite/route-tints.ts`'s tests are written against
`/app/src/routing/pages/settings.page.tsx`. The convention pays off there because
`routing/pages/` is a **flat directory of many kinds** — a page, a layout and a loader would
otherwise be indistinguishable. In `src/`, **the directory already states the kind**: everything in
`hooks/` is a hook, everything in `capabilities/` is an accessor, everything in `components/` is a
primitive. `button.component.tsx` inside `components/` states it twice.

**And the framework already has a dotted convention — inverted.** `src/sw/` uses
`sw.navigation.ts`, `sw.precache.ts`, `sw.strategies.ts`: **kind first, subject second.** The ask's
form is `user.route.ts`: **subject first, kind second.** Adopting the ask verbatim would leave the
repo with two dotted conventions running in opposite directions, which is worse than one
inconsistency.

### 4.2 What it would cost, if done anyway

| | |
|---|---|
| Files renamed | ~241 |
| Import lines rewritten | 710 `#adaptv/*` + 93 barrel lines |
| Guard tests broken | **both** — `barrels.test.ts` and `capabilities.barrel.test.ts` derive module names by stripping the extension, so `button.component` ≠ `button` and every `INTERNAL`/`WITHHELD` set entry changes |
| `bin/` string loads | 14, silently |
| Doc references | 255 |
| React convention lost | `use-keyboard.ts` → `keyboard.hook.ts` renames 40 files away from the hook they export |

### 4.3 Recommendation

❌ **No for `src/`.** ✅ **Keep it, and document it, for apps.** If it is worth having, the place to
say so is [`../guides/cookbook.md`](../guides/cookbook.md) — where it becomes guidance adaptv gives
its consumers, which is where it already works — not a rename of the framework's own tree.

One narrow carve-out worth considering on its own merits, unrelated to the convention:
`src/components/drawer/` has 7 source files all prefixed `drawer-` **inside a directory named
`drawer`**. Dropping the prefix (`drawer/motion.ts`, `drawer/keyboard.ts`) is a 7-file, one-sitting
change that removes a real stutter. That is the opposite of proposal 3 — less domain in the
filename, not more — which is itself the argument.

---

## 5. What is already settled, and constrains this

Every row below is live in [`../decisions/register.md`](../decisions/register.md). Read it before
re-opening any of them — this repo records what it **rejected**, and the code alone does not.

| # | Entry | How it binds |
|---|---|---|
| **L1** 🔒 | Single-package repo; promote to `packages/*` only when the native plugin or `create-adaptv` need separate publishing | A domain reorg must **not** drift toward `packages/ota`, `packages/router`. Directories, not packages. ✅ **The peers confirm both halves** ([§0.2](#02-the-peers-and-whether-adaptv-may-copy-them)): SvelteKit and Ionic keep a framework of this scope in one package, and every package split in Expo, Ionic and Capacitor is forced by an external consumer — a CocoaPods/Gradle `node_modules` walk, or an incompatible peer set. The *one* forcing reason that will ever apply here is the native plugin, which is the exact case L1 already names. |
| **L9** 🔒 | Reactive → hook, imperative → API | `hooks/` ↔ `capabilities/` is this decision made visible. Dissolving the pair makes it a per-file claim. |
| **L11** 🔒 | The accessor is the only hybrid file; the platform branch lives at the lowest layer | Today: open `capabilities/`, read every branch. After a full domain reorg: grep. |
| **L14** 🔒 | Two build lineages that never cross | `static-host.ts` (web) and `native-bundle.ts` (native) are a matched pair whose *separation* is the invariant. Do not file them under one domain. |
| **L20** 🔒 | Underlying packages, and adaptv's changes to them, are invisible to the consumer | The route-tree opacity chain (`route-tree-opacity.ts`, `router-autoimport.ts`, `thunk-specifiers.ts`, `bin/lib/opacity.mjs`) must keep working across the move; `assertRouteTreeIsOpaque` is the check. Also: **curated barrels stay hand-written** (§2.5). |
| **L21** 🔒 | Patches are version-keyed, and the **filename** carries the key | `patches/` is a published path, printed into consumer install instructions. §2.3. |
| **O2** ✅ | Curated barrel, never `export *` from an engine | A reorg must not become an excuse to regenerate barrels. |
| **O12** ✅ | Ship dist, two builds (`browser` + `node`), split by platform | `tsdown` entries are the 13 barrels. Domain folders will mix node-only and browser-only files in one directory — harmless for the build (entries drive it) but it removes "this directory is Node code" as a readable property of `src/vite/`. |
| **B33** | `chromeTint` is read as source at build time | The reason route-tints is split across `vite/` and `shell/`. Grouping it should **carry the explanation**, not erase it. |
| — | [`../README.md`](../README.md): the docs tree is split **by kind of claim, not by subsystem** | Worth noticing before splitting `src/` the other way. Different axes, defensible — but the repo has already argued once that "group by topic" was the wrong axis for a tree, and lists the failure it caused. |

---

## 6. Sequencing

**Incremental. One subsystem per PR. Never one big cut.**
**A → OTA slice → router slice → B + C**, which is [§0.5](#05-the-three-moves-worth-making)'s order.

| Step | What | Revertible by |
|---|---|---|
| 0 | Land the [`dist` cutover](dist-cutover.md) **first** | — it removes `src` from `files`, which is the only thing that makes the current layout a *shipping* concern |
| **0a** | ✅ **Move A** — the `node:` boundary test ([§0.5](#05-the-three-moves-worth-making)), [`../../src/execution-boundary.test.ts`](../../src/execution-boundary.test.ts). **Moved no files**, so it landed before step 0 | delete one file. It is the only step here with no revert risk, and every later step is provable because of it |
| **1** | ✅ **OTA slice** (§2.2) — 9 files moved, 13 modified. Renames plus specifiers, the five `bin/` string loads, `vitest.config.ts`, `tsdown.config.ts`'s copy glob and one allow-list entry (`src/ota/build/`, deliberately not `src/ota/`) | `git revert`; pure renames, no content beyond specifiers |
| **2** | ✅ Sweep OTA doc references | separate commit, so step 1 stays a clean rename |
| 3 | **Router slice** (§2.2) — ~15 files | same shape |
| 4 | Sweep router doc references + update [`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) §1/§3 | separate commit |
| **4a** | **Move B** — `src/native/` → `src/build/native/`, 4 files | `git revert` |
| **4b** | **Move C** — `src/vite/` → `src/build/` + `plugins/` `modules/` `support/`. ~28 files by now, the slices having taken 8 out | `git revert`, **but** see the ⚠︎ in §0.5: 11 CLI string loads change and no gate sees them |
| 5 | **Stop.** Do not add `src/runtime/` or `src/shared/` — [§0.4](#04-the-distance-and-why-the-full-move-is-the-wrong-trade) is the argument | — |

**Why B and C come after the slices, not before.** Because cohesion decides the tree and the
execution boundary is a rule, not a directory — [§0.5](#05-the-three-moves-worth-making) states the
principle. Its consequence here is concrete: move C renames `src/vite/` → `src/build/`, so running it
first drags the OTA and router build-halves into `src/build/` and then moves them a **second** time
into `src/ota/build/` and `src/router/build/`. Two moves where there should be one, each rewriting
CLI string loads no gate catches (§7). Done in this order, the 8 files the slices claim (3 OTA,
5 router) leave `src/vite/` once and never come back, and C renames the smaller directory that
remains. Move A is not an exception to the ordering — it is not a move at all, it is the net.

**What makes a step safely revertible:** each PR is renames plus import-specifier rewrites and
*nothing else*. `git diff -M --stat` should show `R###` for every file, and every line in
`git diff -M --diff-filter=M` should match `#adaptv/`, a barrel path, or a `tsdown`/`exports` entry.
A step that also "fixes something while we're here" is not revertible, because the revert takes the
fix with it.

---

## 7. How to prove a move changed nothing

| Gate | Catches | Misses |
|---|---|---|
| `pnpm typecheck` | Every broken `#adaptv/*` and barrel path in `.ts`/`.tsx`, and `bin/`'s `.mjs` through `tsconfig.bin.json` | anything in a string — which is every reach from `bin/` into `src/` |
| `pnpm biome:check` | The reflex fix — re-introducing `./`/`../` when an alias breaks | the four exempted globs (`src/config`, `src/vite`, the barrels, `bin/**`) |
| `pnpm test` | The 15 path-reading tests, the five barrel guards, the opacity assertions, the `bin/` string loads | anything only the CLI executes |
| `pnpm build:check` | `exports` + `tsdown` entries; `scripts/verify-dist.mjs` checks the emitted surface | `bin/`'s runtime loads |
| `pnpm gate` | all of the above + `check-colour.mjs` | ″ |
| **[`../../src/execution-boundary.test.ts`](../../src/execution-boundary.test.ts)** *(move A)* | a `node:*` import landing on the browser side of the split, a `config/*` import that stops being `import type`, a test file pulled into a published entry graph, and a `tsdown`/`exports` entry nobody classified | a `node:*` import inside `src/vite/**` or `src/native/**` reaching a browser some other way — the allow-list trusts those directories by name |
| **[`../../src/interface/ota.barrel.test.ts`](../../src/interface/ota.barrel.test.ts)** *(OTA slice)* | an OTA module that stops being exported — the direction the boundary test structurally cannot see, since a barrel falling behind drags nothing into any graph — and a `node:`-importing file arriving in `src/ota/` unnamed | a module exported under a *different* name than its file, and every barrel that is not this one |

### ⚠︎ The three things no gate catches

1. **`loadAdaptvModule("ota/build/ota-emit.ts")` — 18 call sites in `bin/`, 5 of them into the OTA
   slice.** Plain strings, resolved by esbuild at runtime, invisible to `tsc` and to Biome. A wrong
   one used to fail **only when that CLI command runs**. ✅ The *existence* of every target is now
   checked by [`../../bin/lib/load-ts.test.mjs`](../../bin/lib/load-ts.test.mjs): it walks the
   non-test `bin/**/*.mjs`, strips comments, collects every `loadAdaptvModule("…")` literal (18
   today, over 13 targets — the doc-comment example on the loader itself is not one of them), and
   fails naming each `file:line → src/<target>` that does not exist, with a floor of 10 sites so a
   rotted regex cannot pass on an empty list. Proven on a scratch copy of `bin/` with two literals
   moved: `4 dangling`, each named. What it does NOT check is that the module still exports what the
   caller destructures, or that the command works. There is no `adaptv ota publish`: `ota-emit.ts`
   is reached by **`adaptv build web`** (which publishes the channel when the config names an
   origin — `resolveOtaBuildConfig`, `computeBuildTag`/`buildBundleArchive`, `resolveSigningKey`,
   `writeChannel`) and by **`adaptv keys ota`** (`generateOtaKeyPair`). No unit test invokes either.
   → **the acceptance test for the OTA slice is still running both against the playground, signed,
   and reading the manifest they write — not a green gate.**
2. **255 doc references + 49 in-code path comments.** Nothing checks them. A reorg that leaves them
   stale attacks the one property that makes this tree navigable
   ([`../README.md`](../README.md): *"when something ships, move it"*).
3. **A vacuously-passing guard.** Every barrel guard scans a directory; point one at a directory
   that no longer holds anything and it compares two empty lists and goes green. ✅ All five —
   `components/barrels.test.ts` and `interface/{capabilities,hooks,ota,storage}.barrel.test.ts` —
   now open with a floor test (`actually walked the directory it claims to have walked`), and share
   one walk and one barrel reader in [`../../src/test-utils/barrel-guard.ts`](../../src/test-utils/barrel-guard.ts)
   rather than three copies; the `safe-area` sweep carries the same floor. A floor is not proof
   the *invariant* still fires, though: **after any move, delete one export from the barrel by
   hand and confirm the guard goes red.** A guard that cannot fail is worse than no guard, and
   this is the exact way a reorg breaks one.

### The strong proof

Beyond the gate: `pnpm build:check` before and after, then diff the emitted **`.d.mts` set and
contents**. The public type surface is generated from the 13 barrel entries, so it is
path-independent — if the declaration files are byte-identical across the move, the reorg provably
did not change what a consumer sees. (Do not compare `.mjs` or sourcemaps: `sourcesContent` embeds
paths by design, so those differ legitimately.)

---

## Definition of done

**Per step, not for the whole plan** — every step in §6 is its own PR and clears this list on its own.

0. **Move A only:** ✅ done. The boundary test **failed** on a hand-added `import { readFileSync } from
   "node:fs"` in `src/utils/color.ts` — a browser-build file, and the one `bin/` also string-loads —
   naming it in both the allow-list check and the browser-graph check; and **failed** when
   `src/components/orientation-guard.tsx` lost the `type` keyword on its `#adaptv/config/types`
   import. Both reverted. It also carries its own floor (232 non-test files, a 154-file browser
   closure, a 79-file node closure), so the vacuous pass in §7 cannot happen to it.
1. `pnpm gate` and `pnpm build:check` green.
2. Emitted `.d.mts` files byte-identical to the pre-move build.
3. `adaptv ota publish` and `adaptv build ios` both run on the playground — the only exercise the 14
   `bin/` string loads get.
4. Each barrel guard has been shown to still **fail** when a hand-written export is removed.
5. Zero stale `src/…` references in `docs/` for the moved subsystem, and
   [`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) §1/§3 updated in the same PR.
6. `git diff -M` shows renames plus specifier lines, and nothing else.
