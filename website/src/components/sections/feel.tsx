import { Link, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
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
      title="A web view vs adaptv"
      lede="Same markup on both phones. The left is the platform default, the right is adaptv. Try both."
    >
      <Reveal>
        <View className="gap-10">
          <View className="gap-3 sm:flex-row sm:items-center sm:gap-5">
            <View row className="gap-1 self-start rounded-full bg-sunken p-1">
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
            <span className="text-[14px] text-muted">{live.hint}</span>
          </View>

          <live.Demo />

          <View className="grid gap-6 border-border border-t pt-6 sm:grid-cols-2 sm:gap-10">
            <View className="gap-1">
              <span className="font-medium text-[14px] text-danger">
                Without adaptv
              </span>
              <span className="text-[15px] text-subtle">{live.bad}</span>
            </View>
            <View className="gap-1">
              <span className="font-medium text-[14px] text-success">
                With adaptv
              </span>
              <span className="text-[15px]">{live.good}</span>
            </View>
          </View>
        </View>
      </Reveal>

      <View className="gap-6">
        <h3 className="font-semibold text-[22px] tracking-tight">
          Also handled
        </h3>
        <table className="w-full border-collapse text-left">
          <thead className="max-sm:sr-only">
            <tr className="border-border border-b">
              <th className="w-1/2 py-3 pr-8 font-medium text-[14px] text-muted">
                What a web view does
              </th>
              <th className="w-1/2 py-3 font-medium text-[14px] text-muted">
                What adaptv does
              </th>
            </tr>
          </thead>
          <tbody>
            {rest.map((item) => (
              <tr
                key={item.id}
                className="border-border border-b max-sm:flex max-sm:flex-col max-sm:gap-3 max-sm:py-6"
              >
                <td className="align-top sm:py-6 sm:pr-8">
                  <span className="block font-medium text-[15.5px]">
                    {item.title}
                  </span>
                  <span className="mt-1.5 block text-[14.5px] text-muted leading-relaxed">
                    {item.problem}
                  </span>
                </td>
                <td className="align-top sm:py-6">
                  <span className="block font-medium text-[13px] text-muted sm:hidden">
                    What adaptv does
                  </span>
                  <span className="block text-[14.5px] leading-relaxed">
                    {item.fix}
                  </span>
                  <Link
                    to="/docs/$slug"
                    params={{ slug: item.docs[0] }}
                    className="mt-2 inline-block text-[14px] text-brand hover:underline"
                  >
                    {item.docs[1]}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </View>
    </Section>
  )
}
