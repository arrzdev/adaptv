import { serviceWorkerScope } from "#nativ/sw/sw.scope"

export type StaticAssetMatchOptions = {
  excludePathPrefixes?: string[]
}

const DEFAULT_EXCLUDE_PREFIXES = ["/api/"] as const

/** Same-origin GET assets: scripts, styles, fonts, images, `/assets/*`. */
export function createStaticAssetMatcher(
  options: StaticAssetMatchOptions = {},
) {
  const excludePrefixes = [
    ...DEFAULT_EXCLUDE_PREFIXES,
    ...(options.excludePathPrefixes ?? []),
  ]

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
      url.pathname.startsWith("/assets/")
    )
  }
}
