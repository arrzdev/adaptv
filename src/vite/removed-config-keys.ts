/**
 * Fail loudly on `adaptv.config.ts` keys that adaptv no longer reads.
 *
 * ## Why this exists
 *
 * `defineApp<const T extends AdaptvAppConfig>(config: T): T` infers `T` from the
 * argument, and TypeScript does **not** run its excess-property check when the
 * literal is captured by a generic type parameter. So a key adaptv dropped stays
 * in the config, `tsc --noEmit` says nothing, and the field silently does
 * nothing forever.
 *
 * That is not hypothetical. `providers` used to mount an app-wide provider tree
 * (it was passed as `createRootRoute`'s `shellChildren`). It was removed in
 * favour of a layout route, and a consumer kept the key: their provider tree
 * never mounted, so the bootstrap gate the splash waits on was never set and the
 * splash hung forever — invisible on web (CSS hides it there), a frozen launch
 * screen on native. Nothing anywhere pointed at the config.
 *
 * A runtime guard is the only place this can be caught: the type system
 * structurally cannot, and every one of these keys is *syntactically* fine.
 *
 * ## Scope — deliberately a denylist, not an allowlist
 *
 * This checks only keys we KNOW are dead. An allowlist of every valid key would
 * have to be maintained in lockstep with {@link AdaptvAppConfig} by hand, and
 * the failure mode of drift is a hard error on a *valid* config — much worse
 * than the silence it replaces. `router` is also `& Record<string, unknown>` by
 * design (unknown keys there are forwarded to `createRouter`), so an allowlist
 * is not even expressible for it.
 */

/** A key adaptv used to read, plus what to do instead. */
type RemovedKey = {
  /** Dotted path exactly as it appears in `adaptv.config.ts`. */
  path: string
  /** Actionable migration — this is the whole value of the error. */
  migration: string
}

const REMOVED_KEYS: readonly RemovedKey[] = [
  {
    path: "providers",
    //one line per thought, no leading indentation: the CLI trims every line of a
    //subprocess's output before printing it, so an indented code block arrives
    //flattened and unreadable.
    migration:
      "an app-wide provider tree is a layout route now, not a config field. " +
      "Declare one in your router config and wrap `<Outlet />` — " +
      'layout("providers", "layouts/providers.layout.tsx", [ index("pages/home.tsx") ]). ' +
      "See docs/ARCHITECTURE.md §3.2.",
  },
  {
    path: "router.generatedRouteTree",
    migration:
      "adaptv owns this path — the route tree is a build artifact and always lands in `.adaptv/`. Remove the key.",
  },
  {
    path: "router.virtualRouteConfig",
    migration:
      "renamed to `router.routerConfig` (adaptv always uses the declarative route config, so the name no longer leaks TanStack's `virtual` wording).",
  },
  {
    path: "router.quoteStyle",
    migration:
      "adaptv hardcodes this — it only formats generated files in `.adaptv/`, which nobody opens. Remove the key.",
  },
]

/**
 * Throw if the loaded config still carries a key adaptv stopped reading.
 *
 * Reports **every** offender at once — finding out about the next dead key only
 * after fixing the first is the same slow loop this guard exists to end.
 */
export function assertNoRemovedConfigKeys(config: unknown): void {
  const found = REMOVED_KEYS.filter((removed) =>
    hasPath(config, removed.path),
  )
  if (found.length === 0) return

  const details = found
    .map((removed) => `  • \`${removed.path}\` — ${removed.migration}`)
    .join("\n")

  throw new Error(
    `[adaptv] adaptv.config.ts sets ${found.length} key${
      found.length === 1 ? "" : "s"
    } that adaptv no longer reads. ` +
      `Leaving ${found.length === 1 ? "it" : "them"} in place does nothing at runtime:\n${details}`,
  )
}

/** Is `path` (dotted) present as an own key, with a value that isn't `undefined`? */
function hasPath(config: unknown, path: string): boolean {
  const segments = path.split(".")
  let current: unknown = config
  for (const segment of segments) {
    if (!isRecord(current)) return false
    if (!Object.hasOwn(current, segment)) return false
    current = current[segment]
  }
  //an explicit `undefined` is the same as not setting it — don't cry wolf
  return current !== undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
