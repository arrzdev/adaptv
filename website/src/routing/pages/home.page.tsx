import { createFileRoute } from "@arrzdev/adaptv/router"
import { Cli, FinalCta } from "@/components/sections/closing"
import { CodeSection } from "@/components/sections/code-section"
import { ComponentsBento } from "@/components/sections/components-bento"
import { Hero } from "@/components/sections/hero"
import { Platform } from "@/components/sections/platform"
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
      <Platform />
      <CodeSection />
      <Cli />
      <FinalCta />
    </SitePage>
  )
}
