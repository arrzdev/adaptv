import { Card } from "@/components/card"
import { Section } from "@/components/section"
import { cn } from "@/utils/cn"

/*
 * Where each tool draws the line, in three short rows. Every row comes from the sourced table
 * in docs/research/landscape.md §1. Fair by construction (landing-v4 §2.5): the same size,
 * colour and weight for every column, no checkmarks, no numbers about other projects. Only
 * adaptv's chip is in the brand colour, to say which one is ours.
 */
const ROWS = ["You write", "What draws the UI", "The web"] as const

const TOOLS: { name: string; values: [string, string, string] }[] = [
  {
    name: "adaptv",
    values: [
      "React, HTML and CSS",
      "The browser's DOM; a WebView in the apps",
      "The primary target",
    ],
  },
  {
    name: "Ionic + Capacitor",
    values: [
      "Angular, React or Vue",
      "Web Components in a WebView",
      "A web app",
    ],
  },
  {
    name: "React Native + Expo",
    values: ["React", "Real native views", "Through react-native-web"],
  },
  {
    name: "Flutter",
    values: [
      "Dart",
      "Its own engine, every pixel",
      "Supported; not for text-heavy sites",
    ],
  },
]

export function FourWays() {
  return (
    <Section
      title="Four ways to ship one app"
      lede="Each tool draws the line in a different place. Here is where."
    >
      <Card
        className="md:pb-10"
        visual={
          <ul className="grid w-full grid-cols-1 gap-3 text-left md:grid-cols-4">
            {TOOLS.map(({ name, values }, i) => (
              <li
                key={name}
                className="flex flex-col gap-4 rounded-[var(--radius-tile)] border border-tile-line bg-tile px-5 py-5.5"
              >
                <h3 className="flex items-center gap-2.5 font-semibold text-[17px] tracking-[-0.01em]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-[22px] rounded-[7px]",
                      i === 0 ? "bg-brand" : "bg-border-strong",
                    )}
                  />
                  {name}
                </h3>
                <dl className="flex flex-col gap-3">
                  {ROWS.map((label, row) => (
                    <div key={label}>
                      <dt className="text-[12.5px] text-muted">{label}</dt>
                      <dd className="mt-0.5 text-[15px] leading-[1.4]">
                        {values[row]}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        }
      />
      <p className="mt-4 text-center text-[13px] text-muted">
        adaptv is pre-alpha and not yet on npm.
      </p>
    </Section>
  )
}
