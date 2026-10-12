//One place for the facts the pages repeat. `GITHUB_URL` is the repo as it is today;
//it becomes the public address when the project is opened.
export const GITHUB_URL = "https://github.com/arrzdev/adaptv"

//The production address (wrangler.toml's custom domain). Social cards and canonical
//links must be absolute, and a crawler never sees the preview host, so it is fixed.
export const SITE_URL = "https://adaptv.tudu.dev"

//The same two strings as `title` and `description` in adaptv.config.ts, which the root
//route writes on every page; the landing repeats them in its social card.
export const SITE_TITLE = "adaptv: one React codebase for web, iOS and Android"
export const SITE_DESCRIPTION =
  "adaptv is a React framework that ships one codebase as a web app, an installed PWA and native iOS and Android apps. Open source, pre-alpha."

//The docs home's lede, and its description
export const DOCS_DESCRIPTION =
  "adaptv is a React framework that ships one codebase to the web, the home screen, the App Store and Google Play. Start with a guide, or go straight to the reference."

/**
 * The tags a shared link turns into a card on X, Bluesky, LinkedIn or Discord, plus the
 * canonical link. Crawlers do not run JS: these work because the site is prerendered.
 */
export function socialHead({
  title,
  description,
  path,
  published,
  tabTitle,
  links = [],
}: {
  /** The tab title is `title — adaptv`; the card shows `title` alone. */
  title: string
  /** A tab title other than `title — adaptv` (the docs say `— adaptv docs`). */
  tabTitle?: string
  description: string
  /** The page's path, from the root: `/blog/the-loupe`. */
  path: string
  /** A post's date (YYYY-MM-DD): the card becomes an article. */
  published?: string
  /** More `<link>` tags: the blog's RSS feed. */
  links?: Record<string, string>[]
}) {
  const url = `${SITE_URL}${path}`
  return {
    meta: [
      {
        title: tabTitle ?? (title === SITE_TITLE ? title : `${title} — adaptv`),
      },
      { name: "description", content: description },
      { property: "og:site_name", content: "adaptv" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: published ? "article" : "website" },
      { property: "og:url", content: url },
      { property: "og:image", content: `${SITE_URL}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: SITE_TITLE },
      ...(published
        ? [{ property: "article:published_time", content: published }]
        : []),
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: url }, ...links],
  }
}
