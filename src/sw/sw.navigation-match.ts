export type NavigationRouteMatchOptions = {
  /**
   * Match navigations under a path prefix — `/products` matches `/products` and `/products/123`.
   * Register scoped routes **before** the catch-all route.
   */
  pathPrefix?: string
  /** Match navigations when pathname satisfies the RegExp. */
  pathPattern?: RegExp
  /** Full control — must only return true for navigation requests you own. */
  match?: (url: URL, request: Request) => boolean
}

export function createNavigationRouteMatch(
  options: NavigationRouteMatchOptions = {},
) {
  return function matchesNavigation({
    url,
    request,
  }: {
    url: URL
    request: Request
  }) {
    if (request.mode !== "navigate") return false
    if (options.match) return options.match(url, request)
    if (options.pathPattern) return options.pathPattern.test(url.pathname)
    if (options.pathPrefix) {
      return (
        url.pathname === options.pathPrefix ||
        url.pathname.startsWith(`${options.pathPrefix}/`)
      )
    }
    return true
  }
}
