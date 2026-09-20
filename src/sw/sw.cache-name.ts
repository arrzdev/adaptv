import { publicPath } from "#adaptv/utils/public-path"

/**
 * The deploy base, as the part of a runtime cache name that says whose it is.
 *
 * Cache Storage belongs to the origin, not to a worker's scope, so two apps on
 * one origin (project sites on `<user>.github.io`) share one list of caches, and
 * each app's activate sweep reads the other's names. Under a subpath base the
 * name therefore starts with the base, and the sweep only matches names that
 * start with its own. At the origin root it is empty, so a root app's names are
 * `static-<tag>` as they have always been, and a name that starts with `/` is
 * never one of its buckets.
 */
export function runtimeCacheScope(base: string): string {
  const scope = publicPath(base, "")
  return scope === "/" ? "" : scope
}

/** Namespaced cache bucket: `{bucket}-{buildTag}`, behind the scope under a subpath. */
export function createCacheName(
  buildTag: string,
  bucket: string,
  base: string,
): string {
  return `${runtimeCacheScope(base)}${bucket}-${buildTag}`
}
