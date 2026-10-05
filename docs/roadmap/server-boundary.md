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
   from an `@arrzdev/adaptv/*` subpath. A direct import of any engine package is refused, whatever
   it imports, with a message that names the subpath to use instead (L7: guardrails teach).
3. **The refusal reads what the compiler decided, not a list of names.** It catches a server
   function however it was imported.

Rendering a page on a server (`render: "ssr"`) is not in this item; it is a delivery choice for the
web artifact and does not change what app code may call.

---

## 1. What changes

| Surface | Built today (2026-07-20) | Direction (2026-10-05) |
|---|---|---|
| `createServerFn`, `createMiddleware`, server routes, request context | Refused on every target, matched by import specifier and a brace-depth scan for `server: { handlers }` | **Still refused on every target**, detected from the compiler's own set of server functions and the generated route tree (§3) |
| Direct import of an engine package from app source | Refused only for two Start specifiers (#292, open, widens it to the Start family) | **Refused for every engine package**, whatever is imported. The reason is L20, not servers. |
| Lint (`biome-shared.json`) | `noRestrictedImports` on the server symbols | Kept, plus the engine-import rule. Lint is the fast signal; the build is the backstop. |

---

## 2. Why the compiler's verdict and not an import list

#292 measured this: the Start compiler recognises a server function by *package and resolved
binding*. It seeds known roots per package and follows `export *` chains (`start-plugin-core`'s
`compiler.js`, `init()` and `resolveKnownImportKind()`). A specifier list missed `createServerFn`
imported from `@tanstack/start-client-core`, and missed every framework root built on it. The check
has to read what the compiler decided, not guess what it will decide.

---

## 3. Detection: what the implementation must measure first

Nothing below is verified against the pinned `@tanstack/react-start`. **A spike comes first**, and
this section gets replaced by what it measured. The candidates, strongest first:

1. **The compiler's own set of server functions for this build.** Start replaces each server
   function in the client environment with an RPC stub keyed by a function id, and collects the
   functions for its server side. A non-empty set means refuse. Because
   the compiler resolved the bindings, aliases, re-exports and adaptv's own subpath are all
   covered.
2. **Reachability of the client RPC runtime from the app's client graph.** If an app module in the
   client bundle reaches the module the stubs call, a server function call survived. This gives the
   import chain the report prints.
3. **Server routes**, read from the generated route tree (adaptv already post-processes it, **L20**)
   rather than from the brace-depth scan, which misses a route assembled indirectly.
4. **Server-only request APIs**: reachability of the server-runtime package family from the client
   graph.

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
  refusal moves to §3's detection, and `findServerRouteHandlers` is replaced by §3 item 3.
- `biome-shared.json`: the server-symbol rule stays; the engine-import rule is added.
- `docs/design/rendering.md §2`, `docs/decisions/facade-and-opacity.md §2`, register **L3** and
  **O3** already state the rule this item enforces.
