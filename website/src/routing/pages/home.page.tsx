import { createFileRoute } from "adaptv/router"
import { FinalCta } from "@/components/sections/closing"
import { ComponentsBento } from "@/components/sections/components-bento"
import { FourWays } from "@/components/sections/four-ways"
import { HardParts } from "@/components/sections/hard-parts"
import { Hero } from "@/components/sections/hero"
import { Targets } from "@/components/sections/targets"
import { SitePage } from "@/components/site-page"
import { SITE_DESCRIPTION, SITE_TITLE, socialHead } from "@/content/site"

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () =>
    socialHead({ title: SITE_TITLE, description: SITE_DESCRIPTION, path: "/" }),
})

function HomePage() {
  return (
    <SitePage>
      <Hero />
      <Targets />
      <ComponentsBento />
      <HardParts />
      <FourWays />
      <FinalCta />
    </SitePage>
  )
}
