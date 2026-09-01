# adaptv — the `dist` cutover

> 📐 **The build exists and is verified. The cutover does not.** Was **D12** in the decision
> register, where it read as though the whole thing were unbuilt.
>
> **Risk: low. Size: small.** This is the cheapest item on the roadmap with the widest blast radius,
> because three unrelated playground workarounds disappear the moment it lands.

---

## What already exists

| Piece | Where |
|---|---|
| The build | `tsdown.config.ts` — **two** builds, `platform: "browser"` for the React surface and `platform: "node"` for `/vite` + `/sw` + `/config`. A single build fails with `Could not resolve 'node:fs'`. |
| The verifier | `scripts/verify-dist.mjs`, run by `pnpm build:check` (`tsdown && node scripts/verify-dist.mjs`) |
| The decision, with its evidence | [`../decisions/dist-build.md`](../decisions/dist-build.md) — including the four traps this specific package shape hits |
| `.d.ts` emission | `dts: true`, with `sourcesContent` kept so consumers get real stack traces **without** shipping `src/` |

## What is left

**One flip, and its fallout.** `package.json` `exports` still points every subpath at
`./src/interface/*.index.ts`. Repointing them at `dist/` is the cutover.

### The three playground shims that disappear

All three exist *only* because the exports point at `src/*.ts`, which compiles adaptv's source inside
the app's own TypeScript program — so anything the framework resolves differently from the app
becomes two structurally identical, mutually unassignable types with one name. Removing any of them
today breaks `typecheck`; after the cutover all three are dead weight.

1. `"vite": "link:../../../node_modules/vite"` in `playground/apps/frontend/package.json` — one
   physical vite for both. `paths` cannot fix this, because third-party plugin `.d.ts` files resolve
   vite from *their own* location, which path mapping never reaches.
2. `react` / `react-dom` pinned in `playground/apps/frontend/tsconfig.json` `paths` — the same story
   with two `@types/react` copies of one version.
3. `node_modules/@arrzdev/adaptv/src/virtual-adaptv-*.d.ts` in that tsconfig's `include` — ambient
   declarations for the modules adaptv's Vite plugin serves at build time. The package ships them;
   the app currently has to go looking.

### Two traps to carry into the cutover

- **`sharp` must stay external.** If the cutover ever bundles `src/vite/`, `sharp` needs an
  `external` entry or the build breaks in a way that **only reproduces on the consumer's machine**.
- **Shim 3 is the ambient-declaration question, and `"./image-asset"` is not its answer.** That
  entry used to read "`"./image-asset"` is still missing from `exports`"; it is missing on purpose
  (`../design/image.md` §13 row 12). All seven `src/virtual-adaptv-*.d.ts` files reach the consumer
  through that `include` glob and none is in `exports`, because a subpath export does not load an
  ambient declaration either — it is one consumer-side line whichever way it is delivered. What the
  cutover actually owes is a **path that survives it**: the glob names `…/adaptv/src/`, and after the
  flip the declarations live under `dist/`. Deleting shim 3 therefore means replacing the mechanism
  for all seven at once, not exporting one of them.

## Why it was deferred, and whether that still holds

The recorded reason was that shipping raw source means no build step, therefore no `prepare` script,
therefore no pnpm-11 `allowBuilds` entry — which is a git-dependency's main friction. That argument
was written when the answer was *"stay on raw source until there is a second consumer"*, and the repo
has since gone the other way: the build exists, `publishConfig` names GitHub Packages, and
[`../decisions/dist-build.md`](../decisions/dist-build.md) settles the question. **The deferral is now
about sequencing, not about the decision.**

## Definition of done

1. `package.json` `exports` point at `dist/`, `pnpm build:check` green.
2. The three playground shims are deleted and `pnpm typecheck` is still green — that is the real
   test, and it is the one that proves the cutover actually worked rather than merely built.
3. The seven `virtual-adaptv-*.d.ts` ambient declarations still reach a consumer once `src/` is no
   longer the shipped path — see the trap above.
