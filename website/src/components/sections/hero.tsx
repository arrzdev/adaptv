import { ExternalLink, Link, View } from "adaptv/components"
import { ArrowRight, Github } from "lucide-react"
import { DeviceStage } from "@/components/sections/device-stage"
import { GITHUB_URL, ONE_COMMAND } from "@/content/site"

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <View className="sheet items-center px-5 pt-20 pb-20 text-center sm:pt-28">
        <h1
          className="rise max-w-5xl whitespace-nowrap font-semibold text-[clamp(1.5rem,8vw,5.75rem)] leading-[0.98] tracking-[-0.045em]"
          style={{ animationDelay: "60ms" }}
        >
          {/* inline lines: a block span's own box would read as an extra line box */}
          Write React once
          <br />
          <span className="text-gradient">Feel native everywhere.</span>
        </h1>

        {/* Geist swaps in late and wraps this to 4 lines where the fallback font may take 3 or 5:
            from sm its width is fixed, so it is 4 lines tall in any font and the showcase below stays put */}
        <p
          className="rise mt-7 max-w-[38rem] text-balance text-[17px] text-subtle leading-relaxed sm:h-[4lh] sm:text-[19px]"
          style={{ animationDelay: "120ms" }}
        >
          adaptv is a React framework: one codebase ships as a web app, an
          installable PWA and native iOS and Android apps. It stops scroll
          chaining and input zoom, and handles safe areas, the keyboard and
          offline.
        </p>

        <View
          row
          className="rise mt-9 flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            to="/docs/$slug"
            params={{ slug: "quick-start" }}
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

        {/* one line from a bare machine to a running app; nowrap keeps it one line, so a
            phone scrolls it sideways */}
        <pre
          className="rise mt-6 max-w-full overflow-x-auto rounded-xl border border-border bg-surface/60 px-4 py-2.5 text-left font-mono text-[13px] text-subtle"
          style={{ animationDelay: "180ms" }}
        >
          <span className="select-none text-muted">$ </span>
          <code>{ONE_COMMAND}</code>
        </pre>

        <p
          className="rise mt-5 text-[14px] text-muted"
          style={{ animationDelay: "180ms" }}
        >
          Open source, MIT. Pre-alpha, so expect rough edges.
        </p>

        {/* when the public sample app ("project zero") exists, the phones link to it */}
        <DeviceStage />
      </View>
    </section>
  )
}
