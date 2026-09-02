import { cn } from "@arrzdev/adaptv/utils"
import type { ReactNode } from "react"
import { useSyncExternalStore } from "react"

/**
 * The lab's shared vocabulary.
 *
 * Every page in the lab has the same job: show what a capability does *here*,
 * on this one target, including when the answer is "nothing". So the primitives
 * are built around the degraded case rather than bolting it on — {@link LabRow}
 * renders a missing value as an explicit "not reported here", and
 * {@link LabSupport} paints an unsupported capability red instead of leaving an
 * empty card that reads as a bug in the page.
 */

type Tone = "ok" | "warn" | "bad" | "muted"

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-success/15 text-success",
  warn: "bg-warning/15 text-warning",
  bad: "bg-error/15 text-error",
  muted: "bg-secondary text-subtle",
}

export function LabBadge({
  tone = "muted",
  children,
}: {
  tone?: Tone
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
      )}
    >
      {children}
    </span>
  )
}

export function LabSection({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="ps-1 text-sm font-medium text-subtle">{title}</h2>
      {/*
       * A `div`, not a `p`: the description is a ReactNode and pages put blocks in it
       * — `/lab/image` opens one with a {@link LabActions} row. A `<p>` cannot contain
       * a `<div>`, so the browser closes the paragraph early while React does not,
       * the hydration mismatches, and React regenerates the tree on the client with
       * ten errors in the console for a page that then looks right.
       */}
      {description && (
        <div className="ps-1 text-sm text-muted">{description}</div>
      )}
      <div className="flex flex-col gap-y-3 rounded-md bg-surface p-4">
        {children}
      </div>
    </section>
  )
}

/**
 * A labelled value. Pass `value={null}` for "the platform did not answer" —
 * that renders as its own visible state, which is the whole point of the lab:
 * an empty string and "this target cannot tell you" are different facts.
 */
export function LabRow({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  const missing = value === null || value === undefined || value === ""
  return (
    <div className="flex flex-col gap-y-0.5">
      <div className="flex items-baseline justify-between gap-x-3">
        <span className="shrink-0 text-sm text-subtle">{label}</span>
        {/*
         * `truncate` only for a plain string. It is `overflow: hidden` +
         * `text-overflow: ellipsis`, and the ellipsis is a TEXT affordance — give it
         * a rendered node (a badge with its own background and padding) and the box
         * is simply clipped mid-glyph with no ellipsis at all, which reads as a
         * broken component rather than as elided text. Rich values wrap instead.
         */}
        <span
          className={cn(
            "min-w-0 text-end font-mono text-sm",
            typeof value === "string" || missing
              ? "truncate"
              : "flex flex-wrap justify-end gap-1",
            missing ? "text-muted italic" : "text-foreground",
          )}
        >
          {missing ? "not reported here" : value}
        </span>
      </div>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** The headline verdict for a capability on this target. */
export function LabSupport({
  supported,
  supportedLabel = "Supported here",
  unsupportedLabel = "Not supported here",
  detail,
}: {
  supported: boolean
  supportedLabel?: string
  unsupportedLabel?: string
  detail?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-y-1">
      <div className="flex items-center gap-x-2">
        <LabBadge tone={supported ? "ok" : "bad"}>
          {supported ? supportedLabel : unsupportedLabel}
        </LabBadge>
      </div>
      {detail && <p className="text-xs text-muted">{detail}</p>}
    </div>
  )
}

/**
 * A caveat the return values cannot express — a platform that reports success
 * and then does nothing. Loud on purpose; it is the failure mode the whole
 * capability surface exists to stop hiding.
 */
export function LabCaveat({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
      ⚠︎ {children}
    </p>
  )
}

const NEVER_CHANGES = () => () => {}

/**
 * A browser's answer the page wants to show exactly as the function returns it —
 * `canVibrate()`, `canShare(payload)` — read the way the framework's own hooks read
 * theirs: through `useSyncExternalStore` with a server snapshot, so SSR renders
 * `serverValue` and the client corrects it AFTER hydration rather than during it.
 *
 * Called during render instead, the server (no `navigator`) says `false`, the
 * client says `true`, and React throws a text mismatch and regenerates the page.
 * That surfaced as an intermittent uncaught error on `/lab/hooks` and `/lab/share`
 * — 2 in 108 smoke runs — because a page whose hydration is interrupted by an
 * update is client-rendered without the comparison, and only a page that hydrates
 * cleanly gets caught. The rate is the load; the bug is every load.
 */
export function useClientValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(NEVER_CHANGES, read, () => serverValue)
}

export function LabActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

export function LabButton({
  onClick,
  disabled,
  tone = "default",
  children,
  "data-testid": testId,
}: {
  onClick: () => void
  disabled?: boolean
  tone?: "default" | "danger"
  children: ReactNode
  /** A stable hook for e2e, for a page whose buttons a spec has to press by id. */
  "data-testid"?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "clickable rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors",
        "disabled:opacity-40",
        tone === "danger"
          ? "bg-surface text-error ring-border"
          : "bg-secondary text-foreground ring-border-subtle hover:bg-surface",
      )}
    >
      {children}
    </button>
  )
}

/** Last outcome of an imperative call. `null` = not attempted yet. */
export function LabOutcome({
  outcome,
  okValues,
}: {
  outcome: string | null
  /** Which outcome strings count as a success (everything else is degraded). */
  okValues: string[]
}) {
  if (outcome === null) {
    return <LabBadge tone="muted">not attempted yet</LabBadge>
  }
  return (
    <LabBadge tone={okValues.includes(outcome) ? "ok" : "warn"}>
      {outcome}
    </LabBadge>
  )
}

export type LabLogEntry = { id: number; text: string }

let nextLogId = 0

/**
 * Timestamp an event for {@link LabLog}. Carries its own id so the list has a
 * real key — an append-only log has no natural one, and the index is not it.
 */
export function labLogEntry(text: string): LabLogEntry {
  nextLogId += 1
  return {
    id: nextLogId,
    text: `${new Date().toLocaleTimeString()} \u00b7 ${text}`,
  }
}

/** A scrolling log so a page can show events as they actually arrive. */
export function LabLog({ entries }: { entries: LabLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted italic">no events yet — interact</p>
    )
  }
  return (
    /*
     * `shrink-0` on the rows is load-bearing, not tidiness. In a `flex-col` box with
     * a `max-h`, flex children default to `flex-shrink: 1`, so once the log is longer
     * than 12rem the browser SQUEEZES every row below its line height instead of
     * scrolling — and `truncate` is `overflow: hidden`, so each line renders as a
     * horizontal slice through the middle of its own glyphs. It looks like a font
     * bug and it is a flex bug.
     */
    <ul
      //a stable hook for e2e: the log is how a page reports that a gesture actually
      //committed, and matching on utility classes breaks the moment one is retuned
      data-lab-log=""
      className="flex max-h-48 flex-col gap-y-1 overflow-y-auto font-mono text-xs text-foreground"
    >
      {entries.map((entry) => (
        <li key={entry.id} className="shrink-0 truncate">
          {entry.text}
        </li>
      ))}
    </ul>
  )
}
