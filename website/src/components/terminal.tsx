import { View } from "@arrzdev/adaptv/components"
import { useReducedMotion } from "@arrzdev/adaptv/hooks"
import { useInView } from "motion/react"
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react"
import { type Frame, parseAnsi, replayFrames } from "@/components/ansi"
import { cn } from "@/utils/cn"

const COLOURS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const

//a capture replays once per page view, not on every tab switch back to it
const played = new Set<string>()

function Lines({ frame }: { frame: Frame }) {
  return frame.map((line, row) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position on the screen
    <span key={row}>
      {line.map((run, index) => {
        const colour = run.fg === null ? null : COLOURS[run.fg % 8]
        const style: CSSProperties | undefined = colour
          ? { color: `var(--term-${colour})` }
          : undefined
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: runs never reorder
            key={index}
            style={style}
            className={cn(run.bold && "font-bold", run.dim && "opacity-60")}
          >
            {run.text}
          </span>
        )
      })}
      {"\n"}
    </span>
  ))
}

/**
 * A terminal window showing a captured CLI session (src/content/captures/*.ansi). On
 * first view it replays the frames once in about 1.5 s and holds the settled one; under
 * reduced motion, and before hydration, it is the settled frame alone. The settled frame
 * always sets the size, so the replay moves nothing around it.
 */
export function Terminal({
  command,
  capture,
}: {
  command: string
  capture: string
}) {
  const frames = useMemo(() => parseAnsi(capture), [capture])
  const replay = useMemo(() => replayFrames(frames), [frames])
  const settled = frames.at(-1) ?? []
  const ref = useRef<HTMLPreElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduced = useReducedMotion()
  const [step, setStep] = useState<number | null>(null)

  useEffect(() => {
    if (!inView || reduced || played.has(capture)) return
    played.add(capture)
    let index = 0
    setStep(0)
    const timer = setInterval(() => {
      index += 1
      if (index >= replay.length) {
        clearInterval(timer)
        setStep(null)
      } else setStep(index)
    }, 1500 / replay.length)
    return () => {
      clearInterval(timer)
      //cut short (a tab switch, or StrictMode's second mount): it has not played yet
      if (index < replay.length) {
        played.delete(capture)
        setStep(null)
      }
    }
  }, [inView, reduced, capture, replay])

  const frame = step === null ? null : replay[step]

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
      <pre ref={ref} className="max-h-[440px] overflow-auto p-5">
        <span className="opacity-60">$ </span>
        {command}
        {"\n"}
        <span className="grid">
          <code className={cn("[grid-area:1/1]", frame && "invisible")}>
            <Lines frame={settled} />
          </code>
          {frame && (
            <code aria-hidden="true" className="[grid-area:1/1]">
              <Lines frame={frame} />
            </code>
          )}
        </span>
      </pre>
    </View>
  )
}
