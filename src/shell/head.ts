/* =============================================================================
 * PWA / viewport meta (opinionated defaults for TanStack Start apps)
 * ============================================================================= */

const VIEWPORT_BASE =
  "width=device-width,initial-scale=1,viewport-fit=cover"
const VIEWPORT_NO_ZOOM = `${VIEWPORT_BASE},user-scalable=no,minimum-scale=1,maximum-scale=1`

/** Viewport meta content; zoom is allowed by default (WCAG 1.4.4). */
function getViewportContent(allowZoom: boolean) {
  return allowZoom ? VIEWPORT_BASE : VIEWPORT_NO_ZOOM
}

export const defaultMetaTags = [
  { charSet: "utf-8" as const },
  {
    name: "viewport",
    content: VIEWPORT_BASE,
  },
  {
    name: "apple-mobile-web-app-capable",
    content: "yes",
  },
  {
    name: "apple-mobile-web-app-status-bar-style",
    content: "black-translucent",
  },
  {
    name: "mobile-web-app-capable",
    content: "yes",
  },
] as const

const FAVICON_BASE = "/favicons"

/** Full favicon / touch-icon / PWA icon link set for TanStack Start apps. */
export const defaultFaviconLinks = [
  {
    rel: "shortcut icon",
    href: `${FAVICON_BASE}/favicon.ico`,
    type: "image/x-icon",
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "16x16",
    href: `${FAVICON_BASE}/favicon-16x16.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "32x32",
    href: `${FAVICON_BASE}/favicon-32x32.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "96x96",
    href: `${FAVICON_BASE}/favicon-96x96.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "512x512",
    href: `${FAVICON_BASE}/favicon-512x512.png`,
  },
  {
    rel: "icon",
    href: `${FAVICON_BASE}/favicon-light.svg`,
    type: "image/svg+xml",
    media: "(prefers-color-scheme: light)",
  },
  {
    rel: "icon",
    href: `${FAVICON_BASE}/favicon-dark.svg`,
    type: "image/svg+xml",
    media: "(prefers-color-scheme: dark)",
  },
  {
    rel: "apple-touch-icon",
    sizes: "180x180",
    href: `${FAVICON_BASE}/apple-touch-icon-180.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "152x152",
    href: `${FAVICON_BASE}/apple-icon-152x152.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "144x144",
    href: `${FAVICON_BASE}/apple-icon-144x144.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "120x120",
    href: `${FAVICON_BASE}/apple-icon-120x120.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "114x114",
    href: `${FAVICON_BASE}/apple-icon-114x114.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "76x76",
    href: `${FAVICON_BASE}/apple-icon-76x76.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "72x72",
    href: `${FAVICON_BASE}/apple-icon-72x72.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "60x60",
    href: `${FAVICON_BASE}/apple-icon-60x60.png`,
  },
  {
    rel: "apple-touch-icon",
    sizes: "57x57",
    href: `${FAVICON_BASE}/apple-icon-57x57.png`,
  },
  {
    rel: "apple-touch-icon",
    href: `${FAVICON_BASE}/apple-touch-icon.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "192x192",
    href: `${FAVICON_BASE}/android-chrome-192.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "512x512",
    href: `${FAVICON_BASE}/android-chrome-512.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "144x144",
    href: `${FAVICON_BASE}/android-icon-144x144.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "96x96",
    href: `${FAVICON_BASE}/android-icon-96x96.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "72x72",
    href: `${FAVICON_BASE}/android-icon-72x72.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "48x48",
    href: `${FAVICON_BASE}/android-icon-48x48.png`,
  },
  {
    rel: "icon",
    type: "image/png",
    sizes: "36x36",
    href: `${FAVICON_BASE}/android-icon-36x36.png`,
  },
  {
    rel: "mask-icon",
    href: `${FAVICON_BASE}/pinned-tab.svg`,
    color: "#5bbad5",
  },
] as const

