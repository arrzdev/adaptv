import { Text } from "@arrzdev/adaptv/components"
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

export const Route = createFileRoute({
  component: LabTextPage,
})

const CLAMPS = [0, 1, 2, 3] as const

const BODY =
  "A run of text long enough to wrap several times on a phone, which is the only way a line clamp proves anything. The standard line-clamp property is still not shippable in either target webview, so adaptv writes the deprecated WebKit triad — display:-webkit-box, -webkit-box-orient:vertical, -webkit-line-clamp:N — plus the overflow:hidden everybody forgets, as an inline style. It is inline because the class could not exist: Tailwind discovers utilities by scanning source text, and a template literal is never a literal token."

function LabTextPage() {
  const [clamp, setClamp] = useState<number>(2)

  return (
    <LabPage
      title="Text"
      subtitle="A run of text with the three platform quirks a <p> does not get: the line clamp, per-instance selection over the app-wide reset, and iOS Dynamic Type."
    >
      <LabBrief
        what="numberOfLines clamping, the selectable opt-in over ui.noSelect, and scaleWithSystem — the opt-in that multiplies a Text's built size by the iOS system text-size factor."
        steps={[
          "Cycle the clamp buttons through 1, 2, 3 and none. The paragraph must grow and shrink by whole lines, always ending in an ellipsis when clamped.",
          "Look at the “padding on the clamped element” card: the bottom line is meant to bleed through, and it is there so you recognise the bug when it happens in real code.",
          "Try to select the two paragraphs in the selection card — long-press on touch, drag on desktop. Compare with the data-adaptv-no-select stamp printed above them.",
          "Read the scaleWithSystem card's live font sizes. Both rows are text-lg; the opted-in row is the built size × the measured factor, the plain row is the built size flat. Off iOS the factor is 1, so the two match.",
          "On iOS only: Settings → Accessibility → Display & Text Size → Larger Text, drag the slider to the far right, come back, and RELOAD the page (pull down, or relaunch the app). The opted-in row's px must grow while the plain row holds, and the factor must climb above 1.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Clamp works. Selection works everywhere by default (the noSelect reset is installed-app-only), so both paragraphs select. scaleWithSystem is a no-op: the -webkit-touch-callout gate excludes desktop Safari and every Chromium, so the measured factor is 1 and the opted-in row renders at exactly its text-lg size — deliberately, since off iOS -apple-system-body would resolve to a 13px system face.",
          },
          pwa: {
            verdict: "partial",
            note: "Clamp works. Now only the `selectable` paragraph selects — that is the noSelect reset doing its job. scaleWithSystem: same no-op as the browser on desktop; on an installed iOS PWA it DOES multiply, because that is still WebKit.",
          },
          ios: {
            verdict: "works",
            note: "All three. The plain text-lg row holds at its built size; the scaleWithSystem row is that size × the factor, ~1 at the default setting and climbing past it at the larger accessibility sizes — after a reload. Changing the slider with the app open does nothing until then; WebKit resolves -apple-system-body once, at load.",
          },
          android: {
            verdict: "partial",
            note: "Clamp and selection work. scaleWithSystem is absent and correct: -webkit-touch-callout is WebKit-only, Blink never shipped it, so the factor is 1 and nothing is scaled. Android's own font-scale setting is not plumbed through here.",
          },
        }}
        wrong="A clamped paragraph shows all its lines, or shows N lines with no ellipsis, or collapses to zero height. Selection behaves the same on both paragraphs in an installed app. On iOS, the scaleWithSystem row's font size is identical to the plain row after a reload with Larger Text cranked to maximum — that means the factor is not reaching the element. Off iOS, the opted-in row is anything other than its plain text-lg size — that means it is being scaled when the factor should be 1."
      />

      <LabSection
        title="numberOfLines"
        description="RN's prop name, an inline style underneath. 0 or omitted means no clamp."
      >
        <LabActions>
          {CLAMPS.map((value) => (
            <LabButton key={value} onClick={() => setClamp(value)}>
              {value === 0
                ? "none"
                : `${value} line${value > 1 ? "s" : ""}`}
            </LabButton>
          ))}
        </LabActions>
        <div className="rounded-md bg-secondary p-3">
          <Text
            numberOfLines={clamp}
            className="text-sm text-foreground"
            render={<p />}
          >
            {BODY}
          </Text>
        </div>
        <LabRow
          label="numberOfLines"
          value={clamp === 0 ? "0 (no clamp)" : String(clamp)}
        />
      </LabSection>

      <LabSection
        title="⚠︎ Padding on the clamped element"
        description="The documented footgun, shown rather than described: overflow clips at the PADDING box, so the line that was supposed to disappear stays visible inside pb-6. Put vertical padding on a wrapper."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md bg-error/10">
            <Text
              numberOfLines={2}
              className="block px-3 pt-3 pb-6 text-sm text-foreground"
              render={<p />}
            >
              {BODY}
            </Text>
            <p className="px-3 pb-2 text-xs text-error">
              wrong — padding on the clamped element
            </p>
          </div>
          <div className="rounded-md bg-success/10 px-3 pt-3 pb-6">
            <Text
              numberOfLines={2}
              className="block text-sm text-foreground"
              render={<p />}
            >
              {BODY}
            </Text>
            <p className="pt-2 text-xs text-success">
              right — padding on the wrapper
            </p>
          </div>
        </div>
      </LabSection>

      <LabSection
        title="selectable"
        description="Drives the same `selectable` utility a consumer would write by hand — not a second mechanism. It wins over the app-wide reset on cascade layer order alone, with no !important anywhere."
      >
        <NoSelectStamp />
        <Text className="block text-sm text-foreground" render={<p />}>
          Plain Text. In a browser tab this selects, because the noSelect
          reset is installed-app-only by default. In an installed PWA or a
          native build it must not.
        </Text>
        <Text
          selectable
          className="block text-sm text-subtle"
          render={<p />}
        >
          selectable Text. This one must select on every target, including
          the ones where the reset is stamped.
        </Text>
      </LabSection>

      <LabSection
        title="scaleWithSystem"
        description="Opt-in, default false. MULTIPLIES a Text's built font-size (and line-height) by the iOS Dynamic Type factor, measured once at load from the -apple-system-body keyword — so text-4xl stays text-4xl × factor instead of being replaced by a system body face."
      >
        <ScaleWithSystemProbe />
        <LabCaveat>
          Two things that look like breakage until you read them.
          <strong> One:</strong> it MULTIPLIES, it never replaces — every
          sized class keeps its proportions, so a heading and its caption
          grow together and nothing overlaps. Off iOS the factor is{" "}
          <code>1</code>, so an opted-in <code>Text</code> renders at
          exactly its className size with zero inline sizing — the reason
          it is safe to leave on. <strong>Two:</strong> the factor is
          iOS-WebKit only and measured once at page load. Changing the
          slider while the app is open scales nothing until you reload —
          nothing JS can do about it.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="render — a prop, not asChild"
        description="Element-only, unlike Pressable's: Text publishes no state to branch on, so the function form would earn nothing. Default is a <span>, so nesting one Text in another stays valid markup."
      >
        {/* biome-ignore lint/a11y/useHeadingContent: the heading's children
            are supplied by Text through cloneElement, which the rule cannot
            see — that indirection is the whole point of `render` */}
        <Text render={<h3 className="text-lg font-semibold" />}>
          render={"{"}&lt;h3 /&gt;{"}"} — still a Text
        </Text>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: same — htmlFor points
            at the field below, and the label text arrives via Text */}
        <Text render={<label htmlFor="lab-text-field" />}>
          render={"{"}&lt;label /&gt;{"}"} — a real label
        </Text>
        <input
          id="lab-text-field"
          type="text"
          placeholder="tapping the label above must focus this"
          className="w-full rounded-md bg-secondary px-3 py-2 text-sm text-foreground"
        />
      </LabSection>

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={<LabBadge tone="ok">text</LabBadge>}
          hint="Target every run of text from global CSS with no imports: [data-adaptv='text'] { … }"
        />
        <LabRow
          label="data-scale-with-system"
          value="present only when scaleWithSystem"
          hint="A presence marker (the sizing itself is done in JS): opt-in, so it is ABSENT by default and the opt-in ADDS it. React would stringify a boolean to 'true', so it is set to '' not true."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/** Grounds the selection card: the reset either applies here or it does not. */
