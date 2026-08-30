# adaptv — reorganising `src/`

> 📐 **A plan, not a change.** Three separable proposals, surveyed against the tree as it stands on
> **2026-08-30**. One is worth doing in a narrow form; two are not.
>
> **Risk: high for its size.** Nothing here changes behaviour, which is exactly why it is dangerous —
> a reorg is the one kind of change where "the gate is green" and "nothing broke" are different
> claims. §7 is the part to read before starting.

---

## The verdict, up front

| # | Proposal | Verdict | One line |
|---|---|---|---|
| 1 | **Group by domain** | ⚠︎ **Yes, for two subsystems only** | OTA and route-tints are genuinely torn across four directories each; `components`/`hooks`/`capabilities`/`utils` are not scattered — they are a **layer** decomposition that **L9** and **L11** are written in terms of. |
| 2 | **Tests in their own folder** | ❌ **No** | 125 of 133 `src/` tests sit beside the file they test; the `#adaptv/*` alias already makes test imports path-independent, so co-location costs nothing it would recover — and the navigation pain the owner is describing is one directory (`src/vite/`, 64 entries), which proposal 1 fixes directly. |
| 3 | **Domain-first filenames** (`user.route.ts`) | ❌ **No in `src/`** | The convention already lives in this repo, in the place it earns its keep: the **playground app** (`settings.page.tsx`, `providers.layout.tsx`). The framework's directories already state the domain, and `src/sw/` already uses the **inverted** form (`sw.navigation.ts`), so adopting it would create a second convention rather than one. |

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

**OTA** — 6 directories, 20 files, plus 5 string references from `bin/`:

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

| Before | After |
|---|---|
| `src/ota/*.ts` | `src/ota/*.ts` *(unchanged)* |
| `src/vite/ota-emit.ts` · `ota-zip.ts` · `ota-config-module.ts` | `src/ota/vite/…` |
| `src/hooks/use-ota-updates.ts` · `use-store-release.ts` | `src/ota/use-ota-updates.ts` · `use-store-release.ts` |
| `src/components/update-required.tsx` | **stays** — it is a public primitive in the component barrel (§2.4) |
| `src/virtual-adaptv-ota-config.d.ts` | `src/ota/virtual-adaptv-ota-config.d.ts` |
| `src/vite/route-tints.ts` · `route-tints-module.ts` | `src/router/vite/route-tints.ts` · `route-tints-module.ts` |
| `src/vite/route-tree-opacity.ts` · `router-autoimport.ts` · `root-route-module.ts` | `src/router/vite/…` |
| `src/shell/route-tints.ts` · `use-route-tint.ts` · `create-adaptv-router.ts` · `create-root-route.tsx` | `src/router/…` |
| `src/routes/*` | `src/router/entries/*` |
| `patches/@tanstack__router-generator@1.167.21.patch` | **stays at `patches/`** — see §2.3 |

### 2.3 ⚠︎ The patches cannot move, and it is not a style question

`patches/` is a **published surface**. `package.json` `files` ships it, and
`src/vite/verify-patches.ts` prints the block a consumer pastes into their own
`pnpm-workspace.yaml`:

```
'@tanstack/router-generator@1.167.21': node_modules/@arrzdev/adaptv/patches/@tanstack__router-generator@1.167.21.patch
```

That string is generated from `patchInstructions()`, which hardcodes `patches/`. The four
`patchedDependencies` keys in [`../../pnpm-workspace.yaml`](../../pnpm-workspace.yaml) point at the
same path. **L21 🔒** locks the *filename* (`@scope__name@version.patch`) — `parsePatchFilename()`
refuses an unversioned name — but the *directory* is a contract with anyone who has already copied
that block. Moving it is a breaking change for zero navigational gain, since four patch files in one
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
| `bin/` string loads | **14 `loadAdaptvModule("vite/…")` call sites** — plain strings, resolved at runtime | ❌ **nothing** — see §7 |
| Filesystem-reading tests | **15 tests** read the tree by path (`barrels.test.ts`, `capabilities.barrel.test.ts`, `plugin-box.test.ts`, `offline-page-name.test.ts`, the four `styles/*.test.ts`, …) | `pnpm test`, loudly |
| Docs | **255 inline `src/…` references across 38 files**, plus 10 markdown links | ❌ **nothing** |
| In-code comments | **49 distinct `src/…` path strings across 63 files** (`→ src/vite/icon-set.ts` style cross-references) | ❌ **nothing** |

### 2.5 🔒 The barrels must stay curated

**L20** and [`../decisions/facade-and-opacity.md §1`](../decisions/facade-and-opacity.md) settle that
adaptv's barrels are curated — *"every symbol in a adaptv barrel is there because someone decided it
should be"*. Two tests enforce it by comparing hand-written lists against the directory:

- `src/components/barrels.test.ts` — the two component barrels must cover the same modules, with an
  explicit `INTERNAL` set. It exists because `Text` shipped fully built and **unreachable**.
- `src/interface/capabilities.barrel.test.ts` — every capability module is exported unless it is in a
  named `WITHHELD` set, each entry paired with the file that owns it.

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
| The 15 path-reading tests (they fail loudly) | The 14 `bin/` string loads (they fail **only when the CLI runs**) |

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

