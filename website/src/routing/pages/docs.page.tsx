import { createFileRoute } from "adaptv/router"
import { DocsHome } from "@/components/docs-home"

export const Route = createFileRoute("/docs")({
  component: DocsHome,
  head: () => ({ meta: [{ title: "Documentation — adaptv" }] }),
})
