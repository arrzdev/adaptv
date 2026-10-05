# adaptv — the facade: what adaptv exports, and what it forbids

> How much of TanStack the consumer sees, and how the isomorphism boundary
> (`docs/design/rendering.md`) stops being an honour-system rule and becomes a **build failure**.
>
> Resolves the contradiction between `chopchop/HANDOFF-adaptv.md` (2026-07-06, "the honest split")
> and `docs/design/architecture.md §3` (2026-07-14, "opacity, not absence"). Decided **2026-07-20**, backed by
> live experiments against the pinned toolchain (TS 5.9.3, Biome 2.3.2, Vite 8.0.11 / Rolldown
> 1.0.0-rc.18, `@tanstack/react-start` 1.167.13, pnpm 11.1.1).

---

## 0. The insight that resolves the conflict

The two prior decisions were arguing past each other because **they answer different questions**:

|  | Question | Answer |
|---|---|---|
| **Safety** | *Can a consumer reach an API that dies on device?* | **No — and this is non-negotiable.** |
| **Opacity** | *Does the consumer's `package.json` and import statements say `@tanstack/*`?* | A branding/DX choice with a real, measurable cost. |

**These are orthogonal.** You do **not** need to hide TanStack in order to ban `createServerFn`.
The 07-14 doc bundled them into one roadmap item and made safety hostage to an expensive,
spike-gated typing problem. Unbundle them and both get easy answers:

- **Safety → solved now, completely, at build time** (§2). No spike, no patch, no type gymnastics.
- **Opacity → deliberately deferred** (§3). Tier 1 (a *curated* barrel) ships today and delivers most
  of the perceived benefit; Tier 2 (full invisibility) stays spike-proven-but-unbuilt.
  > ⚠︎ **Overtaken five days later.** The deferral was reversed by **L20** (2026-07-25) and Tier 2
  > shipped — see the status note on §3.3. The orthogonality argument above still holds; only the
  > "deferred" half of this line is history.

---

## 1. 🔒 Decision: a **curated** barrel, not a pass-through, not a disguise

adaptv re-exports **only what it endorses.** Three rules:

1. **Never `export * from "@tanstack/react-router"`.** The deleted pass-through seam from chopchop
   stays deleted — a star-export re-exports tomorrow's unsafe API automatically, which is exactly the
   failure mode adaptv exists to prevent. Every symbol in a adaptv barrel is there because someone
   decided it should be.
