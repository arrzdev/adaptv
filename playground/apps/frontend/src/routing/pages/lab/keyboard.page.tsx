import { hasNativeKeyboard } from "@arrzdev/adaptv/capabilities"
import {
  dismissVirtualKeyboard,
  getVirtualKeyboardApi,
  isSecureContext,
  useKeyboard,
  willOpenVirtualKeyboard,
} from "@arrzdev/adaptv/hooks"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { TextInput } from "@/components/ui"

export const Route = createFileRoute({
  component: LabKeyboardPage,
})

function LabKeyboardPage() {
  const { isOpen, height } = useKeyboard()
  const [draft, setDraft] = useState("")
  const [probes, setProbes] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    setProbes({
      "hasNativeKeyboard()": String(hasNativeKeyboard()),
      "isSecureContext()": String(isSecureContext()),
      "VirtualKeyboard API": getVirtualKeyboardApi()
        ? "present"
        : "absent",
      "willOpenVirtualKeyboard(<input>)": String(
        willOpenVirtualKeyboard(document.createElement("input")),
      ),
      "willOpenVirtualKeyboard(<input type=checkbox>)": String(
        willOpenVirtualKeyboard(checkbox),
      ),
    })
  }, [])

  return (
    <LabPage
      title="Keyboard"
      subtitle="The biggest divergence between targets. Native reports an exact height from the OS; web infers one from visualViewport and has to filter out its lies."
    >
      <LabBrief
        what="The live keyboard height and the two contracts built on it — the --adaptv-keyboard-height custom property and the data-keyboard-open presence attribute on <html>."
        steps={[
          "Focus the field. isOpen must go true and the height must become a real number within a frame or two.",
          "Watch the two <html> rows: data-keyboard-open must appear, and --adaptv-keyboard-height must equal the height above.",
          "Dismiss with the keyboard's OWN key (Done / the down-chevron). Both must return to closed and 0px.",
          "Focus again and dismiss with the dismissVirtualKeyboard() button instead. Same result.",
          "On iOS: focus the field and trigger password autofill. iOS dismisses the keyboard WITHOUT blurring, which is the case the web path needs a dismiss confirmation for — the state must still go closed.",
          "Rotate to landscape with the keyboard open. The height must change to the landscape keyboard's, live.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Desktop: height stays 0, data-keyboard-open never appears, and that is correct. Mobile browser: an inferred height from visualViewport geometry, which lags the animation and has to have its lies filtered out.",
          },
          pwa: {
            verdict: "partial",
            note: "Same inference on a phone. This is the target where a wrong height is most visible, because there is no browser chrome to hide behind.",
          },
          ios: {
            verdict: "works",
            note: "An exact height from the OS, no inference. adaptv suppresses WKWebView's own resize and lifts content itself — so the LAYOUT height must not change when the keyboard opens.",
          },
          android: {
            verdict: "works",
            note: "An exact height from the OS. Two keyboards worth checking: one with a suggestion strip and one without, since they differ by 40-50px.",
          },
        }}
        wrong="The height stays 0 while a keyboard is visibly up. data-keyboard-open sticks after the keyboard closes, so every data-keyboard-open: style in the app stays on. Or the variable and the hook disagree — they are one value published two ways, and a mismatch means something is writing the property by hand."
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
      </LabSection>

      <LabSection
        title="The two CSS contracts"
        description="Everything outside React reacts through these: a custom property with a resting value that is always defined, and a boolean-presence attribute on <html>. Both are published by useKeyboard and both must agree with the numbers above."
      >
        <KeyboardCssContract height={height} isOpen={isOpen} />
        {/* the attribute lives on <html>, so the variant has to be scoped to
            an ancestor — a bare `data-keyboard-open:` would look for it on
            THIS element and match nothing. Inside <AvoidKeyboard> the bare
            form does work, because that component mirrors the attribute onto
            its own root for exactly this reason. */}
        <div className="rounded-md bg-secondary p-3 [html:not([data-keyboard-open])_&]:opacity-50 [html[data-keyboard-open]_&]:bg-primary/20">
          <p className="text-sm text-foreground">
            This box carries{" "}
            <code>{"[html[data-keyboard-open]_&]:bg-primary/20"}</code>. It
            must tint the moment the keyboard is up and untint the moment
            it is down — with no JavaScript involved on this element at
            all.
          </p>
        </div>
        <div
          className="rounded-md bg-secondary text-sm text-foreground"
          style={{
            paddingBottom: "calc(0.75rem + var(--adaptv-keyboard-height))",
            paddingTop: "0.75rem",
            paddingInline: "0.75rem",
          }}
        >
          This box reserves{" "}
          <code>calc(0.75rem + var(--adaptv-keyboard-height))</code> at the
          bottom. It must visibly grow while the keyboard is up. Note the
          absence of a <code>, 0px</code> fallback: the variable is always
          defined, which is the whole reason it is worth having.
        </div>
      </LabSection>

      <LabSection
        title="Raise it"
        description="Focus the field, then dismiss with the keyboard's own key — and separately with the button. On iOS, password autofill dismisses the keyboard without blurring, which is why the web path needs a dismiss confirmation at all."
      >
        <TextInput
          value={draft}
          onChange={setDraft}
          placeholder="Focus me"
          aria-label="Keyboard test field"
        />
        <LabActions>
          <LabButton onClick={() => dismissVirtualKeyboard()}>
            dismissVirtualKeyboard()
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Which path is live here"
        description="Native suppresses the OS resize and adaptv lifts content itself, matching what the web path already had to do by hand."
      >
        {probes === null ? (
          <p className="text-sm text-muted italic">resolving…</p>
        ) : (
          Object.entries(probes).map(([label, value]) => (
            <LabRow key={label} label={label} value={value} />
          ))
        )}
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/**
 * The published contract, read back off `<html>`.
 *
 * The hook's numbers and these two are the same fact in three shapes, so the
 * only interesting thing the page can show is whether they agree — a variable
 * that lags the hook by a frame is invisible in a demo and very visible in an
 * app that lays out against it.
 */
function KeyboardCssContract({
  height,
  isOpen,
}: {
  height: number
  isOpen: boolean
}) {
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
    //useKeyboard writes the live value as an inline style on <html> and the flag
    //as an attribute, so one observer over both covers every update
    const observer = new MutationObserver(read)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-keyboard-open", "style"],
    })
    return () => observer.disconnect()
  }, [])

  const agrees =
    state !== null &&
    state.open === isOpen &&
    Math.abs(Number.parseFloat(state.variable || "0") - height) < 1

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
        hint="A presence attribute, so `data-keyboard-open:pb-4` works bare in Tailwind v4 — and `not-data-keyboard-open:` composes for the other half."
      />
      <LabRow
        label="--adaptv-keyboard-height"
        value={state?.variable ?? null}
        hint="0px at rest, never undefined — so calc(1rem + var(--adaptv-keyboard-height)) needs no fallback and can never be invalid at computed-value time."
      />
      <LabRow
        label="agrees with the hook"
        value={
          state === null ? (
            <LabBadge tone="muted">reading…</LabBadge>
          ) : (
            <LabBadge tone={agrees ? "ok" : "bad"}>
              {agrees ? "yes" : "OUT OF STEP"}
            </LabBadge>
          )
        }
      />
    </>
  )
}
