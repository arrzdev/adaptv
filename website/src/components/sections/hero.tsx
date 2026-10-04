import { ExternalLink, Link, View } from "@arrzdev/adaptv/components"
import { ArrowRight, Github } from "lucide-react"
import { DeviceStage } from "@/components/sections/device-stage"
import { GITHUB_URL } from "@/content/site"

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <View className="sheet items-center px-5 pt-20 pb-20 text-center sm:pt-28">
        <ExternalLink
          href={GITHUB_URL}
          className="rise flex flex-row items-center gap-2 rounded-full border border-border-strong bg-surface/70 py-1 pr-3 pl-1 text-[12.5px] text-subtle backdrop-blur hover:text-foreground"
        >
          <span className="rounded-full bg-brand px-2 py-0.5 font-medium text-[11px] text-brand-foreground">
            Pre-alpha
          </span>
          Open source, MIT. Follow along on GitHub
          <ArrowRight className="size-3" />
        </ExternalLink>

        <h1
          className="rise mt-7 max-w-5xl text-balance font-semibold text-[clamp(2.6rem,7.4vw,5.75rem)] leading-[0.98] tracking-[-0.045em]"
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
          One codebase for the browser, the home screen, the App Store and
          Google Play. adaptv fixes the hundred small things that make a web app
          feel like a website.
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

        <DeviceStage />
      </View>
    </section>
  )
}
