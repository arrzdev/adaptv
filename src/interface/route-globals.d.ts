import type { CreateFileRoute } from "@arrzdev/adaptv/router"

/**
 * Ambient route factories.
 *
 * These really are globals at type level, and that is not a workaround: a consumer
 * authors a route file with no import at all —
 * `export const Route = createFileRoute("/x")({ … })` — and the route generator
 * writes the concrete `@arrzdev/adaptv/router` import in on its next pass (adaptv
 * redirects the specifier it writes via the `ADAPTV_ROUTER_PKG` patch, so it is
 * never `@tanstack/*`). This ambient declaration is what lets that file typecheck
 * in the meantime, so the "no hand-written import" DX holds in the editor too.
 *
 * Shipped **in the package** rather than generated into the consumer's `.adaptv/`,
 * because there is nothing app-specific about it. A generated copy would be a
 * byte-identical file in every project that exists only because the framework
 * once wrote it there.
 */
declare global {
  const createFileRoute: CreateFileRoute
  const createLazyFileRoute: CreateFileRoute
}

/**
 * Route options adaptv adds.
 *
 * Declared here, next to the ambient factories, for the same reason: it is what
 * makes `createFileRoute("/x")({ chromeTint: "#1e0033" })` typecheck in a route
 * file that imports nothing. It merges into the options every route already
 * takes, so the editor completes it alongside `component` and `loader`.
 */
declare module "@arrzdev/adaptv/router" {
  interface UpdatableRouteOptionsExtensions {
    /**
     * The colour the browser's chrome takes on this route — the toolbar above a
     * mobile web page, and the bands above and below the app in an installed one.
     *
     * ```tsx
     * export const Route = createFileRoute("/settings")({
     *   chromeTint: "#1e0033",
     *   component: Settings,
     * })
     * ```
     *
     * **Must be a literal string.** adaptv reads it out of the source at build
     * time, not off the route at runtime: a cold launch straight onto this route
     * has to paint the colour on the FIRST frame, and by the time the router
     * exists that frame is gone. A computed value would typecheck, run, and do
     * nothing on the one frame it exists for — so the build refuses it instead.
     *
     * **One colour, in both themes.** A route that pins the chrome wants that
     * chrome. A route that should follow the app's theme declares nothing and
     * gets the `themeColor` from `adaptv.config.ts` — never the tint of the
     * layout above it.
     */
    chromeTint?: string
  }
}
