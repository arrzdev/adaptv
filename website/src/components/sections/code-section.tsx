import { View } from "@arrzdev/adaptv/components"
import { CodePanel } from "@/components/code"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { SHOWCASE_SAMPLES } from "@/content/samples"

const FACTS = [
  [
    "It's React",
    "Components, hooks, your state library. No new language, no second renderer.",
  ],
  [
    "It's CSS",
    "Tailwind works as is. app: and web: variants split installed from browser.",
  ],
  [
    "It's one config",
    "Manifest, icons, splash screens and both native projects come from one file.",
  ],
] as const

function Terminal() {
  return (
    <View className="selectable min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-code-bg font-mono text-[12.5px] text-code-fg leading-[1.75] shadow-2xl shadow-black/30">
      <View
        row
        className="items-center gap-1.5 border-white/10 border-b px-4 py-3"
      >
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
      </View>
      <pre className="overflow-x-auto p-5">
        <span className="text-code-muted">$ </span>adaptv build ios{"\n\n"}
        <span className="text-[#ff7a8e]">✖ ios</span>
        {"  src/routes/checkout.page.tsx:4:9\n\n"}
        <span className="text-code-muted">{"  3 │\n  4 │ "}</span>
        <span className="tok-k">const</span> charge ={" "}
        <span className="tok-f">createServerFn</span>(
        <span className="tok-k">async</span> (cart) {"=> {\n"}
        <span className="text-code-muted">{"    │                "}</span>
        <span className="text-[#ff7a8e]">{"^^^^^^^^^^^^^^\n\n"}</span>
        {"  This needs a server, and the native app has none.\n"}
        {"  It would pass in dev and on your web deploy,\n"}
        {"  then fail on iOS and Android.\n\n"}
        <span className="text-[#4fdca0]">{"  → "}</span>
        {"Call your API over the network, or use a route loader."}
      </pre>
    </View>
  )
}

export function CodeSection() {
  return (
    <Section
      title="Plain React, plain CSS, one config"
      lede="If you can build a React app, you can build the native app. There is no bridge to learn and no native code to write."
    >
      <View className="grid items-start gap-10 lg:grid-cols-[1.5fr_1fr] lg:gap-14">
        <Reveal className="min-w-0">
          <CodePanel samples={SHOWCASE_SAMPLES} />
        </Reveal>
        <View className="min-w-0 lg:pt-2">
          {FACTS.map(([title, line], index) => (
            <Reveal key={title} delay={index * 0.06}>
              <View className="gap-2 border-border py-6 [&:not(:first-child)]:border-t first:pt-0">
                <span className="font-medium text-[18px] tracking-tight">
                  {title}
                </span>
                <span className="text-[15px] text-muted leading-relaxed">
                  {line}
                </span>
              </View>
            </Reveal>
          ))}
        </View>
      </View>

      <Reveal>
        <View className="grid items-center gap-8 overflow-hidden rounded-3xl border border-border bg-surface p-6 md:p-10 lg:grid-cols-[1fr_1.35fr] lg:gap-12">
          <View className="min-w-0 gap-4">
            <span className="font-mono text-[11.5px] text-muted uppercase tracking-[0.16em]">
              Build-time honesty
            </span>
            <h3 className="text-balance font-semibold text-[28px] leading-[1.08] tracking-[-0.03em] md:text-[34px]">
              It fails your build, not your users.
            </h3>
            <p className="text-[15.5px] text-subtle leading-relaxed">
              Server code inside a mobile bundle works in dev and dies on the
              device. adaptv catches it at build time and points at the line.
            </p>
          </View>
          <Terminal />
        </View>
      </Reveal>
    </Section>
  )
}
