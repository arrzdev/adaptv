import { ExternalLink, Link, View } from "@arrzdev/adaptv/components"
import { ArrowRight, Github } from "lucide-react"
import { DeviceStage } from "@/components/sections/device-stage"
import { GITHUB_URL } from "@/content/site"

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <View className="sheet items-center px-5 pt-20 pb-20 text-center sm:pt-28">
        <h1
          className="rise max-w-5xl text-balance font-semibold text-[clamp(2.6rem,7.4vw,5.75rem)] leading-[0.98] tracking-[-0.045em]"
          style={{ animationDelay: "60ms" }}
        >
          Write React once.
          <br />
          <span className="text-gradient">Feel native everywhere.</span>
        </h1>

        <p
          className="rise mt-7 max-w-[38rem] text-balance text-[17px] text-subtle leading-relaxed sm:text-[19px]"
          style={{ animationDelay: "120ms" }}
        >
          One React codebase for the browser, the home screen, the App Store and
          Google Play. adaptv stops scroll chaining, tap flashes and input zoom,
          and handles safe areas, the keyboard and offline.
        </p>

        <View
          row
          className="rise mt-9 flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            to="/docs"
            className="group flex h-11 flex-row items-center gap-2 rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
          >
            Get started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <ExternalLink
            href={GITHUB_URL}
            className="flex h-11 flex-row items-center gap-2 rounded-full border border-border-strong bg-surface/60 px-6 font-medium text-[15px] backdrop-blur hover:bg-sunken"
          >
            <Github className="size-4" />
            Star on GitHub
          </ExternalLink>
        </View>

        <p
          className="rise mt-5 text-[14px] text-muted"
          style={{ animationDelay: "180ms" }}
        >
          Open source, MIT. Pre-alpha, so expect rough edges.
        </p>

        <DeviceStage />
      </View>
    </section>
  )
}
