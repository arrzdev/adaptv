import { ExternalLink, Link, View } from "@arrzdev/adaptv/components"
import { ArrowRight, Github } from "lucide-react"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { GITHUB_URL } from "@/content/site"

const COMMANDS = [
  ["adaptv dev web", "Dev server with hot reload, in the browser."],
  ["adaptv dev ios", "Same, live on a simulator or the phone in your hand."],
  ["adaptv build android", "A signed bundle, ready for Google Play."],
  ["adaptv icons logo.png", "Every icon and splash size, for every target."],
  ["adaptv doctor", "Checks your machine and tells you what's missing."],
] as const

export function Cli() {
  return (
    <Section
      index="05"
      eyebrow="Tooling"
      title={
        <>
          One command
          <br />
          per target.
        </>
      }
      lede="No Xcode project to babysit and no Gradle file to edit. The native projects are generated from your config and rebuilt when it changes."
    >
      <Reveal>
        <View className="overflow-hidden rounded-3xl border border-border">
          {COMMANDS.map(([command, line]) => (
            <View
              key={command}
              className="gap-1.5 border-border bg-surface px-6 py-5 sm:flex-row sm:items-center sm:gap-8 [&:not(:first-child)]:border-t"
            >
              <span className="selectable font-mono text-[14px] sm:w-64 sm:shrink-0">
                <span className="text-muted">$ </span>
                {command}
              </span>
              <span className="text-[14.5px] text-muted">{line}</span>
            </View>
          ))}
        </View>
      </Reveal>
    </Section>
  )
}

const NOT_FOR = [
  ["Games and heavy graphics", "You want a native renderer, not a web view."],
  ["Camera or AR pipelines", "Real-time native APIs are the whole product."],
  [
    "A team already shipping great native apps",
    "Keep them. This isn't for you.",
  ],
] as const

export function WhenNot() {
  return (
    <Section
      index="06"
      eyebrow="Honest"
      title={
        <>
          When not
          <br />
          to use it.
        </>
      }
      lede="A web view is the right tool for most apps and the wrong one for a few. Better you hear it from us."
    >
      <Reveal>
        <View className="grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-3">
          {NOT_FOR.map(([title, line]) => (
            <View key={title} className="h-full gap-2 bg-background p-7">
              <span className="font-medium text-[16px] tracking-tight">
                {title}
              </span>
              <span className="text-[14.5px] text-muted leading-relaxed">
                {line}
              </span>
            </View>
          ))}
        </View>
      </Reveal>
    </Section>
  )
}

export function FinalCta() {
  return (
    <section className="sheet ruled relative overflow-hidden">
      <div className="aurora pointer-events-none absolute inset-x-0 -bottom-40 h-80" />
      <View className="relative items-center px-6 py-28 text-center md:py-40">
        <Reveal className="flex flex-col items-center">
          <h2 className="text-balance font-semibold text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.98] tracking-[-0.045em]">
            Build it once.
            <br />
            <span className="text-gradient">Ship it everywhere.</span>
          </h2>
          <p className="mt-7 max-w-md text-[17px] text-subtle leading-relaxed">
            This page is an adaptv app. Add it to your home screen, turn on
            airplane mode, and open it again.
          </p>
          <View row className="mt-9 flex-wrap justify-center gap-3">
            <Link
              to="/docs"
              className="group flex h-11 flex-row items-center gap-2 rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
            >
              Read the docs
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <ExternalLink
              href={GITHUB_URL}
              className="flex h-11 flex-row items-center gap-2 rounded-full border border-border-strong bg-surface/60 px-6 font-medium text-[15px] backdrop-blur hover:bg-sunken"
            >
              <Github className="size-4" />
              View the source
            </ExternalLink>
          </View>
        </Reveal>
      </View>
    </section>
  )
}