`bin/lib/` is **31 test files against 28 source files** — the only directory in the repo where tests
outnumber source, and the strongest instance of the owner's complaint. It is also the directory where
a move is *least* safe: `bin/**` is exempted from the import ban, the modules are `.mjs` with no
typecheck behind them, and `bin/lib/opacity.test.mjs`, `cli-spec.test.mjs` and friends are the only
enforcement the [`cli-contract`](../design/cli-contract.md) has. If any part of proposal 2 is ever
attempted, `bin/` is the part to attempt **last**, not first.

### 3.5 Recommendation

❌ **No.** The one measurable benefit is delivered for free by the `dist` cutover, the navigation
benefit is delivered better by proposal 1, and co-location is currently doing structural work in 15
tests and both barrel guards.

If the navigation complaint persists after proposal 1 lands, the cheap next move is
**`src/vite/` subdirectories** (`plugins/`, `modules/`, `support/` — the three groups
[`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) already sorts them into), which costs
~36 files and no convention change.

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
| **L1** 🔒 | Single-package repo; promote to `packages/*` only when the native plugin or `create-adaptv` need separate publishing | A domain reorg must **not** drift toward `packages/ota`, `packages/router`. Directories, not packages. |
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

| Step | What | Revertible by |
|---|---|---|
| 0 | Land the [`dist` cutover](dist-cutover.md) **first** | — it removes `src` from `files`, which is the only thing that makes the current layout a *shipping* concern |
| 1 | **OTA slice** (§2.2) — ~20 files | `git revert`; pure renames, no content beyond specifiers |
| 2 | Sweep OTA doc references (`grep -rn 'src/ota/\|src/vite/ota' docs`) | separate commit, so step 1 stays a clean rename |
| 3 | **Router slice** (§2.2) — ~15 files | same shape |
| 4 | Sweep router doc references + update [`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) §1/§3 | separate commit |
| 5 | **Stop.** Re-ask whether `src/vite/` still feels unnavigable | — |

**What makes a step safely revertible:** each PR is renames plus import-specifier rewrites and
*nothing else*. `git diff -M --stat` should show `R###` for every file, and every line in
`git diff -M --diff-filter=M` should match `#adaptv/`, a barrel path, or a `tsdown`/`exports` entry.
A step that also "fixes something while we're here" is not revertible, because the revert takes the
fix with it.

---

## 7. How to prove a move changed nothing

| Gate | Catches | Misses |
|---|---|---|
| `pnpm typecheck` | Every broken `#adaptv/*` and barrel path in `.ts`/`.tsx` | anything in a string, anything in `.mjs` |
| `pnpm biome:check` | The reflex fix — re-introducing `./`/`../` when an alias breaks | the four exempted globs (`src/config`, `src/vite`, the barrels, `bin/**`) |
| `pnpm test` (2 618) | The 15 path-reading tests, both barrel guards, the opacity assertions | anything only the CLI executes |
| `pnpm build:check` | `exports` + `tsdown` entries; `scripts/verify-dist.mjs` checks the emitted surface | `bin/`'s runtime loads |
| `pnpm gate` | all of the above + `check-colour.mjs` | ″ |

### ⚠︎ The three things no gate catches

1. **`loadAdaptvModule("vite/ota-emit.ts")` — 14 call sites in `bin/`.** Plain strings, resolved by
   esbuild at runtime, invisible to `tsc` and to Biome. A wrong one fails **only when that CLI
   command runs**, and `ota-emit.ts` is reached by `adaptv ota publish`, which no unit test invokes.
   → **the acceptance test for the OTA slice is running `adaptv ota publish` against the playground,
   not a green gate.**
2. **255 doc references + 49 in-code path comments.** Nothing checks them. A reorg that leaves them
   stale attacks the one property that makes this tree navigable
   ([`../README.md`](../README.md): *"when something ships, move it"*).
3. **A vacuously-passing guard.** `barrels.test.ts` and `capabilities.barrel.test.ts` scan a
   directory; point one at a directory that no longer holds components and it compares two empty
   lists and goes green. **After any move, delete one export from the barrel by hand and confirm the
   guard goes red.** A guard that cannot fail is worse than no guard, and this is the exact way a
   reorg breaks one.

### The strong proof

Beyond the gate: `pnpm build:check` before and after, then diff the emitted **`.d.mts` set and
contents**. The public type surface is generated from the 13 barrel entries, so it is
path-independent — if the declaration files are byte-identical across the move, the reorg provably
did not change what a consumer sees. (Do not compare `.mjs` or sourcemaps: `sourcesContent` embeds
paths by design, so those differ legitimately.)

---

## Definition of done

1. `pnpm gate` and `pnpm build:check` green.
2. Emitted `.d.mts` files byte-identical to the pre-move build.
3. `adaptv ota publish` and `adaptv build ios` both run on the playground — the only exercise the 14
   `bin/` string loads get.
4. Each barrel guard has been shown to still **fail** when a hand-written export is removed.
5. Zero stale `src/…` references in `docs/` for the moved subsystem, and
   [`../design/vite-plugin-map.md`](../design/vite-plugin-map.md) §1/§3 updated in the same PR.
6. `git diff -M` shows renames plus specifier lines, and nothing else.
