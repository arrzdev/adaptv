import type { ReactNode } from "react"
import { LabBadge } from "@/components/lab/lab-kit"
import type { LabTarget } from "@/components/lab/lab-target"
import {
  LAB_TARGET_LABEL,
  LAB_TARGETS,
  useLabTarget,
} from "@/components/lab/lab-target"
import { cn } from "@/utils/cn"

/**
 * The block that turns a demo into a test.
 *
 * A manual pass over a page that only says "tap this" produces "seemed fine",
 * which is worth nothing. What makes the pass mean something is the EXPECTED
 * result, written per target, before the finger touches the glass: a
 * `useKeepAwake` that does nothing on iOS is not a bug if the page says so, and
 * it is a bug if the page says it should work.
 *
 * So every brief is forced to answer all four targets — {@link LabExpectations}
 * is a total record, not a partial one. There is no way to quietly leave out the
 * target you did not think about, and "not supported here, and that is correct"
 * is a first-class answer with its own badge rather than an omission.
 */

/** What the tester should SEE on a target — not whether the feature is good. */
export type LabVerdict =
  /** The whole behaviour is present and correct here. */
  | "works"
  /** Present but degraded, approximate, or partly stubbed. Say how. */
  | "partial"
  /** Absent by design. Nothing is broken; the note says why. */
  | "absent"

const VERDICT_LABEL: Record<LabVerdict, string> = {
  works: "works here",
  partial: "partly",
  absent: "not here — correct",
}

const VERDICT_TONE = {
  works: "ok",
  partial: "warn",
  //deliberately NOT "bad": an absence the page predicted is a pass, and painting
  //it red trains the reader to ignore red
  absent: "muted",
} as const

export type LabExpectation = {
  verdict: LabVerdict
  /** What is on screen, concretely. Numbers and attribute names beat adjectives. */
  note: ReactNode
}

/** All four, always. */
export type LabExpectations = Record<LabTarget, LabExpectation>

export type LabBriefProps = {
  /** One line: what behaviour is under test. */
  what: ReactNode
  /**
   * Numbered, concrete, performable without reading the source.
   *
   * Plain strings rather than nodes so each step is its own React key — an
   * instruction list has no natural id, and the index is not one.
   */
  steps: readonly string[]
  expected: LabExpectations
  /** The failure mode, specifically. "The row stops following your finger". */
  wrong: ReactNode
}

export function LabBrief({ what, steps, expected, wrong }: LabBriefProps) {
  const here = useLabTarget()

  return (
    <section className="flex flex-col gap-y-4 rounded-md bg-surface p-4 ring-1 ring-inset ring-border-subtle">
      <div className="flex flex-col gap-y-1">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">
          What this exercises
        </h2>
        <p className="text-sm text-foreground">{what}</p>
      </div>

      <div className="flex flex-col gap-y-1.5">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">
          Steps
        </h2>
        <ol className="flex list-decimal flex-col gap-y-1.5 ps-5 text-sm text-foreground marker:font-mono marker:text-muted">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-y-1.5">
        <h2 className="text-xs font-medium tracking-wide text-subtle uppercase">
          Expected per target
        </h2>
        {LAB_TARGETS.map((target) => (
          <ExpectationRow
            key={target}
            target={target}
            expectation={expected[target]}
            isHere={here === target}
          />
        ))}
      </div>

      <div className="flex flex-col gap-y-1 rounded-md bg-error/10 px-3 py-2">
        <h2 className="text-xs font-medium tracking-wide text-error uppercase">
          How to tell it is wrong
        </h2>
        <p className="text-sm text-foreground">{wrong}</p>
      </div>
    </section>
  )
}

function ExpectationRow({
  target,
  expectation,
  isHere,
}: {
  target: LabTarget
  expectation: LabExpectation
  isHere: boolean
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-y-1 rounded-md px-3 py-2",
        isHere
          ? "bg-secondary ring-1 ring-inset ring-primary/50"
          : "bg-secondary/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LabBadge tone={VERDICT_TONE[expectation.verdict]}>
          {VERDICT_LABEL[expectation.verdict]}
        </LabBadge>
        <span className="text-sm font-medium text-foreground">
          {LAB_TARGET_LABEL[target]}
        </span>
        {isHere && <LabBadge tone="warn">you are here</LabBadge>}
      </div>
      <p className="text-xs text-muted">{expectation.note}</p>
    </div>
  )
}
