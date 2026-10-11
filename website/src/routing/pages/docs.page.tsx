import { createFileRoute } from "adaptv/router"
import { DocsHome } from "@/components/docs-home"
import { DOCS_DESCRIPTION, socialHead } from "@/content/site"

export const Route = createFileRoute("/docs")({
  component: DocsHome,
  head: () =>
    socialHead({
      title: "Documentation",
      description: DOCS_DESCRIPTION,
      path: "/docs",
    }),
})
