import { createFileRoute } from "adaptv/router"
import { DocsHome } from "@/components/docs-home"
import { socialHead } from "@/content/site"

export const Route = createFileRoute("/docs")({
  component: DocsHome,
  head: () =>
    socialHead({
      title: "Documentation",
      tabTitle: "adaptv docs: React for web, iOS and Android",
      description:
        "Guides and reference for adaptv: run an app, then components, hooks, capabilities, config and the CLI. Alpha, on npm as adaptv.",
      path: "/docs",
    }),
})
