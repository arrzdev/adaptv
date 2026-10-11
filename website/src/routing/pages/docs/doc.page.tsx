import { createFileRoute, notFound } from "adaptv/router"
import { DocsLayout } from "@/components/docs-layout"
import { ALL_DOCS } from "@/content/docs"
import { socialHead } from "@/content/site"

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const page = ALL_DOCS.find((item) => item.slug === params.slug)
    if (!page) throw notFound()
    return { slug: page.slug, title: page.title, summary: page.summary }
  },
  head: ({ loaderData }) =>
    loaderData
      ? socialHead({
          title: loaderData.title,
          tabTitle: `${loaderData.title} — adaptv docs`,
          description: loaderData.summary,
          path: `/docs/${loaderData.slug}`,
        })
      : { meta: [{ title: "Docs — adaptv docs" }] },
  component: DocRoute,
})

function DocRoute() {
  const { slug } = Route.useLoaderData()
  const page = ALL_DOCS.find((item) => item.slug === slug)
  return page ? <DocsLayout page={page} /> : null
}
