import { describe, expect, it } from "vitest"
import { pwaHead } from "#adaptv/shell/head"

/**
 * `pwaHead` is the head of every document adaptv renders, and it had no test
 * of its own — its output was only ever asserted through the generated
 * root-route module, as a string. These pin what it emits today, so a change
 * to a fallback chain (`twitter:title` → `og:title` → `title`) is a change
 * this file has to say yes to.
 */
const base = {
  title: "Probe",
  themeColorLight: "#eeeeec",
  manifestPath: "/manifest.json",
}

describe("pwaHead — the fixed part", () => {
  it("emits the app-capable metas, the tile colour, the title and the manifest", () => {
    expect(pwaHead(base)).toEqual({
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content:
            "width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no,minimum-scale=1,maximum-scale=1",
        },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "msapplication-TileColor", content: "#eeeeec" },
        { title: "Probe" },
      ],
      links: [{ rel: "manifest", href: "/manifest.json" }],
    })
  })

  it("emits no color-scheme meta — the pre-paint script owns it", () => {
    //`theme-init-script.ts` pins `color-scheme` to the RESOLVED theme; a static
    //`light dark` here would let the device theme drive Chrome's WebAPK bars
    const names = pwaHead(base).meta.map((tag) => tag.name)
    expect(names).not.toContain("color-scheme")
  })

  it("keeps pinch-zoom only when asked, which is the accessible choice", () => {
    const viewport = (allowZoom: boolean) =>
      pwaHead({ ...base, allowZoom }).meta.find(
        (tag) => tag.name === "viewport",
      )?.content
    expect(viewport(true)).toBe(
      "width=device-width,initial-scale=1,viewport-fit=cover",
    )
    expect(viewport(false)).toContain("user-scalable=no")
  })

  it("links the manifest where the caller says it is", () => {
    expect(
      pwaHead({ ...base, manifestPath: "/app.webmanifest" }).links,
    ).toEqual([{ rel: "manifest", href: "/app.webmanifest" }])
  })

  it("appends the caller's own metas and links after its own", () => {
    const head = pwaHead({
      ...base,
      meta: [{ name: "robots", content: "noindex" }],
      links: [{ rel: "icon", href: "/brand/favicon.png" }],
    })
    expect(head.meta.at(-1)).toEqual({
      name: "robots",
      content: "noindex",
    })
    expect(head.links).toEqual([
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", href: "/brand/favicon.png" },
    ])
  })
})

describe("pwaHead — description, Open Graph and Twitter", () => {
  const social = (config: Parameters<typeof pwaHead>[0]) =>
    pwaHead(config).meta.filter(
      (tag) =>
        "property" in tag ||
        tag.name === "description" ||
        tag.name?.startsWith("twitter:"),
    )

  it("says nothing about a description or a card it was not given", () => {
    expect(social(base)).toEqual([])
  })

  it("emits the description as its own meta, in that position only", () => {
    expect(social({ ...base, description: "d" })).toEqual([
      { name: "description", content: "d" },
    ])
  })

  it("fills Open Graph from the page when the block leaves a field out", () => {
    expect(social({ ...base, description: "d", openGraph: {} })).toEqual([
      { name: "description", content: "d" },
      { property: "og:title", content: "Probe" },
      { property: "og:description", content: "d" },
      { property: "og:type", content: "website" },
    ])
  })

  it("lets an explicit Open Graph field win, and adds image and url", () => {
    expect(
      social({
        ...base,
        openGraph: {
          title: "OG",
          description: "og-d",
          image: "/og.png",
          url: "https://x.test/",
          type: "article",
        },
      }),
    ).toEqual([
      { property: "og:title", content: "OG" },
      { property: "og:description", content: "og-d" },
      { property: "og:image", content: "/og.png" },
      { property: "og:url", content: "https://x.test/" },
      { property: "og:type", content: "article" },
    ])
  })

  it("falls back for the Twitter card through Open Graph, then the page", () => {
    expect(
      social({
        ...base,
        description: "d",
        openGraph: { title: "OG", image: "/og.png" },
        twitter: {},
      }),
    ).toEqual([
      { name: "description", content: "d" },
      { property: "og:title", content: "OG" },
      { property: "og:description", content: "d" },
      { property: "og:image", content: "/og.png" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "OG" },
      { name: "twitter:description", content: "d" },
      { name: "twitter:image", content: "/og.png" },
    ])
  })

  it("emits a Twitter card on its own, without an Open Graph block", () => {
    expect(
      social({
        ...base,
        twitter: { card: "summary", title: "T", image: "/t.png" },
      }),
    ).toEqual([
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "T" },
      { name: "twitter:image", content: "/t.png" },
    ])
  })
})
