import { Text } from "@arrzdev/adaptv/components"
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

export const Route = createFileRoute("/_providers/lab/text")({
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
        what="numberOfLines clamping, the selectable opt-in over ui.noSelect, and whether text follows the iOS system text-size setting."
        steps={[
          "Cycle the clamp buttons through 1, 2, 3 and none. The paragraph must grow and shrink by whole lines, always ending in an ellipsis when clamped.",
          "Look at the “padding on the clamped element” card: the bottom line is meant to bleed through, and it is there so you recognise the bug when it happens in real code.",
          "Try to select the two paragraphs in the selection card — long-press on touch, drag on desktop. Compare with the data-adaptv-no-select stamp printed above them.",
          "Read the Dynamic Type card's live font sizes. Only the unsized row can track the OS setting; the text-sm row is meant to stay put.",
          "On iOS only: Settings → Accessibility → Display & Text Size → Larger Text, drag the slider to the far right, come back, and RELOAD the page (pull down, or relaunch the app). The unsized row's px number must change.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Clamp works. Selection works everywhere by default (the noSelect reset is installed-app-only), so both paragraphs select. Dynamic Type does nothing: the @supports (-webkit-touch-callout) gate excludes desktop Safari and every Chromium, and that exclusion is deliberate — on macOS the keyword resolves to a 13px system face and would SHRINK the text.",
          },
          pwa: {
            verdict: "partial",
            note: "Clamp works. Now only the `selectable` paragraph selects — that is the noSelect reset doing its job. Dynamic Type: same as the browser on desktop; on an installed iOS PWA it DOES apply, because that is still WebKit.",
          },
          ios: {
            verdict: "works",
            note: "All three. The unsized font-size reads ~17px at the default setting and climbs to the high 20s/30s at the largest accessibility size — after a reload. Changing the slider with the app open does nothing until then; WebKit resolves -apple-system-body once, at load.",
          },
          android: {
            verdict: "partial",
            note: "Clamp and selection work. Dynamic Type is absent and correct: -webkit-touch-callout is WebKit-only, Blink never shipped it, so the @supports gate is false and the rule never applies. Android's own font-scale setting is not plumbed through here.",
          },
        }}
        wrong="A clamped paragraph shows all its lines, or shows N lines with no ellipsis, or collapses to zero height. Selection behaves the same on both paragraphs in an installed app. On iOS, the unsized font size is identical after a reload with Larger Text cranked to maximum — that means the Dynamic Type rule is not reaching the element, and the rest of the app's unsized text is not either."
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
        title="dynamicType"
        description="Default true. The ONLY channel WebKit exposes for the iOS system text size is the -apple-system-body keyword, and it only works through the font SHORTHAND — so it cannot be a Tailwind class and has to belong to a primitive."
      >
        <DynamicTypeProbe />
        <LabCaveat>
          Two bounds, and both look like breakage if you have not read
          them.
          <strong> One:</strong> an explicit size wins and switches this
          off — <code>utilities</code> is a later cascade layer than{" "}
          <code>adaptv</code>, so <code>text-sm</code> overrides the
          shorthand&apos;s font-size and cuts the link to the setting. That
          is correct precedence; it does mean Dynamic Type reaches UNSIZED
          text only. <strong>Two:</strong> WebKit resolves the keyword at
          page load. Changing the slider while the app is open restyles
          nothing until you reload — nothing CSS can do about it.
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
          label="data-dynamic-type"
          value="present unless dynamicType={false}"
          hint="A presence attribute, so the opt-out REMOVES it. React would stringify a boolean to 'true' and [data-dynamic-type] would still match."
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
 * Two `Text` runs — one with no size class, one with `text-sm` — and their
 * resolved `font-size` read back from the engine. On iOS the first number moves
 * with the system setting after a reload and the second one never does, which is
 * the entire contract stated as two numbers instead of a paragraph.
 */
function DynamicTypeProbe() {
  const unsizedRef = useRef<HTMLSpanElement>(null)
  const sizedRef = useRef<HTMLSpanElement>(null)
  const offRef = useRef<HTMLSpanElement>(null)
  const [sizes, setSizes] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const read = (node: HTMLElement | null) =>
      node ? getComputedStyle(node).fontSize : "—"
    setSizes({
      "unsized, dynamicType (default)": read(unsizedRef.current),
      "className='text-sm' — size wins": read(sizedRef.current),
      "dynamicType={false}": read(offRef.current),
      "@supports (-webkit-touch-callout: none)": String(
        typeof CSS !== "undefined" &&
          CSS.supports("-webkit-touch-callout", "none"),
      ),
    })
  }, [])

  return (
    <>
      <div className="flex flex-col gap-y-2 rounded-md bg-secondary p-3">
        <Text ref={unsizedRef} className="block text-foreground">
          Unsized — this is the one that can follow the OS setting.
        </Text>
        <Text ref={sizedRef} className="block text-sm text-foreground">
          className=&quot;text-sm&quot; — pinned at 14px, on purpose.
        </Text>
        <Text
          ref={offRef}
          dynamicType={false}
          className="block text-foreground"
        >
          dynamicType={"{false}"} — opted out, so unsized but still fixed.
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
