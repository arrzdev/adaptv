import { createCacheName } from "#nativ/sw/sw.cache-name"
import { serviceWorkerScope } from "#nativ/sw/sw.scope"
import type { WarmRoutesOnInstallOptions } from "#nativ/sw/sw.types"

function createNavigationDocumentRequest(path: string) {
  const sw = serviceWorkerScope()
  return new Request(new URL(path, sw.location.origin).href, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  })
}

async function warmDocument(cache: Cache, path: string) {
  try {
    const request = createNavigationDocumentRequest(path)
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response.clone())
  } catch {
    //install may run offline — non-fatal
  }
}

/** Prefetch HTML documents into the navigation cache during `install`. */
export function createInstallRouteWarmer(
  options: WarmRoutesOnInstallOptions,
) {
  const cacheName = createCacheName(
    options.buildTag,
    options.cacheBucket ?? "pages",
  )

  const paths = new Set(options.routes)

  return async function warmRoutesOnInstall() {
    const cache = await caches.open(cacheName)
    await Promise.all([...paths].map((path) => warmDocument(cache, path)))
  }
}

/** Wire {@link createInstallRouteWarmer} to the service worker `install` event. */
export function registerInstallRouteWarmer(
  options: WarmRoutesOnInstallOptions,
) {
  const sw = serviceWorkerScope()
  const warmRoutesOnInstall = createInstallRouteWarmer(options)

  sw.addEventListener("install", (event: ExtendableEvent) => {
    event.waitUntil(warmRoutesOnInstall())
  })
}