function getMsApplicationMeta(themeColorLight: string) {
  return [
    { name: "msapplication-TileColor", content: themeColorLight },
    {
      name: "msapplication-TileImage",
      content: `${FAVICON_BASE}/ms-icon-144x144.png`,
    },
    {
      name: "msapplication-square70x70logo",
      content: `${FAVICON_BASE}/ms-icon-70x70.png`,
    },
    {
      name: "msapplication-square150x150logo",
      content: `${FAVICON_BASE}/ms-icon-150x150.png`,
    },
    {
      name: "msapplication-wide310x150logo",
      content: `${FAVICON_BASE}/ms-icon-310x310.png`,
    },
    {
      name: "msapplication-square310x310logo",
      content: `${FAVICON_BASE}/ms-icon-310x310.png`,
    },
    {
      name: "msapplication-config",
      content: `${FAVICON_BASE}/browserconfig.xml`,
    },
  ] as const
}

/* =============================================================================
 * TanStack Router `head` payload
 * ============================================================================= */

export type UiOpenGraphConfig = {
  title?: string
  description?: string
  image?: string
  url?: string
  type?: string
}

export type UiTwitterConfig = {
  card?: "summary" | "summary_large_image"
  title?: string
  description?: string
  image?: string
}

export type PwaHeadConfig = {
  title: string
  description?: string
  themeColorLight: string
  manifestPath?: string
  /**
   * Allow pinch-to-zoom. Default `false` — a native-feeling app has a fixed
   * scale (this also suppresses Safari's focus-zoom on sub-16px inputs). Set
   * `true` to restore pinch-zoom, which is the WCAG 1.4.4 accessible choice.
   */
  allowZoom?: boolean
  openGraph?: UiOpenGraphConfig
  twitter?: UiTwitterConfig
  meta?: Array<Record<string, string>>
  links?: Array<Record<string, string>>
}

export function pwaHead(config: PwaHeadConfig) {
  const {
    title,
    description,
    themeColorLight,
    manifestPath = "/manifest.json",
    allowZoom = false,
    openGraph,
    twitter,
    meta: extraMeta = [],
    links: extraLinks = [],
  } = config

  const viewportContent = getViewportContent(allowZoom)

  const meta: Array<Record<string, string>> = [
    ...defaultMetaTags.map((tag) =>
      "name" in tag && tag.name === "viewport"
        ? { ...tag, content: viewportContent }
        : { ...tag },
    ),
    { name: "color-scheme", content: "light dark" },
    ...getMsApplicationMeta(themeColorLight),
    { title },
    ...extraMeta,
  ]

  if (description) meta.push({ name: "description", content: description })

  const ogTitle = openGraph?.title ?? title
  const ogDescription = openGraph?.description ?? description

  if (openGraph) {
    meta.push({ property: "og:title", content: ogTitle })
    if (ogDescription)
      meta.push({ property: "og:description", content: ogDescription })
    if (openGraph.image)
      meta.push({ property: "og:image", content: openGraph.image })
    if (openGraph.url)
      meta.push({ property: "og:url", content: openGraph.url })
    meta.push({
      property: "og:type",
      content: openGraph.type ?? "website",
    })
  }

  if (twitter) {
    meta.push({
      name: "twitter:card",
      content: twitter.card ?? "summary_large_image",
    })
    meta.push({
      name: "twitter:title",
      content: twitter.title ?? ogTitle,
    })
    const twitterDescription = twitter.description ?? ogDescription
    if (twitterDescription)
      meta.push({
        name: "twitter:description",
        content: twitterDescription,
      })
    if (twitter.image ?? openGraph?.image)
      meta.push({
        name: "twitter:image",
        content: twitter.image ?? openGraph?.image ?? "",
      })
  }

  const links: Array<Record<string, string>> = [
    { rel: "manifest", href: manifestPath },
    ...defaultFaviconLinks.map((link) => ({ ...link })),
    ...extraLinks,
  ]

  return {
    meta,
    links,
  }
}
