import { createFileRoute } from "@arrzdev/adaptv/router"
import { FinalCta } from "@/components/sections/closing"
import { ComponentsBento } from "@/components/sections/components-bento"
import { Hero } from "@/components/sections/hero"
import { IdeaToInstalled } from "@/components/sections/idea-to-installed"
import { Targets } from "@/components/sections/targets"
import { SitePage } from "@/components/site-page"

export const Route = createFileRoute("/")({
  component: HomePage,
})

function HomePage() {
  return (
    <SitePage>
      <Hero />
      <Targets />
      <ComponentsBento />
      <IdeaToInstalled />
      <FinalCta />
    </SitePage>
  )
}
