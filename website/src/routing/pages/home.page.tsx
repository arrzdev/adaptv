import { createFileRoute } from "@arrzdev/adaptv/router"
import { Adapts } from "@/components/sections/adapts"
import { FinalCta, WhenNot } from "@/components/sections/closing"
import { ComponentsBento } from "@/components/sections/components-bento"
import { Feel } from "@/components/sections/feel"
import { Hero } from "@/components/sections/hero"
import { IdeaToInstalled } from "@/components/sections/idea-to-installed"
import { NativeFeatures } from "@/components/sections/native-features"
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
      <Adapts />
      <NativeFeatures />
      <IdeaToInstalled />
      <WhenNot />
      <FinalCta />
    </SitePage>
  )
}