2. ~~**`@tanstack/react-router` stays a named engine dependency** (the Expo↔react-native model). The
   consumer's `package.json` lists it; route files import `createFileRoute` from it.~~ **Superseded
   by L20 (2026-07-25).** Route files import `createFileRoute` from `@arrzdev/adaptv/router`
   (`src/interface/router.index.ts`, injected by `src/vite/router-autoimport.ts`), and the consumer's
   `package.json` names no `@tanstack/*` at all — the playground's lists only its own
   `@tanstack/react-query`. The 07-05 evidence against barrel-based type hiding (§3.1) is still real;
   what changed is that the shipped path (§3.2's Path X) does not hide types through a barrel.
3. **`createServerFn` and friends are simply never exported by adaptv, *and* are hard-banned from
   consumer source by the build** (§2), on every target. *Confirmed by the owner on 2026-10-05,
   after a 2026-09-14 direction to export them for server-backed web was reversed (§2).* Not
   re-exporting is not enough on its own — the consumer can
   always import the package directly.

4. **🔒 adaptv's dependencies are not the app's.** *Decided 2026-10-05 (TUD-236).* An app imports
   what its own `package.json` lists and what `@arrzdev/adaptv/*` exports. Every package in
   adaptv's `dependencies`, and the whole `@tanstack/` scope (the engine's transitive packages
   reach the app's `node_modules` the same way), is refused in app source **unless the app lists
   that package itself**, in which case it is the app's own and imports like any other. A dev who
   wants a library installs it.

   **Mechanism:** `src/vite/engine-imports.ts`, the second plugin in `adaptv()`'s array,
   `enforce: "pre"`. Its `transform` parses each of the app's own modules (`vite`'s `parseAst`;
   files under the app root, outside `node_modules`, without a query) and fails the build, or the
   dev server's request, at the specifier when an import names one of those packages and the
   app's `package.json` does not. It reads the source **before** any plugin writes imports into
   it, which is why it is not a `resolveId` rule: TanStack's code-splitter writes
   `@tanstack/react-router` into the app's route modules, and `tanstack-resolve.ts` must keep
   resolving those from adaptv. The server-only modules stay with §2's ban, which refuses them
   whether listed or not.

   **Why the install layout could not be the rule:** pnpm's strict layout used to refuse an
   unlisted package by accident, until `tanstack-resolve.ts` began resolving every `@tanstack/*`
   import in the app's files from adaptv; npm and Yarn hoist adaptv's dependencies into the
   app's `node_modules`, so there it always resolved (§2.6 "Relying on pnpm strictness").
   `packages/create-adaptv/create.test.mjs` builds a created app outside the repo under both
   layouts: refused, refused, and built once the app lists the package.

   **What the dev sees:** the first line of the message is the whole of it (file, problem, the
   two ways out) and names no engine, because the CLI drops any line that does
   (`bin/lib/opacity.mjs`): `✖ web  src/routing/pages/home.page.tsx imports a package missing
   from the app's package.json — add it there, or import from an @arrzdev/adaptv subpath.` The
   second line quotes the import the dev wrote, for the dev overlay and a plain `vite build`.

   **Not covered:** the type checker. Under a hoisted install `tsc` and the editor still resolve
   an unlisted package; the build is the gate. The shipped lint config does not add Biome's
   `noUndeclaredDependencies`, because a created app does not extend it.

**What "stop re-exporting `createServerFn`" concretely means:** adaptv has no root `.` export today
and no barrel that forwards TanStack Start. There is nothing to remove. The work is (a) keeping it
that way as barrels grow, and (b) adding the enforcement in §2, because *absence from adaptv's barrel
was never the thing stopping anyone.*

---

## 2. 🔒 The ban — layered, with a build-time backstop that cannot be bypassed

> ### 🔒 The ban covers every target — owner, 2026-10-05
>
> **Rejected: server functions on server-backed web, refused only on artifacts with no server.** The
> owner set that direction on 2026-09-14 and reversed it on 2026-10-05, before any of it was built.
> The reason: adaptv's promise is one app on web, PWA, iOS and Android. An API that works on the web
> and breaks on a phone is not offered on the web either, so adaptv has no server side at all, and a
> web-only app gets the same rule as every other app.
>
> What still changes is **coverage, not the rule**: the ban should read the compiler's own set of
> server functions instead of matching specifiers, and refuse direct imports of every engine package
> (**L20**) → [`../roadmap/server-boundary.md`](../roadmap/server-boundary.md). Everything below is
> what runs today.

