import { RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { getRouter } from "#nativ/routes/router-entry"
import { installNativeLiveReloadRecovery } from "#nativ/shell/native-live-reload-client"

/**
 * The SPA client entry. **Framework code, wired as Start's `client.entry` for the
 * `spa` render target only** (the web `ssr` build keeps Start's default entry).
 *
 * ## Why nativ must own this, and why it is NOT `hydrateStart`
 *
 * Start's default client entry is `hydrateStart()`, and it hard-requires a
 * `window.$_TSR` bootstrap object that Start's **server/prerender injects into the
 * HTML**. A nativ `spa` build has no server — the `capacitor` target is a folder of
 * files on the device, and even a web `spa` build is `render: "spa"`, prerender-
 * off (MEASURED: Start emits no shell in this config, `static-host.ts`). So `$_TSR`
 * is never defined, `hydrateStart` throws `Invariant failed`, and every SPA/native
 * build white-screens.
 *
 * A no-server SPA has nothing SSR-rendered to hydrate *from*, so this is the
 * canonical TanStack **Router** (not Start) boot: build the router, mount it. We
 * still `hydrateRoot(document, …)` rather than `createRoot(#root, …)` because
 * nativ's root route renders the whole `<html>` document (`shell-layout.tsx`) — the
 * same shape Start hydrates — so it must mount at the document, not inside a `div`.
 * The generated shell (`app-shell.ts`) provides a `<html><head>…</head><body>` that
 * React reconciles against; `<html>`/`<body>` carry `suppressHydrationWarning`, so
 * the body's boot-scaffold `<div id="root">` is reconciled away without a warning.
 */
const router = getRouter()

//native dev only: recover the live-reload socket when the WebView's OS drops it.
installNativeLiveReloadRecovery()

hydrateRoot(
  document,
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
