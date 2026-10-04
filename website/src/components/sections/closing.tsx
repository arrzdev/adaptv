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
      title="When not to use adaptv"
      lede="A web view suits most apps. Here are the cases where it does not."
    >
      <Reveal>
        <ul className="max-w-2xl list-disc pl-5 marker:text-muted">
          {NOT_FOR.map(([title, line]) => (
            <li key={title} className="py-1.5 text-[16px] leading-relaxed">
              <span className="font-medium">{title}.</span>{" "}
              <span className="text-subtle">{line}</span>
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  )
}

export function FinalCta() {
  return (
    <Section
      title="Start with the quick start"
      lede="Clone the repository and run the playground on a simulator or your phone."
    >
      <Reveal>
        <Link
          to="/docs/$slug"
          params={{ slug: "quick-start" }}
          className="group flex h-11 flex-row items-center gap-2 self-start rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
        >
          Read the quick start
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </Reveal>
    </Section>
  )
}