> ### ✅ BUILT (2026-07-20) — `src/vite/ban-server-apis.ts`, 27 unit tests
>
> Shipped as the **first entry** in the array `adaptv()` returns, `enforce: "pre"`. Decision logic is
> factored into pure functions (`isBannedServerModule`, `isApplicationSource`, `describeServerApiBan`,
> `findServerRouteHandlers`) so it is testable without standing up a bundler; the hooks are wrappers.
>
> **Verified end-to-end against a real Vite 8 / Rolldown build**, not just in unit tests:
>
> | Case | Result |
> |---|---|
> | `import { createServerFn } from "@tanstack/react-start"` in app source | **exit 1**, caret frame |
> | same import from under `node_modules/` | exit 0 — dependencies exempt |
> | `createFileRoute("/x")({ component })` | exit 0 — no false positive on the router |
> | `createFileRoute("/x")({ server: { handlers } })` | **exit 1**, caret frame **on the right line** |
>
> That last row is the one §2.1 said no import-based technique could ever reach. It is caught by a
> brace-depth scan over comment-and-string-stripped source, matching only the **options-object-level**
> `server` key — so an app's own `server` field inside loader data does not fire. The scan returns a
> character offset precisely so `this.error()` can render the caret; a boolean would have been
> materially harder to act on.
>
> **Known scope limit, accepted:** the scan misses a route assembled indirectly
> (`const opts = {…}; createFileRoute("/x")(opts)`). That is the cost of not paying for a full parse on
> every module. The `resolveId` ban is the layer that must be airtight; this one raises the floor on a
> shape that would otherwise be completely invisible.
>
> **Linter surface shipped** as `biome-shared.json` at the package root, reachable as
> `"extends": ["@arrzdev/adaptv/biome-shared.json"]` (Biome's `extends` resolves bare npm specifiers).
> §2.6b's Biome-vs-oxlint call remains open — but it is a question about *which linter*, and the
> backstop no longer depends on the answer.
>
> **Latent break fixed in passing:** the `exports` map did not expose `./package.json`, which
> `docs/decisions/register.md §5.0.3` flagged as blocking `require.resolve("@arrzdev/adaptv/package.json")` — the exact
> call Capacitor makes when detecting a plugin. Added alongside the lint config.

### 2.1 What must be banned (corrected inventory)

| Symbol | Module | Status |
|---|---|---|
| `createServerFn` | `@tanstack/react-start` | banned |
| `createMiddleware` | `@tanstack/react-start` | banned |
| `getRequest` / `getRequestHeaders` / `getWebRequest` | `@tanstack/react-start/server` | banned (whole subpath) |
| `setResponseHeaders` / `setCookie` / `getCookie` | `@tanstack/react-start/server` | banned (whole subpath) |
| `server: { handlers }` on `createFileRoute({...})` | — | banned **(see below)** |

> **⚠︎ Correction to `docs/design/rendering.md §2`.** It lists **`createServerFileRoute`** as a forbidden symbol.
> **That export does not exist** in the pinned `@tanstack/react-start@1.167.13** — verified by grepping
> every `.d.ts` in the dependency tree. This API generation replaced it with a **`server` property on
> `createFileRoute`'s options object** (`start-client-core/.../serverRoute.d.ts`).
>
> This matters mechanically: **a config-object property is not an importable symbol**, so no
> import-restriction technique — TypeScript, Biome `noRestrictedImports`, or a `resolveId` block —
> can ever catch it. It needs an AST rule (§2.4) *or*, better, refusal at adaptv's own route-stamping
> layer, which adaptv already owns. `docs/design/rendering.md` should be corrected.

### 2.2 Layer 1 (mandatory) — the Vite plugin. **This is the real gate.**

Baked into the array `adaptv()` returns from `src/vite/adaptv-plugin.ts`, `enforce: "pre"`, ahead of
`tanstackStart()`. The consumer cannot disable it, misconfigure it away, or forget to run it — it is
not a devDependency they opt into, it is inside the framework's own plugin.

```js
function banServerApis() {
  return {
    name: "adaptv:ban-server-apis",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!/^@tanstack\/react-start(\/server)?$/.test(source)) return null
      // let adaptv's own internals and any other dependency resolve normally
      if (!importer || importer.includes(`${path.sep}node_modules${path.sep}`)) return null
      this.error(
        { message: `"${source}" is banned in application source — it needs a server, and a Capacitor build has none. See docs/design/rendering.md.` },
        { file: importer, line: 1, column: 0 },
      )
    },
  }
}
```

**Verified live.** A `src/`-rooted import fails the build; the identical import from under
`node_modules/` builds clean (`✓ 119 modules transformed`). Rolldown reproduces Rollup's
`this.error()` semantics exactly — passing a numeric `pos` from a `transform` hook auto-derives
line/column and renders a caret code frame:

```
✗ Build failed in 16ms
[plugin adaptv:ban-server-apis] .../src/main.ts:1:9
RolldownError: "createServerFn" is a adaptv server-only API and cannot be used in app code.
1: import { createServerFn } from "@tanstack/react-start"
            ^
