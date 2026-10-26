import { createFileRoute } from "adaptv/router"
import { FinalCta } from "@/components/sections/closing"
import { ComponentsBento } from "@/components/sections/components-bento"
import { FourWays } from "@/components/sections/four-ways"
import { HardParts } from "@/components/sections/hard-parts"
import { Hero } from "@/components/sections/hero"
import { Problems } from "@/components/sections/problems"
import { Stats } from "@/components/sections/stats"
import { SitePage } from "@/components/site-page"
import {
  SITE_DESCRIPTION,
  SITE_TITLE,
  socialHead,
  softwareJsonLd,
} from "@/content/site"

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () =>
    socialHead({
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      path: "/",
      jsonLd: [softwareJsonLd()],
    }),
})

function HomePage() {
  return (
    <SitePage>
      <Hero />
      <Problems />
      <Stats />
      <ComponentsBento />
      <HardParts />
      <FourWays />
      <FinalCta />
    </SitePage>
  )
}
