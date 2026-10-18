import { ExternalLink, Link, View } from "adaptv/components"
import { ArrowRight, Github } from "lucide-react"
import { DeviceStage } from "@/components/sections/device-stage"
import { GITHUB_URL } from "@/content/site"

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden">
      <div className="grid-lines pointer-events-none absolute inset-0" />
      <View className="sheet @container items-center px-5 pt-20 pb-20 text-center sm:pt-28">
        {/* Geist swaps in late, after the first paint on a slow phone. Every box here keeps its
            size in any font, so the swap moves nothing: the lines are centred inside full-width
            boxes, the buttons are as wide as Geist makes them with their icons pinned to an edge,
            the title is 2 lines tall, and the note under the buttons as tall as its lines in Geist */}
        <h1
          className="rise h-[2lh] w-full max-w-5xl whitespace-nowrap font-semibold text-[clamp(1.5rem,8vw,5.75rem)] leading-[0.98] tracking-[-0.045em]"
          style={{ animationDelay: "60ms" }}
        >
          {/* inline lines: a block span's own box would read as an extra line box. Centred text
              starts at half its width, which the fallback sets a few px off Geist, so each line
              is a box as wide as Geist sets it (in em), text from its left edge */}
          <span className="inline-block w-[7.465em] text-left">
            Write React once
          </span>
          <br />
          <span className="text-gradient inline-block w-[10.226em] text-left">
            Feel native everywhere.
          </span>
        </h1>

        {/* Geist swaps in late and wraps this to 4 lines where the fallback font may take 3 or 5:
            from sm its width is fixed, so it is 4 lines tall in any font and the showcase below stays put.
            Below sm it is as many lines tall as Geist takes at that width (the fallback never takes
            more), read from the hero's content width */}
        <p
          className="rise mt-7 max-w-[38rem] text-balance text-[17px] text-subtle leading-relaxed max-sm:h-[7lh] max-sm:@min-[285px]:h-[6lh] max-sm:@min-[339px]:h-[5lh] max-sm:@min-[413px]:h-[4lh] max-sm:@min-[560px]:h-[3lh] sm:h-[4lh] sm:text-[19px]"
          style={{ animationDelay: "120ms" }}
        >
          adaptv is a React framework: one codebase ships as a web app, an
          installable PWA and native iOS and Android apps. It stops scroll
          chaining and input zoom, and handles safe areas, the keyboard and
          offline.
        </p>

        <View
          row
          className="rise mt-9 w-full flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "180ms" }}
        >
          <Link
            to="/docs/$slug"
            params={{ slug: "quick-start" }}
            className="group flex h-11 w-[153px] flex-row items-center justify-between gap-2 rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
          >
            Get started
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <ExternalLink
            href={GITHUB_URL}
            className="flex h-11 w-[179px] flex-row items-center gap-2 rounded-full border border-border-strong bg-surface/60 px-6 font-medium text-[15px] backdrop-blur hover:bg-sunken"
          >
            <Github className="size-4" />
            Star on GitHub
          </ExternalLink>
        </View>

        <p
          className="rise mt-5 h-[2lh] w-full text-[14px] text-muted @min-[335px]:h-[1lh]"
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