```

**Why importer-scoped `resolveId` and not `resolve.alias`:** a blanket alias applies to *every*
resolution in the module graph with no visibility into the importer. It happens to be safe for adaptv
today (exactly one `@tanstack/react-start` reference in `src/`, in `adaptv-plugin.ts`, which is a
Node-side config-time import that never enters the bundle graph) — but that's incidental. It breaks
silently the day adaptv legitimately re-exports something client-safe.

Use a `transform` hook variant for **symbol-level** bans where the consumer should still reach other
helpers on the same subpath.

### 2.3 Layer 2 — Biome shared config, shipped and `extends`-ed

Gives inline editor squiggles and CI failure *before* a build is attempted. `noRestrictedImports`
supports per-symbol banning today on the pinned Biome 2.3.2:

```json
{
  "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": {
    "paths": {
      "@tanstack/react-start": {
        "importNames": ["createServerFn", "createMiddleware"],
        "message": "Server functions need a server; a Capacitor build has none. See docs/design/rendering.md."
      },
      "@tanstack/react-start/server": {
        "message": "The server-only entrypoint is banned in adaptv apps."
      }
    }
  } } } } }
}
```

**Verified:** each banned name gets its own diagnostic at the exact import-specifier column;
non-banned names on the same import line are untouched; `biome check` exits 1.

**Distribution — the useful detail:** Biome's `extends` **does** resolve bare npm package
specifiers. Verified: `"extends": ["@arrzdev/adaptv/biome-shared.json"]` resolves from
`node_modules` with no relative path. So adaptv ships `biome-shared.json` in its package and the
consumer adds one line. (`plugins` does **not** get this — see §2.4.)

### 2.4 Layer 3 — one GritQL plugin, for the gap nothing else reaches

Biome 2.x linter plugins are shipped and documented (no experimental banner). A working rule:

```grit
language js

