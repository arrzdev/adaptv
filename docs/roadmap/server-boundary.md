# adaptv — the server boundary: no server functions on any target, detected from the compiler

> **Status: direction decided by the owner on 2026-10-05. Not built.**
>
> It replaces the direction of 2026-09-14, which would have let server-backed web use server
> functions and refused only the artifacts with no server. The owner reversed it on 2026-10-05: an
> API a native app cannot run is an API adaptv does not offer, on any target. That reversal is
> recorded in [`../decisions/facade-and-opacity.md §2`](../decisions/facade-and-opacity.md) and
> register **L3** / **O3**.
>
> What runs today already has the right *rule*: the import ban built on 2026-07-20
> (`src/vite/ban-server-apis.ts`, `biome-shared.json`) refuses server functions on every target. What
> it lacks is *coverage*: it matches import specifiers, and a specifier list is always one alias
> behind. This item is the work that closes that gap. When it ships, move this file into `design/`.

---

## 0. The direction, in the owner's terms

1. **adaptv has no server side.** A framework that must run the same app on web, PWA, iOS and
   Android offers only what runs on all of them. Server functions, server routes and server-only
   request context would work on the web and break on a phone, so adaptv does not offer them, for
   any app, on any target, web-only apps included. Server logic lives in an API the app calls over
   the network.
2. **An adaptv developer never imports TanStack Start (or Router) directly (L20).** Everything comes
   from an `adaptv/*` subpath. A direct import of any engine package is refused, whatever
   it imports, with a message that names the subpath to use instead (L7: guardrails teach).
3. **The refusal reads what the compiler decided, not a list of names.** It catches a server
   function however it was imported.

Rendering a page on a server (`render: "ssr"`) is not in this item; it is a delivery choice for the
web artifact and does not change what app code may call.

---

## 1. What changes

| Surface | Built today (2026-07-20) | Direction (2026-10-05) |
|---|---|---|
| `createServerFn`, `createMiddleware`, server routes, request context | Refused on every target, matched by import specifier and a brace-depth scan for `server: { handlers }` | **Still refused on every target**, detected from the compiler's own set of server functions and the server build's router (§3) |
| Direct import of an engine package from app source | **Built 2026-10-05** (`src/vite/engine-imports.ts`, [`facade-and-opacity.md §1`](../decisions/facade-and-opacity.md) rule 4): refused for every adaptv dependency and the whole `@tanstack/` scope unless the app lists the package itself | Done. The server-only modules stay refused even when listed. |
| Lint (`biome-shared.json`) | `noRestrictedImports` on the server symbols | Kept, plus the engine-import rule. Lint is the fast signal; the build is the backstop. |

---

## 2. Why the compiler's verdict and not an import list

#292 measured this: the Start compiler recognises a server function by *package and resolved
binding*. It seeds known roots per package and follows `export *` chains (`start-plugin-core`'s
`compiler.js`, `init()` and `resolveKnownImportKind()`). A specifier list missed `createServerFn`
imported from `@tanstack/start-client-core`, and missed every framework root built on it. The check
has to read what the compiler decided, not guess what it will decide.

---

## 3. Detection: measured on the pinned Start (spike, 2026-10-09)

Measured against `@tanstack/react-start` 1.168.36 (`start-plugin-core` 1.171.27, `router-plugin`
1.168.24, `router-generator` 1.167.22, Vite 8.0.11). The fixtures and the test that re-measures all
of this on every gate run are in `test/server-boundary/`. One fixture app is built by
`tanstackStart()` with a probe plugin on each side of it; each fixture route is then built again
through today's two rules alone (`ban-server-apis.ts`, `engine-imports.ts`).

