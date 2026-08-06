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
