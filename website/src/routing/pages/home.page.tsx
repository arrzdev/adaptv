import { createFileRoute } from "adaptv/router"
import { BuiltWith } from "@/components/sections/built-with"
import { FinalCta } from "@/components/sections/closing"
import { ComponentsBento } from "@/components/sections/components-bento"
import { Hero } from "@/components/sections/hero"
import { IdeaToInstalled } from "@/components/sections/idea-to-installed"
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
      <BuiltWith />
      <ComponentsBento />
      <IdeaToInstalled />
      <FinalCta />
    </SitePage>
  )
}
