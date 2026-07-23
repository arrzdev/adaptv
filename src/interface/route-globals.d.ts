import type { CreateFileRoute } from "@arrzdev/adaptv/router"

/**
 * Ambient route factories.
 *
 * These really are globals at type level, and that is not a workaround: adaptv
 * sets `verboseFileRoutes: false`, so the generator strips the import from route
 * files and adaptv's Vite plugin supplies the binding at build time. Route files
 * therefore contain no import — which is the entire point of the facade — and
 * TypeScript needs to be told where the name comes from.
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
