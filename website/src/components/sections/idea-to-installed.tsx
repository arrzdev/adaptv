import { View } from "adaptv/components"
import { Check } from "lucide-react"
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useRef,
  useState,
} from "react"
import { CodePanel } from "@/components/code"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { Terminal } from "@/components/terminal"
import buildWeb from "@/content/captures/build-web.ansi?raw"
//raw ANSI recorded by scripts/capture-cli.ts; re-capture when the CLI's output changes
import devWeb from "@/content/captures/dev-web.ansi?raw"
import { cn } from "@/utils/cn"
//the file itself, not a copy: the playground's typecheck is what keeps it compiling
import pickerSource from "../../../../playground/apps/frontend/src/components/todos/priority-picker.tsx?raw"

/*
 * Nothing to an installed app, as a tabbed panel. Every panel is a real artefact: code
 * from the playground, and CLI sessions captured from the real CLI and replayed, never
 * an illustration. Run and Ship show the web target until `dev all` and `build all` are
 * captured on a Mac. The Create tab joins when `pnpm create adaptv` exists.
 */

function DevOutput() {
  return <Terminal command="adaptv dev web --host" capture={devWeb} />
}

/**
 * The lines between `//#region landing` and `//#endregion` in the playground file, the
 * marker lines left out: a short excerpt that reads at a glance and stays the real code.
 */
function excerpt(source: string) {
  const lines = source.split("\n")
  const start = lines.findIndex((line) =>
    line.trim().startsWith("//#region landing"),
  )
  const end = lines.findIndex((line) => line.trim() === "//#endregion")
  return lines.slice(start + 1, end).join("\n")
}

const PICKER_EXCERPT = excerpt(pickerSource)

function WriteCode() {
  return (
    <CodePanel
      samples={[
        { label: "priority-picker.tsx", lang: "tsx", code: PICKER_EXCERPT },
      ]}
      className="min-w-0"
    />
  )
}

const OUTCOMES = [
  "Fixes reach users without a store review.",
  "Works offline.",
  "Installs from the browser.",
] as const

function ShipOutput() {
  return (
    <View className="gap-4">
      <Terminal command="adaptv build web" capture={buildWeb} />
      <ul className="flex flex-col gap-x-6 gap-y-2 text-[14.5px] text-muted md:flex-row md:flex-wrap">
        {OUTCOMES.map((line) => (
          <li key={line} className="flex items-center gap-2">
            <Check className="size-4 shrink-0 text-success" strokeWidth={2.5} />
            {line}
          </li>
        ))}
      </ul>
    </View>
  )
}

type Step = {
  id: string
  label: string
  caption: string
  Panel: () => ReactNode
}

const STEPS: Step[] = [
  {
    id: "write",
    label: "Write",
    caption:
      "Plain React components. Behaviour comes from props, looks from className.",
    Panel: WriteCode,
  },
  {
    id: "run",
    label: "Run",
    caption: "One dev server. Your phone reloads as you edit.",
    Panel: DevOutput,
  },
  {
    id: "ship",
    label: "Ship",
    caption: "One command builds it.",
    Panel: ShipOutput,
  },
]

/**
 * A real tablist: one tab in the tab order, arrows and Home/End move between tabs and
 * select them, and every tab names the panel it controls.
 */
function StepTabs() {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const base = useId()
  const step = STEPS[active] ?? STEPS[0]
  if (!step) return null

  const select = (index: number) => {
    const next = (index + STEPS.length) % STEPS.length
    setActive(next)
    tabs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const move = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: STEPS.length - 1,
    }[event.key]
    if (move === undefined) return
    event.preventDefault()
    select(move)
  }

  return (
    <View className="gap-6">
      <div
        role="tablist"
        aria-label="From idea to installed app"
        onKeyDown={onKeyDown}
        className="-mx-6 flex gap-2 overflow-x-auto px-6 md:mx-0 md:px-0"
      >
        {STEPS.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node
            }}
            id={`${base}-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={index === active}
            aria-controls={`${base}-panel`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={cn(
              "min-h-11 shrink-0 cursor-pointer whitespace-nowrap rounded-full border px-5 font-medium text-[15px] transition-colors duration-200 ease-out",
              index === active
                ? "border-foreground bg-foreground text-background"
                : "border-border-strong text-subtle hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${step.id}`}
        className="grid min-h-[610px] grid-cols-1 content-start gap-5 md:min-h-[590px]"
      >
        {/* the key restarts the crossfade on every switch */}
        <View key={step.id} className="step-in gap-5">
          <p className="text-[16px] text-subtle">{step.caption}</p>
          <step.Panel />
        </View>
      </div>
    </View>
  )
}

export function IdeaToInstalled() {
  return (
    <Section
      title="From idea to installed app"
      lede="Write React, run it on your phone, ship it to the web, iOS and Android."
    >
      <Reveal>
        <StepTabs />
      </Reveal>
    </Section>
  )
}
