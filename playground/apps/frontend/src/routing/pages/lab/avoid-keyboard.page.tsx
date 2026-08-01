import { AvoidKeyboard } from "@arrzdev/adaptv/components"
import { useKeyboard } from "@arrzdev/adaptv/hooks"
import type { RefObject } from "react"
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
import { TextInput } from "@/components/ui"

export const Route = createFileRoute({
  component: LabAvoidKeyboardPage,
})

const FILLER = ["one", "two", "three", "four", "five", "six"] as const

function LabAvoidKeyboardPage() {
  const { isOpen, height } = useKeyboard()
  const [behavior, setBehavior] = useState<"padding" | "margin">("padding")
  const [scrollIntoView, setScrollIntoView] = useState(true)
  const [values, setValues] = useState<Record<string, string>>({})
  const avoidRef = useRef<HTMLDivElement>(null)

  return (
    <LabPage
      title="AvoidKeyboard"
      subtitle="The web counterpart of KeyboardAvoidingView. It reserves room for whatever is at the bottom — the keyboard when it is up, the home-indicator inset when it is not — and never both, because the keyboard already covers the safe area."
    >
      <LabBrief
        what="That focusing a field near the bottom of a scroller lifts it clear of the on-screen keyboard, that the reservation is instant rather than animated, and that it collapses back to the safe-area inset when the keyboard closes."
        steps={[
          "Scroll to the LAST field in the box below and tap it. It must end up above the keyboard with a gap, not underneath it.",
          "Watch the reserved number while the keyboard opens: it must jump straight to the keyboard height with no tween — a keyboard-driven change must never animate, or the field chases a moving target.",
          "Dismiss the keyboard. The reservation must fall back to the safe-area inset (or 0), and the content must not be left with a hole under it.",
          "Switch behavior to “margin” and repeat. Same outcome, reserved on the outside of the box instead of the inside.",
          "Turn scrollIntoView off and focus the last field again: room is still reserved, but nothing scrolls — so the field may stay hidden. That is the prop doing its job.",
          "Rotate to landscape with the keyboard open. The reservation must follow the new, much shorter keyboard.",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "A desktop browser has no on-screen keyboard, so the height stays 0, nothing is ever reserved, and the box behaves like a plain div. Nothing to see, and nothing wrong.",
          },
          pwa: {
            verdict: "partial",
            note: "On a phone this works, from a height inferred out of visualViewport geometry. The inference has to filter out the lies the API tells during the open animation, so a frame of settling is expected; a reservation that is persistently too short is not.",
          },
          ios: {
            verdict: "works",
            note: "An exact height from the OS, and the target the frozen-viewport regime exists for: adaptv suppresses WKWebView's own resize and lifts content itself, so the layout height must not change at all when the keyboard opens.",
          },
          android: {
            verdict: "works",
            note: "An exact height from the OS. Check both keyboard types if you can — a keyboard with a suggestion strip is taller, and the reservation must track the difference.",
          },
        }}
        wrong="The focused field stays behind the keyboard. The reservation animates in, so the field slides around while you are trying to type. The reservation stays up after the keyboard closes, leaving a blank band at the bottom. Or the whole page resizes on iOS instead of only this element moving — that is the frozen viewport failing, and it will make every screen in the app jump."
      />

      <LabSection title="Live state">
        <LabRow
          label="isOpen"
          value={
            <LabBadge tone={isOpen ? "ok" : "muted"}>
              {String(isOpen)}
            </LabBadge>
          }
        />
        <LabRow label="height" value={`${height}px`} />
        <KeyboardStamps />
        <LabActions>
          <LabButton
            onClick={() =>
              setBehavior((b) => (b === "padding" ? "margin" : "padding"))
            }
          >
            behavior: {behavior}
          </LabButton>
          <LabButton onClick={() => setScrollIntoView((on) => !on)}>
            scrollIntoView: {String(scrollIntoView)}
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Six fields in a short scroller"
        description="Only the last one or two are interesting: they are the ones the keyboard would otherwise cover."
      >
        {/* NOT a ScrollView wrapping this, and not this wrapping one: the
            reservation lands on THIS element, so it has to be the scroller —
            padding-bottom outside the scroller shrinks it instead of extending
            its content, and the focused field never clears the keyboard. So the
            scroll classes are spelled out here, the same ones ScrollView emits
            for a vertical scroller. */}
        <AvoidKeyboard
          ref={avoidRef}
          behavior={behavior}
          scrollIntoView={scrollIntoView}
          className="h-72 overflow-x-hidden overflow-y-auto overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom rounded-md bg-secondary p-3"
        >
          <div className="flex flex-col gap-y-3">
            {FILLER.map((slot) => (
              <TextInput
                key={slot}
                value={values[slot] ?? ""}
                onChange={(next) =>
                  setValues((current) => ({ ...current, [slot]: next }))
                }
                placeholder={`field ${slot}`}
                aria-label={`Field ${slot}`}
              />
            ))}
          </div>
        </AvoidKeyboard>
        <ReservedProbe behavior={behavior} nodeRef={avoidRef} />
      </LabSection>

      <LabSection title="Where NOT to use it">
        <LabCaveat>
          Not inside a <code>Drawer</code> — the drawer does its own
          avoidance and the two will fight. And do not give this element{" "}
          <code>pb-safe</code> or a bottom <code>py-safe-offset-*</code>:
          it supplies the bottom safe inset itself, on top of your design
          gap, so doubling up leaves a permanent band. The TOP inset is
          never covered, so keep <code>pt-safe-*</code> where it is.
        </LabCaveat>
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

function KeyboardStamps() {
  const [state, setState] = useState<{
    open: boolean
    variable: string
  } | null>(null)

  useEffect(() => {
    const root = document.documentElement
    const read = () =>
      setState({
        open: root.hasAttribute("data-keyboard-open"),
        variable: getComputedStyle(root)
          .getPropertyValue("--adaptv-keyboard-height")
          .trim(),
      })
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-keyboard-open", "style"],
    })
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <LabRow
        label="html[data-keyboard-open]"
        value={
          state === null ? (
            <LabBadge tone="muted">reading…</LabBadge>
          ) : (
            <LabBadge tone={state.open ? "ok" : "muted"}>
              {state.open ? "present" : "absent"}
            </LabBadge>
          )
        }
        hint="A boolean-presence attribute, so `data-keyboard-open:pb-4` works bare in Tailwind."
      />
      <LabRow
        label="--adaptv-keyboard-height"
        value={state?.variable ?? null}
        hint="Always defined — 0px at rest — so calc(1rem + var(--adaptv-keyboard-height)) never needs a fallback."
      />
    </>
  )
}

/** What the wrapper actually reserved, read off the element itself. */
function ReservedProbe({
  behavior,
  nodeRef,
}: {
  behavior: "padding" | "margin"
  nodeRef: RefObject<HTMLDivElement | null>
}) {
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    const read = () => {
      const style = getComputedStyle(node)
      setValue(
        behavior === "padding" ? style.paddingBottom : style.marginBottom,
      )
    }
    read()
    //the wrapper writes the reservation as an inline style, so the style
    //attribute is the thing that changes when the keyboard moves
    const observer = new MutationObserver(read)
    observer.observe(node, { attributes: true })
    return () => observer.disconnect()
  }, [behavior, nodeRef])

  return (
    <LabRow
      label={`reserved (${behavior}-bottom)`}
      value={value}
      hint="Must equal the keyboard height while it is open, and the bottom safe inset (or the resting gap) while it is closed — never the sum of both."
    />
  )
}