function NoSelectStamp() {
  const [stamped, setStamped] = useState<boolean | null>(null)

  useEffect(() => {
    setStamped(
      document.documentElement.hasAttribute("data-adaptv-no-select"),
    )
  }, [])

  return (
    <LabRow
      label="data-adaptv-no-select"
      value={
        stamped === null ? (
          <LabBadge tone="muted">reading…</LabBadge>
        ) : (
          <LabBadge tone={stamped ? "ok" : "muted"}>
            {stamped ? "stamped" : "absent"}
          </LabBadge>
        )
      }
      hint="ui.noSelect × platform, resolved once by the pre-paint init script. Stamped ⇒ only the selectable paragraph below may select."
    />
  )
}

/**
 * The measurement, on the page.
 *
 * Two `Text` runs at the SAME `text-lg` built size — one plain, one `scaleWithSystem` —
 * and their resolved `font-size` read back from the engine. Because the built size is
 * identical, the opted-in size ÷ the plain size IS the factor Text multiplied by: `1`
 * off iOS (the two numbers match), climbing past `1` on iOS after a reload with Larger
 * Text on. That is the whole multiply contract stated as three numbers, not a paragraph.
 */
function ScaleWithSystemProbe() {
  const plainRef = useRef<HTMLSpanElement>(null)
  const scaledRef = useRef<HTMLSpanElement>(null)
  const [sizes, setSizes] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const read = (node: HTMLElement | null) =>
      node
        ? Number.parseFloat(getComputedStyle(node).fontSize)
        : Number.NaN
    const plain = read(plainRef.current)
    const scaled = read(scaledRef.current)
    const factor = plain > 0 ? scaled / plain : Number.NaN
    setSizes({
      "plain text-lg — the built size, flat": `${plain}px`,
      "scaleWithSystem text-lg — built × factor": `${scaled}px`,
      "measured factor (scaled ÷ built)": Number.isNaN(factor)
        ? "—"
        : `${factor.toFixed(2)}×`,
      "@supports (-webkit-touch-callout: none)": String(
        typeof CSS !== "undefined" &&
          CSS.supports("-webkit-touch-callout", "none"),
      ),
    })
  }, [])

  return (
    <>
      <div className="flex flex-col gap-y-2 rounded-md bg-secondary p-3">
        <Text ref={plainRef} className="block text-lg text-foreground">
          Plain text-lg — always its built size, on every target.
        </Text>
        <Text
          ref={scaledRef}
          scaleWithSystem
          className="block text-lg text-subtle"
        >
          scaleWithSystem text-lg — the same size × the iOS factor.
        </Text>
      </div>
      {sizes === null ? (
        <p className="text-sm text-muted italic">measuring…</p>
      ) : (
        Object.entries(sizes).map(([label, value]) => (
          <LabRow key={label} label={label} value={value} />
        ))
      )}
    </>
  )
}
