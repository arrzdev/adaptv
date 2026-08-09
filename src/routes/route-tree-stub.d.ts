/**
 * `#adaptv-route-tree`, as seen by the framework's OWN typecheck. Never shipped
 * behaviour, never bundled, never resolved by a consumer.
 *
 * `src/routes/router-entry.tsx` imports the app's generated route tree through the
 * `#adaptv-route-tree` alias. In a real app that alias resolves twice over: adaptv's
 * Vite plugin answers it for the bundler, and the `paths` entry `stamp.ts` writes
 * into the app's tsconfig answers it for TypeScript — pointing at the concrete
 * `.adaptv/routeTree.gen.ts`, so the tree's real type flows into `Register`.
 *
 * Neither exists when adaptv typechecks itself, and the framework genuinely cannot know
 * the shape of an app it has never seen — so `AnyRoute` is the honest answer here. Not
 * `unknown`: `createAdaptvRouter` is generic over the tree (`TRouteTree extends AnyRoute`)
 * precisely so a real app's tree flows into `Register`, and the widest member of that
 * constraint is what "some route tree, shape unknown" means to the router.
 *
 * ## Why a `paths` target rather than an ambient `declare module`
 *
 * An ambient declaration is program-global and takes precedence over `paths` — so
 * the moment one is visible in a CONSUMER's program it shadows the mapping that
 * carries the real type, and typed routing collapses to `AnyRoute` with no error
 * anywhere. That is exactly what a shipped ambient in `virtual-adaptv-router-config.d.ts`
 * used to do. A `paths` mapping only applies to the project that declares it, so this
 * file is inert downstream even though `files: ["src"]` puts it in the tarball: it
 * declares no module, and nothing outside the root tsconfig points at it.
 */
import type { AnyRoute } from "@tanstack/react-router"

export const routeTree: AnyRoute
