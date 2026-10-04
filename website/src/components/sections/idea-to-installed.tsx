import { View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
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
//the file itself, not a copy: the playground's typecheck is what keeps it compiling
import pickerSource from "../../../../playground/apps/frontend/src/components/todos/priority-picker.tsx?raw"

/*
 * Nothing to an installed app, as a tabbed panel. Every panel is a real artefact: CLI
 * output copied from the real CLI as text (re-capture it when the CLI's output changes),
 * never an illustration. Build shows a screen from the playground until the template
 * exists. The Create tab joins when `pnpm create adaptv` exists; the phone recordings
 * join the panels when they are captured.
 */

function TerminalWindow({ children }: { children: ReactNode }) {
  return (
    <View className="selectable min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-code-bg font-mono text-[13px] text-code-fg leading-[1.75] shadow-2xl shadow-black/30">
      <View
        row
        className="items-center gap-1.5 border-white/10 border-b px-4 py-3"
      >
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
      </View>
      {/* long output scrolls inside the window, never the page, and never wraps */}
      <pre className="max-h-[440px] overflow-auto p-5">{children}</pre>
    </View>
  )
}

/**
 * `adaptv dev web --host`, its settled frame with the CLI's own styles: bold magenta
 * name, green tick, dim detail, cyan key. Only the address is swapped for a LAN example
 * and the port for vite's default.
 */
function DevOutput() {
  return (
    <TerminalWindow>
      <span className="text-code-muted">$ </span>adaptv dev web --host{"\n\n  "}
      <span className="font-bold text-[#c08bff]">adaptv</span>
      <span className="text-code-muted">{" · dev web\n\n  "}</span>
      <span className="text-[#4fdca0]">✓</span>
      {" web  "}
      <span className="text-code-muted">{"· 13.2s\n    local    "}</span>
      <span className="text-code-muted">{"http://localhost:5173\n    "}</span>
      <span className="text-code-muted">
        {"network  http://192.168.1.24:5173\n\n  "}
      </span>
      <span className="text-code-muted">device loads from </span>
      <span className="font-bold">{"http://192.168.1.24:5173\n\n  "}</span>
      <span className="font-bold text-[#7fc4f5]">ctrl-c</span>
      <span className="text-code-muted"> stop</span>
    </TerminalWindow>
  )
}

function BuildCode() {
  return (
    <CodePanel
      samples={[
        { label: "priority-picker.tsx", lang: "tsx", code: pickerSource },
      ]}
      className="min-w-0 [&_pre]:max-h-[440px] [&_pre]:overflow-auto"
    />
  )
}

const OUTCOMES = [
  "Fixes reach users without a store review.",
  "Works offline.",
  "Installs from the browser.",
] as const

function ShipOutcomes() {
  return (
    <View className="justify-center gap-5 rounded-2xl border border-border bg-surface p-8 md:p-10">
      {OUTCOMES.map((line) => (
        <View key={line} row className="items-start gap-3.5">
          <Check
            className="mt-1 size-5 shrink-0 text-success"
            strokeWidth={2.5}
          />
          <span className="text-balance font-medium text-[20px] leading-snug tracking-[-0.02em] md:text-[24px]">
            {line}
          </span>
        </View>
      ))}
    </View>
  )
}

type Step = {
  id: string
  label: string
  /** A shorter label for narrow screens, where the four tabs share one row. */
  short?: string
  caption: string
  Panel: () => ReactNode
}

const STEPS: Step[] = [
  {
    id: "build",
    label: "Build",
    caption: "Write plain React and Tailwind. Nothing new to learn.",
    Panel: BuildCode,
  },
  {
    id: "run",
    label: "Run on your phone",
    short: "On your phone",
    caption: "Open the app on a real phone while you edit.",
    Panel: DevOutput,
  },
  {
    id: "ship",
    label: "Ship",
    caption: "Put it in front of users.",
    Panel: ShipOutcomes,
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
            {item.short ? (
              <>
                <span className="md:hidden">{item.short}</span>
                <span className="hidden md:inline">{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </button>
        ))}
      </div>

      <div
        id={`${base}-panel`}
        role="tabpanel"
        aria-labelledby={`${base}-tab-${step.id}`}
        className="grid min-h-[420px] content-start gap-5 md:min-h-[480px]"
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
      lede="Write plain React. Put it on your phone and ship."
    >
      <Reveal>
        <StepTabs />
      </Reveal>
    </Section>
  )
}
