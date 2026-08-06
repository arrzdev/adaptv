import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/hover-focus")({
  component: LabHoverFocusPage,
})

const TILE =
  "rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle transition-colors"

function LabHoverFocusPage() {
  return (
    <LabPage
      title="hover: and focus"
      subtitle="Two corrections that only show up when they are missing: a hover tint that survives a tap, and a keyboard focus ring that does not exist. The second one is WCAG 2.4.7 Level AA and it has regressed here once already."
    >
      <LabBrief
        what="That hover: never sticks after a touch, never beats a focus ring, and that Tab shows a visible ring on every control while a mouse click shows none."
        steps={[
          "Touch targets only: tap “tap me, then look away” once and lift. It must return to its resting colour immediately — no lingering tint.",
          "Mouse only: hover the same tile. It must tint while the pointer is over it and untint when it leaves.",
          "Press Tab repeatedly through the five controls in the “Tab through these” card. Every one must show a visible outline, and the live readout must say focus-visible: true.",
          "Now CLICK one of those controls with a mouse, or tap it with a finger. It is still focused — the readout proves it — but there must be NO ring.",
          "Focus the “focus beats hover” input with Tab so its ring is up, then move the mouse over it without clicking. The hover tint must NOT appear and the ring must not change colour.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "All five. Tailwind already compiles hover: inside @media (hover: hover); adaptv re-supplies that and adds the :not(:is(:focus, :focus-within)) half. On a desktop mouse every step is observable; steps 1 is a no-op with no touchscreen.",
          },
          pwa: {
            verdict: "works",
            note: "Same rules. An installed PWA on a tablet with an external keyboard is the interesting case: Tab must still ring even though the device is a touch device, and it does — :focus-visible is a UA decision, not a platform stamp.",
          },
          ios: {
            verdict: "works",
            note: "No hover at all — (hover: hover) is false, so the hover rules never compile in. Tapping gives focus without a ring, which is the app feel we want. A Bluetooth keyboard's Tab still rings.",
          },
          android: {
            verdict: "works",
            note: "Same as iOS for touch. Note some Android WebViews report (hover: hover) when a mouse or trackpad is attached; a tint appearing then is correct, not sticky hover.",
          },
        }}
        wrong="A tile stays tinted after you lift your finger (sticky hover — the media query was lost). A control shows no outline at all when you Tab to it (the WCAG regression: the reset went back to bare :focus). A control shows an outline after a plain mouse click (the :not(:focus-visible) half is gone, and every tap in the app will now flash a ring). The hover tint appears on the focused input (hover is out-ranking focus)."
      />

      <LabSection
        title="hover: must not stick after a tap"
        description="On a touch device the browser fabricates a hover state for the tapped element and leaves it there until you touch something else. Tailwind's @media (hover: hover) is what prevents it; adaptv re-supplies that media query because overriding the variant would otherwise DISCARD it."
      >
        <button type="button" className={`${TILE} hover:bg-primary/25`}>
          tap me, then look away
        </button>
        <HoverCapability />
      </LabSection>

      <LabSection
        title="hover: must not beat focus"
        description="adaptv's half of the fix: `&:hover:not(:is(:focus, :focus-within))`. Without it the ring flips grey the moment the mouse passes over a focused control."
      >
        <input
          type="text"
          placeholder="Tab to me, then hover me with the mouse"
          className={`${TILE} w-full hover:bg-error/30`}
        />
        <LabRow
          label="hover tint while focused"
          value="must not appear"
          hint="The tint is deliberately a loud red so a failure is impossible to miss."
        />
      </LabSection>

      <LabSection
        title="Tab through these"
        description="Five different element types, because the reset lists them one by one — input, textarea, select, button, a, [tabindex] — and a missing entry is invisible until someone reaches it with a keyboard."
      >
        <FocusProbe />
        <div className="flex flex-col gap-y-2">
          <input
            type="text"
            placeholder="input"
            className={`${TILE} w-full`}
          />
          <textarea
            rows={2}
            placeholder="textarea"
            className={`${TILE} w-full resize-none`}
          />
          <select className={`${TILE} w-full`} defaultValue="a">
            <option value="a">select — option A</option>
            <option value="b">select — option B</option>
          </select>
          <button type="button" className={TILE}>
            button
          </button>
          <a href="#hover-focus-lab" className={`${TILE} block`}>
            anchor with href
          </a>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the reset lists
              [tabindex] explicitly, so the lab has to reach one */}
          <div tabIndex={0} className={TILE}>
            a plain div with tabIndex={0}
          </div>
        </div>
      </LabSection>

      <LabSection title="The ring itself">
        <LabRow
          label="declaration"
          value=":where(:focus-visible) { outline: 2px solid var(--adaptv-ring, currentColor) }"
        />
        <LabCaveat>
          <code>currentColor</code> on a FILLED control is the label
          colour, so a white-on-brand button gets a white ring that washes
          out against a light page. An app with a brand palette sets{" "}
          <code>--adaptv-ring</code> once on <code>:root</code>. Check the
          resolved value below — if it says <code>currentColor</code>, this
          app has not set one.
        </LabCaveat>
        <RingColour />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/** Does this target have a hover-capable primary pointer at all? */
