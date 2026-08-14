import { Button } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/press-states")({
  component: LabPressStatesPage,
})

//the identical class string on both controls — the whole demonstration is that
//one line of idiomatic Tailwind has to work on an engine element and on a plain
//<button>, with nothing for the consumer to learn
const PRESS_CLASS =
  "w-full rounded-md bg-secondary px-4 py-6 text-center text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle transition-transform duration-200 ease-out active:scale-95 active:bg-primary/20"

//module scope so the MutationObserver effect below has a stable dependency
const WATCHED = ["data-press-engine", "data-pressed"] as const

function LabPressStatesPage() {
  return (
    <LabPage
      title="active:"
      subtitle="adaptv redefines the built-in active: variant so it reaches the press engine as well as native :active. One class string, two mechanisms, nothing new to learn — which only holds if BOTH branches actually fire."
    >
      <LabBrief
        what="That active:scale-95 animates on an adaptv Button (which is engine-driven and has no native :active at all) and on a plain <button> (which has nothing else), and that neither one sticks."
        steps={[
          "Press and hold the adaptv Button. It must shrink and tint immediately, and stay that way while you hold.",
          "Still holding, drag your finger about 80px off the button — past its 48px press outset — and hold there. The press must drop.",
          "Still holding, drag back onto the button. The press must COME BACK. This is the reentrant behaviour native :active cannot do.",
          "Let go anywhere. The button must return to rest — no lingering scale, no lingering tint.",
          "Repeat 1–4 on the plain <button> below it, then compare the live attribute rows under each.",
          "Tap each one ten times quickly and watch for a stuck state.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Both animate. With a mouse, dragging off the plain button while held releases :active and dragging back re-lights it — Chromium and WebKit both do this for a mouse. The engine button behaves identically, by design.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab. The engine element shows data-press-engine and toggles data-pressed; the plain one shows neither and rides :active.",
          },
          ios: {
            verdict: "partial",
            note: "The engine Button is correct and reentrant. The plain <button> may not light at all: WebKit only applies :active to a touch when the element or an ancestor carries a touch listener, and even then it does not re-light after the finger leaves and returns. That is the platform, and it is the reason the engine exists — not a regression.",
          },
          android: {
            verdict: "works",
            note: "Both animate. Chromium applies :active on touch without a listener, but it still does not re-light on re-entry, so the plain button's step 3 stays dead while the engine button's works.",
          },
        }}
        wrong="The engine Button does not animate at all (the active: → [data-pressed] branch is dead), or the plain <button> stopped animating on desktop (the :active branch was lost — the naive rewrite of the variant), or a control stays scaled/tinted after you let go (the attribute is not being cleared, and every button in the app will eventually look stuck)."
      />

      <LabSection
        title="Engine element — Button"
        description="useGestureEngine marks the node with data-press-engine at mount and writes data-pressed with setAttribute, so a press costs zero React renders. active: compiles to [data-pressed] here and EXCLUDES :active deliberately: native :active cannot be cleared from JS and will not re-light on re-entry."
      >
        <EngineProbe />
      </LabSection>

      <LabSection
        title="Plain <button> — byte-for-byte the old behaviour"
        description="No marker attribute, so the variant's :not([data-press-engine]) branch matches and it falls through to native :active. A wiring mistake degrades to stock Tailwind rather than to nothing."
      >
        <PlainProbe />
      </LabSection>

      <LabSection title="Why this page has no “simulate” button">
        <LabCaveat>
          <code>:active</code> is a UA state, not an attribute — a
          dispatched <code>mousedown</code> does not set it, and nothing in
          script can. So the plain branch can only be proven by a real
          finger or a real mouse button, which is exactly why it lives on a
          manual page. The engine branch could be faked by writing{" "}
          <code>data-pressed</code> by hand, and deliberately is not: a
          fake would pass while the engine that has to write it is broken.
        </LabCaveat>
      </LabSection>

      <LabSection title="The two compiled branches">
        <LabRow
          label="engine"
          value="&[data-pressed]"
          hint="Written by the engine. Reentrant, cancellable, and clearable from JS."
        />
        <LabRow
          label="plain"
          value="&:active:not([data-press-engine])"
          hint="Stock behaviour. The :not() is what keeps the two from both firing on one element."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

//`Button`'s ref is its ButtonHandle (`{ disabled, focus() }`) — deliberately the
//imperative API, not the host node — so this probe cannot reach the element with a
//ref and has to resolve it from the document. `Button` spreads unknown props onto
//the underlying <button>, so an id is enough to find it.
const ENGINE_BUTTON_ID = "lab-press-engine-button"

function EngineProbe() {
  const [attrs, setAttrs] = useState<Record<string, boolean> | null>(null)
  const [presses, setPresses] = useState(0)

  useEffect(() => {
    const node = document.getElementById(ENGINE_BUTTON_ID)
    if (!node) return
    const read = () =>
      setAttrs(
        Object.fromEntries(
          WATCHED.map((name) => [name, node.hasAttribute(name)]),
        ),
      )
    read()
    const observer = new MutationObserver(read)
    observer.observe(node, {
      attributes: true,
      attributeFilter: [...WATCHED],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <Button
        id={ENGINE_BUTTON_ID}
        className={PRESS_CLASS}
        onClick={() => setPresses((n) => n + 1)}
      >
        <Button.Text>hold me, drag off, drag back</Button.Text>
      </Button>
      <LabRow
        label="data-press-engine"
        value={
          attrs === null ? (
            <LabBadge tone="muted">reading…</LabBadge>
          ) : (
            <LabBadge tone={attrs["data-press-engine"] ? "ok" : "bad"}>
              {attrs["data-press-engine"] ? "present" : "MISSING"}
            </LabBadge>
          )
        }
        hint="Set once at mount. If this is missing the element silently falls back to :active and loses reentrancy."
      />
      <LabRow
        label="data-pressed"
        value={
          <LabBadge tone={attrs?.["data-pressed"] ? "ok" : "muted"}>
            {attrs?.["data-pressed"] ? "pressed" : "at rest"}
          </LabBadge>
        }
        hint="Live. Must read `pressed` only while your finger is down AND inside the region, and must return to `at rest` on release — every time."
      />
      <LabRow label="onClick fired" value={presses} />
    </>
  )
}

function PlainProbe() {
  const ref = useRef<HTMLButtonElement>(null)
  const [lastActive, setLastActive] = useState<boolean | null>(null)
  const [clicks, setClicks] = useState(0)

  //`:active` is a pseudo-class, so no MutationObserver can see it. Sampling one
  //frame after pointerdown is the honest read: it answers "did the UA decide this
  //press deserves :active", which on iOS is genuinely sometimes no.
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const sample = () =>
      requestAnimationFrame(() => setLastActive(node.matches(":active")))
    node.addEventListener("pointerdown", sample)
    return () => node.removeEventListener("pointerdown", sample)
  }, [])

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={PRESS_CLASS}
        onClick={() => setClicks((n) => n + 1)}
      >
        a plain &lt;button&gt;, same class string
      </button>
      <LabRow
        label=":active on last press-down"
        value={
          lastActive === null ? (
            <LabBadge tone="muted">not pressed yet</LabBadge>
          ) : (
            <LabBadge tone={lastActive ? "ok" : "warn"}>
              {String(lastActive)}
            </LabBadge>
          )
        }
        hint="false on iOS touch is expected — WebKit gates :active on a touch listener being present. On desktop it must be true."
      />
      <LabRow label="click fired" value={clicks} />
    </>
  )
}