`createServerFn($args)` where {
  register_diagnostic(span = $args, message = "createServerFn is banned in adaptv apps.")
}
```

**Verified end-to-end** against the repo's own Biome binary — real diagnostic, correct file/line,
`severity = "warn"` demonstrably flips the marker from `×` to `!`.

Its **purpose here is the `server: { handlers }` config-shape gap** from §2.1, which import-based
rules structurally cannot see. Two documented limits, both reproduced:

- **No binding resolution.** A locally-declared `function createServerFn() {}` with no import at all
  still fires the rule. GritQL matches syntax, not resolved bindings. Write patterns that also match
  the sibling import to cut false positives.
- **No package-name resolution for `plugins`.** A bare specifier fails with `Cannot read file`; an
  explicit `./node_modules/@arrzdev/adaptv/plugins/ban-server-apis.grit` works. So adaptv can ship the
  file, but the consumer's `biome.json` must reference it by an explicit `node_modules/`-qualified path.

### 2.5 Layer 4 — `never`-typed barrel entries, as free DX polish only

```ts
export * from "@tanstack/react-start"          // ← adaptv does NOT do this (§1), shown for contrast
export declare const createServerFn: never     // shadows the star export; call site → TS2349
```

Explicit local exports shadow star re-exports, and the call site errors with
*"This expression is not callable. Type 'never' has no call signatures."* — verified.

**But it compiles to nothing.** The emitted JS is bare `export * from "./fake-lib"`;
`export declare const X: never` erases completely. It stops `tsc` and the editor. It does not stop a
plain-JS consumer, an `as any`, a `@ts-expect-error`, or — critically — **Vite's own transform
pipeline, which does not type-check at all.** Ship it as autocomplete steering, never as enforcement.

### 2.6 ❌ Rejected mechanisms, with reasons

| Mechanism | Verdict |
|---|---|
| `@deprecated` JSDoc | **Nothing.** Verified in the TS 5.9.3 compiler source: diagnostic 6385 is `Category.Suggestion` — language-service only. `tsc` exits 0. No flag in 5.9 **or 6.0.x** escalates it. Cosmetic. |
| Declaration merging / `declare module` to poison an export | **Don't use.** With `skipLibCheck: false` → `TS2451 Cannot redeclare block-scoped variable`, firing in the vendored `.d.ts` for the wrong reason. With `skipLibCheck: true` — **which is adaptv's own tsconfig default** — the override is **silently ignored** and TS resolves the real type. Proven with a marker-type probe. Zero protection, zero warning. The TS Handbook documents this as out of scope. |
| `exports` map restriction | **No jurisdiction.** Node's docs: *"the `exports` field of package A has no effect on how package B is resolved."* It gates `adaptv/<subpath>` only, never a direct `@tanstack/react-start` import. |
| Relying on pnpm strictness | **Fragile side effect, not a mechanism.** Under default pnpm a consumer that never declares `@tanstack/react-start` genuinely cannot resolve it — but npm≥7/Yarn Classic hoist transitive deps (phantom dependency), and `node-linker=hoisted`/`shamefully-hoist` re-breaks it under pnpm too. Keep `@tanstack/react-start` a plain `dependency` (as it is) for the minor assist; never rely on it. |
| `pnpm patch` of `@tanstack/react-start` | **Reserve, don't wire up.** Version-pinned (pnpm 11 removed `ignorePatchFailures`, so drift now hard-fails installs), and it mutates a package the consumer legitimately needs in client-safe form. Backstop only, if TanStack ever forces a required side-effect import. |
| `vite-plugin-checker` | **Skip.** It's a `tsc --noEmit` wrapper, so it inherits every §2.5 weakness. Peer range is `vite: ^2.0.0`, with no Rolldown compatibility statement anywhere. The native `resolveId` hook already gives a hard, dependency-free failure. |

### 2.6b ⚠︎ Refinement — the Vite hook is the *gate*, but it is the wrong *primary surface*

An earlier draft of this doc called the Vite plugin "the real gate" and treated lint as a nice-to-have.
That undersells a structural problem, measured and verified:

**A Vite `transform`/`resolveId` error gives you no editor squiggles.** There is no LSP in the picture —
nothing publishes diagnostics from a bundler into an editor, and Vite exposes no diagnostic channel. You
get exactly two surfaces: the dev overlay (**and only when the module is actually requested** — a file
not imported by the running page is never checked) and `vite build` failure. Bundler-time validation is
structurally the *worst* place for a lint rule.

**Every precedent points the same way.** Qwik put its hardest contract rule — closure capture /
serialization — in **ESLint, not the optimizer** (`valid-lexical-scope`, which "uses the tsc typechecker
to detect the capture of unserializable data in dollar (`$`) scopes"), precisely because that's where
the typechecker and the editor live. `vite-plugin-checker` re-hosts real linters rather than inventing
bundler-native rules. Svelte's ~150 compiler error codes are the counter-example, but Svelte *owns the
compiler*.

**So the layering inverts:** the linter is the primary DX surface; the Vite hook is the unbypassable
backstop for people who don't run it. §2.2's claim that the hook can't be disabled or forgotten still
stands — that's exactly why it's the backstop and not the whole answer.

**Verified alternative to §2.3–2.4's Biome plan: oxlint JS plugins, built and run end-to-end.** Both
adaptv rules were implemented and executed against a real fixture:

```
fixture.tsx:3:10:  error adaptv(no-server-fn-import): Import from `adaptv`, not @tanstack/react-start.
fixture.tsx:36:11: error adaptv(no-overflow-on-view): 'overflow-hidden' is not allowed on <View>.
EXIT=1                                             # 0.31s wall, including process start
```

API is ESLint-shaped (`{ meta, rules }`, `create(context)`, `context.report({ message, node })`).
**Config key is `jsPlugins`, not `plugins`** — using `plugins` fails with `Unknown plugin`. And it closes
the DX gap: oxlint ships `--lsp` plus an official VS Code extension, with Zed/JetBrains/Neovim via LSP.

> **Caveat, stated plainly: oxlint JS plugins are explicitly "in alpha, and remain under active
> development."** The rule API being ESLint-shaped keeps migration risk low, but this is a real bet.
> Biome (§2.3) is the conservative pick and its `extends` resolves bare npm specifiers; oxlint is the
> pick that actually delivers editor squiggles today. **Prototype both before committing** — this is
> now the one genuinely open call in the ban design.

### 2.6c Implementation notes for the Vite backstop (measured)

- **You cannot reuse Rolldown's AST.** `ModuleInfo#ast` throws `UNSUPPORTED` — the AST lives in Rust and
  never crosses the napi boundary. There is no zero-cost hook; you must re-parse.
