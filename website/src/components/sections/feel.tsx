import { View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { Check, X } from "lucide-react"
import { useState } from "react"
import { OverscrollDemo } from "@/components/demos/overscroll-demo"
import { PressDemo } from "@/components/demos/press-demo"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { DIVERGENCES } from "@/content/divergences"

const LIVE = [
  {
    id: "overscroll",
    tab: "Scroll past the end",
    hint: "Scroll each inbox to the bottom, then keep going.",
    bad: "The gesture escapes. This whole page scrolls instead.",
    good: "The list stops. The page behind it stays put.",
    Demo: OverscrollDemo,
  },
  {
    id: "press",
    tab: "Flick through the list",
    hint: "On a phone, flick both lists with your thumb.",
    bad: "Every row your finger lands on flashes.",
    good: "Nothing lights until it is really a press.",
    Demo: PressDemo,
  },
] as const

/** The pitch, as a test the reader runs with their own finger. */
export function Feel() {
  const [active, setActive] = useState(0)
  const live = LIVE[active]
  const rest = DIVERGENCES.filter((item) => !item.demo)

  return (
    <Section
      index="01"
      eyebrow="The difference"
      title={
        <>
          Spot the
          <br />
          web view.
        </>
      }
      lede="Same markup in both phones. The left one is what the platform hands you. The right one is adaptv. Try them."
    >
      <Reveal>
        <View className="overflow-hidden rounded-3xl border border-border bg-surface">
          <View
            row
            className="items-center justify-between gap-4 border-border border-b p-3"
          >
            <View row className="gap-1 rounded-full bg-sunken p-1">
              {LIVE.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(index)}
                  className={cn(
                    "cursor-pointer rounded-full px-4 py-2 font-medium text-[13px] text-subtle transition-colors",
                    index === active &&
                      "bg-foreground text-background shadow-sm",
                  )}
                >
                  {item.tab}
                </button>
              ))}
            </View>
            <span className="hidden pr-3 font-mono text-[11.5px] text-muted sm:block">
              {live.hint}
            </span>
          </View>

          <View className="dots relative px-4 pt-12 pb-10 sm:px-10">
            <live.Demo />
          </View>

          <View className="grid gap-px border-border border-t bg-border sm:grid-cols-2">
            <View row className="items-start gap-3 bg-surface p-6">
              <X
                className="mt-0.5 size-4 shrink-0 text-danger"
                strokeWidth={2.5}
              />
              <span className="text-[15px] text-subtle">{live.bad}</span>
            </View>
            <View row className="items-start gap-3 bg-surface p-6">
              <Check
                className="mt-0.5 size-4 shrink-0 text-success"
                strokeWidth={2.5}
              />
              <span className="text-[15px]">{live.good}</span>
            </View>
          </View>
        </View>
      </Reveal>

      <View className="gap-6">
        <span className="font-mono text-[11.5px] text-muted uppercase tracking-[0.16em]">
          Also handled, before you hit it
        </span>
        <Reveal>
          <View className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((item) => (
              <View key={item.id} className="h-full gap-3 bg-background p-6">
                <View row className="items-center justify-between">
                  <span className="font-medium text-[15.5px]">
                    {item.card[0]}
                  </span>
                </View>
                <p className="text-[14px] text-muted leading-relaxed">
                  {item.card[1]}
                </p>
                <span className="mt-auto pt-2 font-mono text-[11px] text-muted/80">
                  {item.where}
                </span>
              </View>
            ))}
          </View>
        </Reveal>
      </View>
    </Section>
  )
}
