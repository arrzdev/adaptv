import { Skeleton } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/skeleton")({
  component: LabSkeletonPage,
})

const TASKS = [
  "Book the dentist",
  "Return the library books",
  "Water the plants",
] as const

/** Three placeholder rows shaped like the todo rows they stand in for. */
const REGION_ROWS = ["a", "b", "c"] as const

function LabSkeletonPage() {
  const [loading, setLoading] = useState(true)

  return (
    <LabPage
      title="Skeleton"
      subtitle="A grey box the size of the thing that has not arrived yet. The claim is that it is silent to a screen reader, still to anyone who asked for stillness, and still visible when the OS throws the colours away."
    >
      <LabBrief
        what="The placeholder block (stamped, aria-hidden, shimmering), the loading swap that renders children with no wrapper once the data is in, and Skeleton.Region — the aria-busy container with one announced status line while it waits."
        steps={[
          "Look at the card mock. Three rows of circle + two lines should shimmer together, in step — one animation, not three drifting ones.",
          "Press “Toggle loading”. The region's placeholder rows must be replaced by the real list at the SAME height: nothing above or below the card may move.",
          "Read the readout while it is loading: loading true, and the region's status text is “Loading tasks” — a screen reader hears that once, and hears none of the grey boxes.",
          "Settings → Accessibility → Motion → Reduce Motion (iOS), or Remove animations (Android), or your desktop OS's equivalent — then come back. The shimmer must be a flat still box and the readout must say reduced-motion true.",
          "Turn on a high-contrast mode (Windows Contrast themes; Increase Contrast on iOS/macOS does NOT count — see the caveat). Every box must still be visible as an outlined rectangle, not vanish into the background.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "All of it. The shimmer is a CSS animation; a desktop OS reduce-motion setting stops it on reload with no JS involved. Forced colours only exist on Windows (Contrast themes) — on macOS the readout says forced-colors false and that is correct.",
          },
          pwa: {
            verdict: "works",
            note: "Identical to the browser tab: nothing here branches on the shell.",
          },
          ios: {
            verdict: "partial",
            note: "Shimmer, region, and Reduce Motion all work — WebKit maps the iOS setting to prefers-reduced-motion live, so the shimmer stops without a reload. Forced colours never match: iOS has no forced-colors mode (Increase Contrast is a different, unrelated query), so the border rule is inert here by design.",
          },
          android: {
            verdict: "partial",
            note: "Shimmer, region, and Remove animations (Accessibility → Colour and motion) all work. Forced colours never match: Android has no forced-colors mode either, so the readout stays false.",
          },
        }}
        wrong="The boxes keep shimmering with Reduce Motion on. The boxes disappear under a high-contrast theme. The list jumps up or down when the toggle swaps placeholders for rows. A screen reader reads three empty boxes instead of one “Loading tasks”, or keeps announcing busy after the data is in."
      />

      <LabSection
        title="1 · The card mock"
        description="Three rows, each an avatar circle and two lines — every shape is the consumer's className, the component adds nothing but the fill and the shimmer."
      >
        <div className="flex flex-col gap-y-4">
          {REGION_ROWS.map((key) => (
            <div key={key} className="flex items-center gap-x-3">
              <Skeleton
                data-testid="skeleton-row"
                className="size-10 shrink-0 rounded-full"
              />
              <div className="flex flex-1 flex-col gap-y-2">
                <Skeleton
                  data-testid="skeleton-row"
                  className="h-4 w-2/3 rounded-md"
                />
                <Skeleton
                  data-testid="skeleton-row"
                  className="h-3 w-1/3 rounded-md"
                />
              </div>
            </div>
          ))}
        </div>
      </LabSection>

      <LabSection
        title="2 · Skeleton.Region — the loading swap"
        description="One aria-busy container around the whole list. Its single visually hidden status line has text only while it loads (the node stays, so the change is what gets announced); the boxes inside are aria-hidden, so a screen reader hears one sentence, not three empty rows."
      >
        <LabActions>
          <LabButton onClick={() => setLoading((v) => !v)}>
            <span data-testid="skeleton-toggle">Toggle loading</span>
          </LabButton>
        </LabActions>
        <Skeleton.Region
          data-testid="skeleton-region"
          loading={loading}
          label="Loading tasks"
          className="flex min-h-40 flex-col gap-y-3 rounded-md bg-secondary p-3"
        >
          {/* the inline swap: loading=false renders the children with NO
              wrapper element, so the loaded line is a plain <p>. h-5 is the
              line box of that text-sm line (20px), not its glyph height: an
              h-4 placeholder grew the region by 4px on the swap */}
          <Skeleton loading={loading} className="h-5 w-40 rounded-md">
            <p className="text-sm text-subtle">
              {TASKS.length} tasks · synced just now
            </p>
          </Skeleton>
          {loading ? (
            <ul className="flex flex-col gap-y-2">
              {REGION_ROWS.map((key) => (
                <li
                  key={key}
                  className="flex h-11 items-center gap-x-3 rounded-md bg-surface px-3"
                >
                  <Skeleton className="size-5 shrink-0 rounded-sm" />
                  <Skeleton className="h-4 w-3/5 rounded-md" />
                </li>
              ))}
            </ul>
          ) : (
            <ul
              data-testid="skeleton-content"
              className="flex flex-col gap-y-2"
            >
              {TASKS.map((task) => (
                <li
                  key={task}
                  className="flex h-11 items-center gap-x-3 rounded-md bg-surface px-3 text-sm text-foreground"
                >
                  <span
                    aria-hidden
                    className="size-5 shrink-0 rounded-sm ring-1 ring-inset ring-border"
                  />
                  {task}
                </li>
              ))}
            </ul>
          )}
        </Skeleton.Region>
      </LabSection>

      <LabSection
        title="3 · Readout"
        description="What the page can see of the OS settings this component answers to, and what the shimmer is doing right now."
      >
        <SkeletonReadout loading={loading} />
        <LabCaveat>
          <code>forced-colors</code> is Windows-only. iOS and macOS{" "}
          <em>Increase Contrast</em> is a different query (
          <code>prefers-contrast: more</code>) that the component does not,
          and should not, act on — the boxes already contrast enough there.
          A <code>false</code> on those targets is not a failure.
        </LabCaveat>
      </LabSection>

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={
            <>
              <LabBadge tone="ok">skeleton</LabBadge>
              <LabBadge tone="ok">skeleton-region</LabBadge>
            </>
          }
          hint="A block and a region are two different elements with two different stamps: style the fill from global CSS with [data-adaptv='skeleton'] { … } and never touch the region."
        />
        <LabRow
          label="aria-hidden"
          value="true on every block"
          hint="A placeholder has nothing to say. The region says it once, through its status line."
        />
        <LabRow
          label="aria-busy"
          value="true on the region only while loading"
          hint="Removed, not set to false, once the children are real — assistive tech treats the two the same, the DOM should not carry a stale attribute."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/**
 * The three facts the device pass reads off the page instead of guessing:
 * whether the region thinks it is loading, and whether the two OS-level media
 * queries the stylesheet answers to are matching right now — plus the computed
 * `animation-name` of the first placeholder, which is the shimmer's own word
 * on whether it is running (`none` under reduce-motion).
 *
 * Read after mount and again whenever either query flips: iOS applies Reduce
 * Motion to a running page without a reload, and the readout must follow it.
 */
function SkeletonReadout({ loading }: { loading: boolean }) {
  const probeRef = useRef<HTMLDivElement>(null)
  const [media, setMedia] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)")
    const forced = matchMedia("(forced-colors: active)")

    const read = () => {
      const block = probeRef.current?.querySelector<HTMLElement>(
        '[data-adaptv="skeleton"]',
      )
      const style = block ? getComputedStyle(block) : null
      setMedia({
        "reduced-motion": String(reduced.matches),
        "forced-colors": String(forced.matches),
        "animation-name": style?.animationName ?? "—",
        "border-top": style
          ? `${style.borderTopWidth} ${style.borderTopStyle}`
          : "—",
      })
    }
    read()
    reduced.addEventListener("change", read)
    forced.addEventListener("change", read)
    return () => {
      reduced.removeEventListener("change", read)
      forced.removeEventListener("change", read)
    }
  }, [])

  return (
    <>
      {/* a block of its own to measure, so the readout never depends on
          which card is currently showing placeholders */}
      <div ref={probeRef} className="flex items-center gap-x-3">
        <Skeleton className="h-4 w-24 rounded-md" />
        <span className="text-xs text-muted">← the probe block</span>
      </div>
      <ul
        data-testid="skeleton-readout"
        className="flex flex-col gap-y-1 font-mono text-sm text-foreground"
      >
        <li>loading: {String(loading)}</li>
        {media === null ? (
          <li className="text-muted italic">resolving…</li>
        ) : (
          Object.entries(media).map(([label, value]) => (
            <li key={label}>
              {label}: {value}
            </li>
          ))
        )}
      </ul>
    </>
  )
}
