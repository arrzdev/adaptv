import { RouterProvider } from "@tanstack/react-router"
import { StartClient } from "@tanstack/react-start/client"
import { StrictMode, startTransition } from "react"
import { createRoot, hydrateRoot } from "react-dom/client"
import { getRouter } from "#adaptv/routes/router-entry"
import { installNativeLiveReloadRecovery } from "#adaptv/shell/native-live-reload-client"

/**
 * The client entry. **Framework code, wired as Start's `client.entry` for BOTH
 * render targets**, because the choice it makes is not a build-time one.
 *
 * ## The two ways a adaptv document can arrive
 *
 * Start's default entry renders `<StartClient />`, which calls `hydrateStart()`
 * → `hydrate(router)`, and that hard-requires a `window.$_TSR` bootstrap object
 * **injected into the HTML by a server or a prerender**. Without it it throws
 * `Invariant failed` before React mounts anything, so the page is left showing
 * whatever the shell's critical CSS painted — a blank screen, in adaptv's case a
 * dark one.
 *
 * A document with no `$_TSR` is not an edge case here, it is a shipped path:
 *
 * - **`render: "spa"`** — no server at all. The `capacitor` target is a folder of
 *   files on the device, and a web `spa` build is prerender-off (MEASURED: Start
 *   emits no shell in this config, `static-host.ts`).
 * - **`render: "ssr"`, served offline.** The service worker's navigation route
 *   falls back to the precached app shell (`shell-emit.ts`), which is *generated*
 *   from config and therefore carries no server bootstrap by construction. Same
 *   for a static host serving `index.html`/`404.html` for a deep link.
 *
 * So the branch is on **what this document actually contains**, evaluated in the
 * browser — not on `render`, which cannot know whether the response came from
 * the origin or from the cache.
 *
 * ## Both mount at the `document`, and only one of them hydrates
 *
 * adaptv's root route renders the whole `<html>` document (`shell-layout.tsx`), so
 * React must mount at the document, not inside a `div` — the same shape Start
 * hydrates. That holds for `createRoot` as much as for `hydrateRoot`: React 19
 * accepts a `Document` as a root container, and its `<html>`/`<head>`/`<body>`
 * are singletons it adopts rather than creates.
 *
 * In the no-bootstrap case there is nothing server-rendered to hydrate *from*, so
 * it gets a **client root**. The generated shell is a static document whose body
 * is an empty mount point, and the first client render can never match it: the
 * router's own `<Suspense>` meets the shell's first text node. Hydrating it
 * anyway logged React #418 on every launch of the native app, every spa
 * document and every offline ssr boot, and React then did what a client root
 * does from the start — clear the document sparingly (the head's inline scripts,
 * styles and stylesheets survive, everything else goes) and render. So the
 * failed pass bought nothing but the error, which lands on `window` as an
 * `error` event in front of the boot watchdog and any app telemetry.
 * `suppressHydrationWarning` could not have hidden it: it covers text and
 * attribute drift, not a structural mismatch.
 * → `client-entry.test.tsx`, `docs/design/rendering.md §3.1`
 *
 * Both are scheduled inside the same `startTransition`, as the hydration always
 * was, so the boot keeps its priority.
 */

//native dev only: recover the live-reload socket when the WebView's OS drops it.
installNativeLiveReloadRecovery()

const serverRendered =
  typeof window !== "undefined" &&
  (window as unknown as { $_TSR?: unknown }).$_TSR != null

//Built at module scope, never inside render: `getRouter()` inside the component
//would construct a new router on every pass and throw the match state away.
const clientRouter = serverRendered ? null : getRouter()

//The deploy base, applied the way the server-rendered path applies it: that
//path's `hydrateStart()` sets `basepath` from this same build constant before it
//hydrates, and a router booted from the shell skips it. Without it every route
//under `base: "/app/"` resolves as `/app/...` against a tree rooted at `/`, so a
//GitHub Pages project site boots straight into the not-found screen.
//
//Only under a subpath. At the origin root the constant is `""`, the bundler
//drops the branch, and a shell-booted router (every native launch among them,
//which never has a base) keeps exactly the state it booted with.
if (process.env.TSS_ROUTER_BASEPATH) {
  clientRouter?.update({ basepath: process.env.TSS_ROUTER_BASEPATH })
}

startTransition(() => {
  if (clientRouter) {
    createRoot(document).render(
      <StrictMode>
        <RouterProvider router={clientRouter} />
      </StrictMode>,
    )
  } else {
    hydrateRoot(
      document,
      <StrictMode>
        <StartClient />
      </StrictMode>,
    )
  }
})
