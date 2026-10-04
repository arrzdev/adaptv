import { Link, View } from "@arrzdev/adaptv/components"
import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

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
      title="One command per target"
      lede="adaptv generates the Xcode and Gradle projects from your config and rebuilds them when it changes."
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

export function FinalCta() {
  return (
    <section className="sheet ruled relative overflow-hidden">
      <div className="aurora pointer-events-none absolute inset-x-0 -bottom-40 h-80" />
      <View className="relative items-center px-6 py-28 text-center md:py-40">
        <Reveal className="flex flex-col items-center">
          <h2 className="text-balance font-semibold text-[clamp(2.6rem,7vw,5.5rem)] leading-[0.98] tracking-[-0.045em]">
            Start with the quick start
          </h2>
          <p className="mt-7 max-w-md text-[17px] text-subtle leading-relaxed">
            Clone the repository and run the playground on a simulator or your
            phone.
          </p>
          <View row className="mt-9 flex-wrap justify-center gap-3">
            <Link
              to="/docs/$slug"
              params={{ slug: "quick-start" }}
              className="group flex h-11 flex-row items-center gap-2 rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
            >
              Read the quick start
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </View>
        </Reveal>
      </View>
    </section>
  )
}
