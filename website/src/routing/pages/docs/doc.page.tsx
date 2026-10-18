import { createFileRoute, notFound } from "adaptv/router"
import { DocsLayout } from "@/components/docs-layout"
import { ALL_DOCS } from "@/content/docs"
import { articleJsonLd, socialHead } from "@/content/site"

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const page = ALL_DOCS.find((item) => item.slug === params.slug)
    if (!page) throw notFound()
    return {
      slug: page.slug,
      title: page.title,
      seoTitle: page.seoTitle,
      description: page.seoDescription ?? page.summary,
    }
  },
  head: ({ loaderData }) =>
    loaderData
      ? socialHead({
          title: loaderData.title,
          tabTitle: loaderData.seoTitle ?? `${loaderData.title} — adaptv docs`,
          description: loaderData.description,
          path: `/docs/${loaderData.slug}`,
          jsonLd: articleJsonLd({
            title: loaderData.title,
            description: loaderData.description,
            path: `/docs/${loaderData.slug}`,
            section: { name: "Docs", path: "/docs" },
          }),
        })
      : { meta: [{ title: "Docs — adaptv docs" }] },
  component: DocRoute,
})

function DocRoute() {
  const { slug } = Route.useLoaderData()
  const page = ALL_DOCS.find((item) => item.slug === slug)
  return page ? <DocsLayout page={page} /> : null
}