- **Use `this.parse(code, { lang: 'tsx' })`** — oxc-backed, ESTree-shaped, no extra dependency,
  version-locked to Vite's own oxc. The `lang` option is undocumented but works; `this.parse(code)`
  **throws on JSX**, and `{ jsx: true }` is the wrong key.
- **Prefer `this.error(msg, node.start)` over `throw`.** A bare throw dumps ~12 lines of irrelevant
  rolldown stack trace — confusing for what is a *lint* error, not a crash. `this.error()` takes a
  character offset, computes line/col itself, and renders a caret frame. Dev returns HTTP 500 with a
  structured payload the overlay renders; build exits 1. Both verified.
- **Cost is not the blocker.** Worst path (default oxc parse + full ESTree walk) is 0.435 ms/file ≈ 0.44 s
  across 1,000 modules. A `code.includes("@tanstack/react-start")` prefilter is **~14,000× cheaper than
  parsing** and skips most files. Guard every rule with a string prefilter.
- **Do not reach for `experimentalLazy`** despite its 10× win. Under lazy mode the AST is oxc's internal
  Rust shape, *not* ESTree — `JSXOpeningElement.name.type` is `IdentifierReference`, not `JSXIdentifier`.
  Rules written against ESTree names silently match **zero** violations. **Failing open is the wrong
  failure mode for a validation feature.** `experimentalRawTransfer` keeps ESTree and still gives ~3.9×.

> One idea from the research that **does not transfer**: the `server-only` package pattern (React team;
> `exports` conditions route to a module that throws, zero parsing). It works because the consumer
> *deliberately imports* `server-only` and the bundler picks the throwing branch in the wrong
> environment. adaptv's problem is banning a **third-party** import it doesn't own, so there is no
> `exports` map to hijack. Noted here so it isn't proposed again.

### 2.7 The shipping list

- `src/vite/adaptv-plugin.ts` — add the `resolveId` ban plugin to `adaptv()`'s array, before `tanstackStart()`.
- `biome-shared.json` at the package root, added to `files` + `exports`.
- ~~`plugins/ban-server-apis.grit` — the call-shape rule **plus** a `createFileRoute($opts)`-where-`$opts`-has-`server` pattern.~~
  **Never shipped.** There is no `plugins/` directory in the package. The gap it was for — the
  `server: { handlers }` config shape — is closed inside the Vite plugin itself by the brace-depth
  scan (`findServerRouteHandlers`, the BUILT block at the top of §2), which fails the build with a
  caret on the right line. A GritQL rule would add an editor squiggle for that one shape and nothing
  else; §2.4's two documented limits (no binding resolution, no bare-specifier `plugins` path) are
  why it has not been worth carrying.
- Correct `docs/design/rendering.md §2`'s `createServerFileRoute` entry to `server: { handlers }`.

