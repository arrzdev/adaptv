import { RouterProvider } from "@tanstack/react-router"
import { StartClient } from "@tanstack/react-start/client"
import { StrictMode, startTransition } from "react"
import { hydrateRoot } from "react-dom/client"
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
 * ## Why `hydrateRoot` on both sides
 *
 * adaptv's root route renders the whole `<html>` document (`shell-layout.tsx`), so
 * React must mount at the document, not inside a `div` — the same shape Start
 * hydrates. `createRoot` is not an alternative: it takes an `Element`, and the
 * only element that could host an `<html>` render is `documentElement` itself.
 *
 * In the no-bootstrap case there is nothing SSR-rendered to hydrate *from*, so
 * this is the canonical TanStack **Router** (not Start) boot: build the router,
 * mount it against the shell.
 *
 * MEASURED, and worth knowing before it is reported as a regression: that second
 * path logs one **React #418** ("hydration failed") at boot. It is inherent, not a
 * bug to chase — the shell is a static document with no app markup, so the first
 * client render can never match it, whatever `suppressHydrationWarning` is set on
 * `<html>`/`<body>` (that attribute covers text and attribute drift, not a
 * structural mismatch). React recovers by discarding the shell and client
 * rendering, which is precisely the intent here, and the shell holds nothing worth
 * preserving. The SSR-with-bootstrap path above hydrates cleanly, 0 errors.
 */

//native dev only: recover the live-reload socket when the WebView's OS drops it.
installNativeLiveReloadRecovery()

const serverRendered =
  typeof window !== "undefined" &&
  (window as unknown as { $_TSR?: unknown }).$_TSR != null

//Built at module scope, never inside render: `getRouter()` inside the component
//would construct a new router on every pass and throw the match state away.
const clientRouter = serverRendered ? null : getRouter()

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      {clientRouter ? (
        <RouterProvider router={clientRouter} />
      ) : (
        <StartClient />
      )}
    </StrictMode>,
  )
})
