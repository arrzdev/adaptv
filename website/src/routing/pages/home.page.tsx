import { createFileRoute } from "@arrzdev/adaptv/router"
import { Cli, FinalCta, WhenNot } from "@/components/sections/closing"
import { CodeSection } from "@/components/sections/code-section"
import { ComponentsBento } from "@/components/sections/components-bento"
import { Feel } from "@/components/sections/feel"
import { Hero } from "@/components/sections/hero"
import { Platform } from "@/components/sections/platform"
import { Statement } from "@/components/sections/statement"
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
      <Statement />
      <Feel />
      <ComponentsBento />
      <Platform />
      <CodeSection />
      <Cli />
      <WhenNot />
      <FinalCta />
    </SitePage>
  )
}