---

## 3. Opacity — deferred, with the evidence written down

### 3.1 Why the obvious approach doesn't work (tested 2026-07-05, still true)

Augmenting adaptv's re-export barrel — `declare module "@repo/adaptv/react-router" { interface Register … }`
— **does not merge into `@tanstack`'s interface.** TypeScript binds augmentation to the *declaration
site*, and `Link`/`useRouter` read `@tanstack`'s own `FileRoutesByPath`/`Register`. Probe:
`"__marker__" extends keyof Register` resolved **`false`**.

**Consequence: a re-implemented generator pointed at a adaptv barrel would silently break typed
routing** — no error, just `to="/anything"` accepting garbage. This is the single most important fact
in the whole facade question and it must not be re-discovered a third time.

### 3.2 Why `docs/design/architecture.md §3.3` frames the spike wrong

It presents the decision as **"Virtual File Routes vs `pnpm patch` of `@tanstack/router-generator`."**
Neither is the mechanism. The actual, spike-proven path (Path X) is:

1. The adaptv seam declares its **own** `Register` + `FileRoutesByPath` and re-types the three
   route-aware symbols (`useRouter`, `useNavigate`, `createFileRoute`) to default to
   `RegisteredRouter<Register>`. This is **not a fork** — it reuses TanStack's own generics, which are
   all router-parameterised.
2. `verboseFileRoutes: false` to remove the source import, **plus replacing TanStack's
   `route-autoimport-plugin`** (it injects a hardcoded `@tanstack/react-router`) with a adaptv one.
3. **Post-process `routeTree.gen.ts` on disk** after the generator writes it — rewrite the import,
   drop `createStart`, fold the react-start `Register` augmentation into adaptv's single one. Guard on
   "contains @tanstack" to avoid a rewrite loop.

**Spike proof** against real `@tanstack/react-router@1.168.8`: `Link({to:"/settings"})` compiles;
`Link({to:"/nope"})` errors `TS2322: '"/nope"' is not assignable to '"/" | "/settings" | "." | ".."'`.
**Feasibility is settled. Only the wiring is unbuilt.**

The known blocker is operational, not technical: the generator **re-adds** the `@tanstack`
`createFileRoute` import to route files and regenerates `routeTree.gen.ts` live — a running
`vite dev` reverted every edit during the original attempt. Land this with the dev server **off**, in
an isolated worktree.

### 3.3 🔒 Decision: Tier 1 now, Tier 2 only if adaptv goes public

> ✅ **Tier 2 SHIPPED — this decision was reversed by L20 (2026-07-25), and the table below is the
> record of what was decided on 07-20, not the state of the tree.** The owner made "the consumer
> never sees @tanstack" the requirement rather than waiting for a public release, and the mechanism is
> exactly Path X from §3.2: `src/vite/route-tree-opacity.ts` post-processes `routeTree.gen.ts`,
> `src/vite/router-autoimport.ts` replaces TanStack's autoimport plugin, `src/vite/thunk-specifiers.ts`
> repoints the generated specifiers, and `bin/lib/opacity.mjs` holds every byte the CLI prints to the
> same line. The recurring cost predicted below is real and is paid: two version-keyed patches under
> `patches/` (L21) and `assertRouteTreeIsOpaque`, which fails the build the day the rewrite stops
> reaching the file. → `register.md` §3.2 (resolved), L20.

| | Scope | Cost | Status |
|---|---|---|---|
| **Tier 1 — curated barrel** | adaptv exports only what it endorses; TanStack is a named engine dep; unsafe APIs banned at build time (§2) | ~zero | **shipped 2026-07-20** |
| **Tier 2 — full opacity** | consumer's source and `package.json` never mention `@tanstack/*` | a permanent re-typed-hook surface + a generator post-processor to maintain across every TanStack upgrade | ~~deferred~~ **shipped 2026-07-25 (L20)** |