| Fixture (`test/server-boundary/fixture-app/src/`) | What it is | Today's rules |
|---|---|---|
| `routes/index.tsx` | control: a loader returning a field named `server` | allowed (right) |
| `fns/adaptv-subpath.ts` | `createServerFn` from `adaptv/server-fn`, a package that re-exports it | **missed** (`it.fails`) |
| `fns/client-core.ts`, app does not list the package | `createServerFn` from `@tanstack/start-client-core` (#292) | refused by the engine-import rule |
| `fns/client-core.ts`, app lists the package | same | **missed** (`it.fails`): the ban names two specifiers (#292 is open) |
| `fns/local-reexport.ts` | `createServerFn as defineAction` re-exported by `lib/server.ts` | refused, because `lib/server.ts` imports the banned root |
| `routes/literal-server-route.tsx` | `server: { handlers }` on the call's object literal | refused by the brace scan |
| `routes/indirect-server-route.tsx` | options in a same-file `const` | refused, **by accident**: the scan reads the first `{` after the first `createFileRoute`, here the options |
| `routes/spread-server-route.tsx` | the same, behind another object literal | **missed** (`it.fails`): the scan stops at the first object |
| `routes/imported-server-route.tsx` | options imported from `lib/route-options.ts` | **missed** (`it.fails`) |

### 3.1 The compiler's own set of server functions: exposed as its output, not as a set

The set itself is not exposed. `startCompilerPlugin()` (`start-plugin-core`
`vite/start-compiler-plugin/plugin.js`) keeps it in a closure, `serverFnsById`, filled by the
compiler's `onServerFnsById` callback. No plugin API, `globalThis` key or file carries it. What a Vite
plugin can read is what the compiler writes with it:

- **The client environment's stubs.** The compiler (`start-compiler/handleCreateServerFn.js`, a
  `transform` at `enforce: "pre"`) rewrites each server function into
  `createServerFn().handler(createClientRpc("<sha256 id>"))` and adds
  `import { createClientRpc } from "@tanstack/react-start/client-rpc"` to the module. A later
  `transform` sees the stub; an `enforce: "pre"` `resolveId` sees the inserted import with the app
  module as `importer`.
  On the fixture: exactly `fns/adaptv-subpath.ts`, `fns/client-core.ts` and `fns/local-reexport.ts`,
  and nothing else. The adaptv-subpath case is caught: the compiler resolves the binding through
  the package's named re-export.
- **The server-function resolver module.** In the `ssr` environment the virtual module
  `#tanstack-start-server-fn-resolver` is generated from the same closure
  (`start-compiler/server-fn-resolver-module.js`). A `transform` on it reads a manifest of
  `functionName` and source file for every server function. On the fixture: all three.
- **Not the server environment's own compile.** There, `adaptv/server-fn` is external, the
  compiler's `resolveId` drops external results, and `fns/adaptv-subpath.ts` ships to
  `dist/server` uncompiled. Only two of the three files get the `server-rpc` import. The resolver
  lists the third only because the client environment found it, so read the client environment.

Two limits that hold for every reading of this candidate. It covers what the compiler compiles: a
module the build never reaches is not reported (no harm: it does not ship). And in `vite dev` the
compiler runs per requested module, so dev reports a server function when its page loads, not at
startup.

### 3.2 Reachability of the client RPC runtime: precise only one hop deep

Exposed through the module graph: `this.getModuleIds()` and `this.getModuleInfo(id).importers` in
the client environment's `buildEnd`.

- **The modules that import `@tanstack/react-start/client-rpc` directly** are, on the fixture, the
  same three files as §3.1. That specifier is one the compiler inserts, so this is §3.1 read from the
  graph rather than from the code.
- **A transitive walk over-reports.** Walking every importer up from the `client-rpc/*` modules
  also reaches `lib/server.ts`, which only re-exports the factory: `start-client-core`'s own index
  imports `client-rpc/serverFnFetcher.js`. Any module that imports the root is "reachable".

So this candidate is not independent of §3.1. Its use is the chain for the report: start from the
modules that import the inserted specifier, and walk up from *those* to the app files and routes
that reach them. A stub inside `node_modules` (a library Start compiles into the app, the way it
does `@tanstack/react-form-start`) is reported at the app module that imports the library.

### 3.3 Server routes: the generated route tree misses them; the server build's router does not

- **The generator** records route options only from an object literal written in the call
  (`router-generator` `transform/transform.js`, `getCreateFileRouteProps()`: a non-literal argument
  gives nothing). Start reads that set to prune a route whose only option is `server` from the
  client route tree (`start-router-plugin/pruneServerOnlySubtrees.js`). On the fixture, the client
  route tree drops `literal-server-route` and keeps the three others. The route tree adaptv already
  post-processes (`.adaptv/routeTree.gen.ts`) carries no option at all. Not usable.
- **The client code-splitter** deletes `server`, `ssr` and `headers` from the route options in the
  client environment (`deleteNodes` in `start-router-plugin`'s plugin), and resolves a same-file
  `const` to do it (`resolveIdentifier()` in `router-plugin` `code-splitter/compilers.js`). It does
  not follow an import: `imported-server-route`'s handler is in `dist/client`, verbatim. It reports
  nothing a plugin can read. Not usable.
- **The server build's router** is. Importing the built `dist/server/assets/router-*.js` and calling
  its `getRouter()` gives a router whose `routesById[id].options.server` is set for all three server
  routes (literal, same-file `const`, imported) and for nothing else, the control included. That is
  what Start reads when it serves a request, so it cannot disagree with Start.
- **Route id to file**: Start's `routesManifestPlugin` leaves `globalThis.TSS_ROUTES_MANIFEST`, a map
  of route id to `filePath`, during the build. On the fixture it maps `/imported-server-route` to its
  file.

### 3.4 Not measured here

Server-only request APIs (`@tanstack/react-start/server`: `getRequest`, cookies) and
`createMiddleware`. The first is a module, so reachability of the server-runtime family from the
client graph is the obvious check, and the engine-import rule already refuses it in app source. The
second is compiled by the same compiler (`handleCreateMiddleware.js`); whether its client output
leaves a mark like `client-rpc` was not measured.

The report follows the CLI contract: [`../design/cli-visual.md`](../design/cli-visual.md) for copy,
and R8 / `bin/lib/opacity.mjs`, so it never names TanStack. The shape is illustrative, not final copy:

```
✗ build: this app reaches 2 server functions, and adaptv apps have no server side
  src/routes/todos.tsx:14   getTodos   reached from /todos
  src/lib/auth.ts:8         whoAmI     reached from /, /settings
  Move this logic to your API and call it by absolute URL, or into a route loader.
```

---

## 4. What happens to what is built

No backward compatibility: the old shape is deleted, not kept behind a flag.

- `src/vite/ban-server-apis.ts`: the `resolveId` refusal stays and becomes the engine-import
  refusal; #292's deny-by-default family matcher is the right matcher for it. The server-function
  refusal moves to §3.1's detection, and `findServerRouteHandlers` is replaced by §3.3's router check.
- `biome-shared.json`: the server-symbol rule stays; the engine-import rule is added.
- `docs/design/rendering.md §2`, `docs/decisions/facade-and-opacity.md §2`, register **L3** and
  **O3** already state the rule this item enforces.

---

## 5. Recommendation (from the 2026-10-09 spike)

**Server functions: candidate 1, read in the client environment through the import the compiler
inserts.** It is the compiler's verdict, it covered every fixture, and it needs no Start internals:
one `resolveId` at `enforce: "pre"`, scoped to the `client` environment, that records an importer of
`@tanstack/<framework>-start/client-rpc`. In `vite dev` it refuses at once, in that module, like the
ban does today. In a build it collects, and the client environment's `buildEnd` walks up from each
recorded module to the app files and routes that reach it (§3.2), then fails once with the whole
list. Do not read the SSR resolver module (it misses externalized packages in its own compile) or
walk from the RPC runtime (it over-reports).

**Server routes: candidate 3, read from the server build's router, not from the route tree.** After
the `ssr` environment is written, import its router chunk, call `getRouter()`, and refuse every
`routesById` entry with `options.server`, naming the file from `TSS_ROUTES_MANIFEST`. A SPA or native
build already evaluates that router in Start's prerender, so this runs no app code that build does
not run already; a `render: "ssr"` build without prerender evaluates it here for the first time. In
dev, the same walk over the router the `ssr` environment's module runner loads.

**The implementation task**, one PR, size **M** (about two days with review):

1. A new `src/vite/server-boundary.ts` with the two checks above, inserted into `adaptv()` beside
   `ban-server-apis.ts`, and the report through `bin/lib/opacity.mjs` and the `cli-ux` contract (no
   engine name, file and line, the route that reaches it).
2. `ban-server-apis.ts`: the `server: { handlers }` scan (`findServerRouteHandlers`) is deleted;
   the `resolveId` specifier ban stays as the engine-import refusal (§4).
3. `test/server-boundary/server-boundary.test.ts`: build the fixture through the new plugin, and turn
   the four `it.fails` into `it`. Add `createMiddleware` and a request-API fixture first (§3.4).
4. Run the playground's SSR and SPA builds once to see the router check is quiet on a clean app.

Smaller, and independent: merging #292 (the specifier family) closes the declared
`@tanstack/start-client-core` case before this ships. #292 also bans `/client-rpc`, and §3.1
measured that an `enforce: "pre"` `resolveId` sees the compiler's inserted `client-rpc` import with
the app module as `importer`, so with #292 merged the ban should refuse every compiled server
function already, with a message that names an import the developer never wrote (inferred, not run
against #292's branch). The task above replaces that accident with a check on purpose.

