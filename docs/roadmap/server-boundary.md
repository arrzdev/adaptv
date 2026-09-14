# adaptv — the server boundary: server functions on the web, a refusal on native

> **Status: direction decided by the owner on 2026-09-14. Not built.**
>
> It replaces the import ban built on 2026-07-20 (`src/vite/ban-server-apis.ts`, `biome-shared.json`,
> register **L3** / **O3**, [`../decisions/facade-and-opacity.md §2`](../decisions/facade-and-opacity.md)).
> That ban refuses `createServerFn` and its siblings on every target, for the reason that a native
> app has no server. This file records the new direction, why it is better, and what the
> implementation has to settle first. When the direction ships, move this file into `design/`.
> Record the rejected ban in the decision doc, not here.

---

## 0. The direction, in the owner's terms

1. **An adaptv developer never imports TanStack Start (or Router) directly.** Start is an engine
   underneath adaptv (**L20**). Everything the developer needs comes from an `@arrzdev/adaptv/*`
   subpath, sometimes patched. A rule about *which Start package* an app imports is a rule about a
   package the app should not be naming at all. So the guardrail is about importing the engine
   directly, and it covers every engine package, whatever is imported from it.
2. **Server functions are a web feature, not a forbidden one.** An app that ships only to the web
   and as a PWA still gets the harness adaptv provides: shell, service worker, safe areas,
   components, dev loop. It can also use server functions, server routes and request context where
   a server exists.
3. **The artifact that cannot run them refuses to build, and says why.** The check is not a static
   import list. It is a smart, dynamic detection of what the app actually reaches. A native build
   fails and reports each server function it found, instead of the whole framework forbidding them
   up front.

The safety promise in [`../decisions/facade-and-opacity.md §0`](../decisions/facade-and-opacity.md)
still holds, and holds more precisely: *a consumer cannot ship an API that dies on device.* The
refusal moves from the import, which knows nothing about targets, to the one artifact that has no
server.

---

## 1. What changes

| Surface | Built today (2026-07-20) | Direction (2026-09-14) |
|---|---|---|
| Direct import of an engine package (`@tanstack/react-start`, its family, `@tanstack/react-router`) from app source | Refused only for two Start specifiers, and only because they carry server APIs (#292 widens this to the Start family) | **Refused for every engine package, whatever is imported**, with a message that names the `@arrzdev/adaptv/*` subpath to use instead (L7: guardrails teach). The reason is L20, not servers. |
| `createServerFn`, `createMiddleware` | Banned everywhere | **Exported by adaptv** from a server subpath (name open, §5), patched if needed |
| Server routes (`server: { handlers }` on a route) | Banned everywhere (`findServerRouteHandlers` scan) | Allowed; reported on a serverless artifact (§2) |
| Request context (`getRequest`, `setCookie`, `setResponseHeaders`, …) | Banned everywhere | Exported by adaptv on the server subpath; reported on a serverless artifact |
| `dev web`, `build web` with `render: "ssr"` | Build error at the import | **Works** |
| `build web` with `render: "spa"` (static deploy) | Build error at the import | **Refuses with the report**: a static host has no server to call either |
| `build ios` / `build android` | Build error at the import | **Refuses with the report** |
| `dev ios` / `dev android` | Build error at the import | **Refuses with the report.** The dev server *is* a server, so a server function would work on the device in dev and die in the release build, which is the exact trap the ban existed to close. |
| OTA bundle for native | Build error at the import | Refuses: it is a native artifact |
| Lint (`biome-shared.json`) | `noRestrictedImports` on the server symbols | The engine-import rule only. A linter cannot know which artifact a file will ship in. |

---

## 2. Why refuse the artifact and not the import

- **It keeps the promise where the promise is made.** "One codebase, six targets" is a promise about
  what each artifact does when it runs. An artifact that cannot run a server function is the one
  place that knows it, and the only place a refusal is never a false positive. A web-only app is
  not a native app with a bug.
- **An import list is always one alias behind.** #292 measured this: the Start compiler recognises a
  server function by *package and resolved binding*. It seeds known roots per package and follows
  `export *` chains (`start-plugin-core`'s `compiler.js`, `init()` and `resolveKnownImportKind()`).
  A specifier list missed `createServerFn` imported from `@tanstack/start-client-core`, and missed
  every framework root built on it. Once adaptv re-exports the function from its own subpath, the
  specifier an app imports is adaptv's, and a name list stops meaning anything at all. The check
  has to read what the compiler decided, not guess what it will decide.
- **The report is the product.** L7 says guardrails teach. "Banned" teaches nothing a web-only app
  can act on. "This ios build reaches 2 server functions, from these routes; move them behind your
  API or build for the web only" is the decision the developer actually has to make.

---

## 3. Detection: what the implementation must measure first

Nothing below is verified against the pinned `@tanstack/react-start`. **A spike comes first**, and
this section gets replaced by what it measured. The candidates, strongest first:

1. **The compiler's own set of server functions for this build.** Start replaces each server
   function in the client environment with an RPC stub keyed by a function id, and collects the
   functions for its server side. A non-empty set on a serverless artifact means refuse. Because
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
✗ ios build: this app reaches 2 server functions, and a native app has no server
  src/routes/todos.tsx:14   getTodos   reached from /todos
  src/lib/auth.ts:8         whoAmI     reached from /, /settings
  Call them over your API by absolute URL, or build this app for the web only.
```

---

## 4. How an app says which artifacts it ships

This ties to appId. The docs already say a web-only app omits `appId` (the `src/config/app-config.ts`
JSDoc, [`../design/lifecycle.md`](../design/lifecycle.md)), and the CLI is being brought in line so
that only the commands that touch a native platform require it. The same line decides the boundary:

- **An app with no native configuration is web-only.** Server functions are simply available, and
  nothing warns about them.
- **An app that configures native** gets one notice from `dev web` and `build web`, not a failure.
  The notice names the server functions a native build will refuse, so the refusal is never first
  seen on release day. The owner still has to confirm this default.

---

## 5. Open for the implementation PR

- **The subpath name**: `@arrzdev/adaptv/server` beside the existing `./server-entry`, or one
  subpath for both.
- **Web-only routes inside a native app.** A route that exists only on the web and is stripped from
  the native build would let one app use server functions on some pages. It is out of scope; the
  report names the routes, so the cost is visible.
- **Offline.** A server function is a network call. The service worker already keeps `/_serverFn/`
  out of navigation (`src/sw/sw.navigation.ts`), the offline shell still renders, and the calls
  fail like any API while offline. [`../design/rendering.md §3`](../design/rendering.md) owes a
  sentence on this.
- **Where the refusal runs.** It could run at the end of the client build (a Vite plugin hook) or in
  the CLI after it. The rule is one guard and one sentence, used by build, dev and OTA publish alike.

---

## 6. What happens to what is built

No backward compatibility: the old shape is deleted, not kept behind a flag.

- `src/vite/ban-server-apis.ts`: the `resolveId` refusal becomes the engine-import refusal. #292's
  deny-by-default family matcher is the right matcher for that; its server-function rationale and
  message are not. The server-symbol wording goes, and `findServerRouteHandlers` is replaced by §3 item 3.
- `biome-shared.json`: the engine-import rule replaces the server-symbol rule.
- `docs/design/rendering.md §2`, `docs/decisions/facade-and-opacity.md §1–§2`, register **L3** and
  **O3**, `docs/VISION.md` and `docs/decisions/positioning.md` already point here.