function HoverCapability() {
  const [caps, setCaps] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    setCaps({
      "(hover: hover)": String(matchMedia("(hover: hover)").matches),
      "(any-hover: hover)": String(
        matchMedia("(any-hover: hover)").matches,
      ),
      "(pointer: coarse)": String(matchMedia("(pointer: coarse)").matches),
    })
  }, [])

  return caps === null ? (
    <p className="text-sm text-muted italic">resolving…</p>
  ) : (
    Object.entries(caps).map(([label, value]) => (
      <LabRow
        key={label}
        label={label}
        value={value}
        hint={
          label === "(hover: hover)"
            ? "false here means no hover rule in the whole app can fire — a tint that appears anyway is the bug."
            : undefined
        }
      />
    ))
  )
}

/**
 * The live focus readout.
 *
 * `:focus-visible` is the UA's own answer to "does this focus deserve an
 * indicator", and there is no other way to read it — which is why the page shows
 * it rather than asking anyone to reason about it. The pair (focused, ring) is
 * the whole contract: `true/true` after Tab, `true/false` after a click.
 */
function FocusProbe() {
  const [state, setState] = useState<{
    label: string
    visible: boolean
  } | null>(null)

  useEffect(() => {
    const read = () => {
      const active = document.activeElement
      if (!active || active === document.body) {
        setState(null)
        return
      }
      const tag = active.tagName.toLowerCase()
      const kind =
        active instanceof HTMLInputElement ? `${tag}[${active.type}]` : tag
      setState({ label: kind, visible: active.matches(":focus-visible") })
    }
    //focusin/focusout bubble, unlike focus/blur — one pair of document
    //listeners covers every control on the page
    document.addEventListener("focusin", read)
    document.addEventListener("focusout", read)
    return () => {
      document.removeEventListener("focusin", read)
      document.removeEventListener("focusout", read)
    }
  }, [])

  return (
    <>
      <LabRow
        label="document.activeElement"
        value={state?.label ?? null}
        hint="`not reported here` means focus is on <body> — nothing is focused."
      />
      <LabRow
        label="matches(':focus-visible')"
        value={
          state === null ? (
            <LabBadge tone="muted">nothing focused</LabBadge>
          ) : (
            <LabBadge tone={state.visible ? "ok" : "muted"}>
              {String(state.visible)}
            </LabBadge>
          )
        }
        hint="true ⇒ a ring must be drawn. false ⇒ there must be none. Those two sentences are the whole test."
      />
    </>
  )
}

function RingColour() {
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    const custom = getComputedStyle(document.documentElement)
      .getPropertyValue("--adaptv-ring")
      .trim()
    setValue(custom === "" ? "unset → currentColor" : custom)
  }, [])

  return <LabRow label="--adaptv-ring" value={value} />
}
