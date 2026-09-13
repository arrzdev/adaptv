/* =============================================================================
 * PWA / viewport meta (opinionated defaults for TanStack Start apps)
 * ============================================================================= */

const VIEWPORT_BASE =
  "width=device-width,initial-scale=1,viewport-fit=cover"
const VIEWPORT_NO_ZOOM = `${VIEWPORT_BASE},user-scalable=no,minimum-scale=1,maximum-scale=1`

/** Viewport meta content. Zoom is OFF unless `allowZoom` asks for it — `true` is the WCAG 1.4.4 accessible choice. */
function getViewportContent(allowZoom: boolean) {
  return allowZoom ? VIEWPORT_BASE : VIEWPORT_NO_ZOOM
}

const defaultMetaTags = [
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

// Windows tile metadata. ONLY the colour: the tile IMAGE metas this used to emit
// (`msapplication-TileImage`, the square/wide logos, `msapplication-config`) all pointed at
// hardcoded `/favicons/ms-icon-*.png` and `browserconfig.xml` paths that adaptv has never
// generated and most apps have never had — six meta tags of 404 in every document. An app that
// genuinely wants them can pass them through `meta`.
function getMsApplicationMeta(themeColorLight: string) {
  return [
    { name: "msapplication-TileColor", content: themeColorLight },
  ] as const
}

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
  /** Where the manifest is served, deploy base included. */
  manifestPath: string
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
    manifestPath,
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
    //NB: no static `color-scheme` meta — the head init script (theme-init-script.ts)
    //owns it, pinned to the RESOLVED app theme (single value when the app forces
    //light/dark, `light dark` only in "system" mode). A static `light dark` lets the
    //*system* theme drive Chrome's WebAPK bar canvas, which is what tinted the Android
    //standalone-PWA nav/status gutters off the device theme instead of the app theme.
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
    //NB: no built-in favicon links. They used to be a hardcoded twenty-entry list under a
    //hardcoded `/favicons` base — it ignored the `icons` config key entirely, so any app whose
    //icons lived elsewhere shipped a head full of 404s, and even one using the default
    //directory 404'd on every file its favicon generator happened not to emit. The real set is
    //resolved at BUILD time (`headIconLinks` in `src/vite/icon-set.ts`) from the files that
    //exist, and arrives here through `links`. → `docs/decisions/register.md` L8.
    ...extraLinks,
  ]

  return {
    meta,
    links,
  }
}