Tier 2's cost is *recurring* and lands on the exact seam TanStack changes most often. It buys
branding, not correctness — and it was already tried once and abandoned. Revisit **only** when
"the consumer never sees @tanstack, ever" becomes a hard product requirement (i.e. adaptv ships
publicly as a branded framework).

**Roadmap consequence: `.adaptv/` + the barrel drops from #1.** It was #1 on a "feels like a real
framework" argument that Tier 1 largely satisfies for free. The genuine #1 is `@adaptv/shell` (the
Android-15 inset/IME crux) — the only item that is both high-risk and blocking real device
correctness.

### 3.4 What still ships from `.adaptv/`

The *hiding* is deferred; the **tidiness** is not. Relocating generated files
(`routeTree.gen.ts`, `router.gen.tsx`, `register.d.ts`) into a git-ignored `.adaptv/` needs **none** of
the type gymnastics above — it's a `router.generatedRouteTree` path change plus tsconfig `paths` and
a Vite alias. Consumers stop seeing `*.gen` files at the app root. **Do this; it's cheap and
independent.**

---

## 4. Where this doc sits

- `docs/design/rendering.md` — *why* the boundary exists. **This doc is how it's enforced.** Its
  `createServerFileRoute` reference needs the §2.1 correction.
- `docs/design/architecture.md §3` — superseded on the opacity question by §3 here; §3.3's spike framing is wrong.
- `docs/decisions/register.md` — §3.2 conflict resolved by this doc.

---

## 5. Upstream reading (was `RESEARCH.md §2`)

> Absorbed when `RESEARCH.md` (deleted 2026-08-30 — see git history) was dissolved. **Links were last verified
> 2026-07** and have not been re-checked since — treat every URL below as a lead, not a
> citation. The generator-hiding path described here is no longer speculative: it **shipped**
> as `src/vite/route-tree-opacity.ts` + `router-autoimport.ts` + `thunk-specifiers.ts`,
> enforced by `bin/lib/opacity.mjs`. Kept for the `createServerFn` nuance in the first
> paragraph, which is the reasoning behind **L3**.


**createServerFn nuance (refines `docs/design/rendering.md`).** TanStack Start's SPA mode *does* support server
functions — **but only because a SPA served from a host still has that host's server to RPC into.** A
**Capacitor** build is a static bundle with **no server at all**, so `createServerFn` has nothing to
call → still forbidden there. Also: SPA mode disables server-side execution of `beforeLoad`/`loader`
and SSR of route components, **except** root-route loaders, which run during shell prerender. So the
precise rule for adaptv's *native* target stays: **no `createServerFn`, no server routes** — keep
loaders isomorphic.
- SPA mode: <https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode>
- Selective SSR: <https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr>
- Server functions: <https://tanstack.com/start/latest/docs/framework/react/guide/server-functions>
- RFC SPA enhancements (watch): <https://github.com/TanStack/router/discussions/3394>
- Prerender data in SPA: <https://github.com/TanStack/router/discussions/6402>

**Hiding the router (the `.adaptv/` + barrel plan is feasible).** The generator matches routes by the
exported `Route` identifier from `createFileRoute`, but **Virtual File Routes** (`__virtual.ts`) let you
*completely override the generation convention and relocate the generated files* — the supported hook
for emitting into `.adaptv/` and controlling what's imported. `autoCodeSplitting` + `codeSplitGroupings`
are the knobs for the chunking adaptv wants. If the `createFileRoute` symbol must be re-exported as
adaptv's own, that's the one spot for a `pnpm patch` of `@tanstack/router-generator`.
- Virtual file routes: <https://tanstack.com/router/latest/docs/routing/virtual-file-routes>
- File-based routing API: <https://tanstack.com/router/latest/docs/api/file-based-routing>
- Automatic code splitting: <https://tanstack.com/router/latest/docs/guide/automatic-code-splitting>

