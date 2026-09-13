import { serviceWorkerScope } from "#adaptv/sw/sw.scope"
import { publicPath } from "#adaptv/utils/public-path"

export type StaticAssetMatchOptions = {
  /**
   * The deploy base; `assets/` is resolved under it, and `api/` is declined both
   * under it and at the origin root.
   */
  base: string
  excludePathPrefixes?: string[]
}

/** Same-origin GET assets: scripts, styles, fonts, images, `<base>assets/*`. */
export function createStaticAssetMatcher(
  options: StaticAssetMatchOptions,
) {
  //Both API roots. Navigations to a root `/api/` never reach a worker scoped to
  //`/app/`, but a page under `/app/` can still fetch an image from the origin's
  //API, and that request does come through this worker. At the root the two are
  //one prefix.
  const excludePrefixes = [
    ...new Set(["/api/", publicPath(options.base, "api/")]),
    ...(options.excludePathPrefixes ?? []),
  ]
  const assetsPrefix = publicPath(options.base, "assets/")

  return function matchesStaticAsset(url: URL, request: Request) {
    const sw = serviceWorkerScope()

    if (url.origin !== sw.location.origin) return false
    if (request.method !== "GET") return false
    if (request.mode === "navigate") return false

    if (
      excludePrefixes.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      return false
    }

    const { destination } = request
    return (
      destination === "script" ||
      destination === "style" ||
      destination === "font" ||
      destination === "image" ||
      url.pathname.startsWith(assetsPrefix)
    )
  }
}
