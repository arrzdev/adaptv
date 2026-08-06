import {
  BackPriority,
  registerBackHandler,
  runBackChain,
} from "@arrzdev/adaptv/capabilities"
import { useBackHandler } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isNativePlatform } from "@arrzdev/adaptv/utils"
import { useCallback, useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/back-chain")({
  component: LabBackChainPage,
})

function LabBackChainPage() {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [transientOpen, setTransientOpen] = useState(false)
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [native, setNative] = useState(false)

  useEffect(() => setNative(isNativePlatform()), [])

  //stable across renders: these handlers are registered from effects, and a new
  //identity every render would unregister/re-register the whole chain each time
  const append = useCallback(
    (entry: string) =>
      setLog((entries) => [labLogEntry(entry), ...entries].slice(0, 40)),
    [],
  )

  //two competing handlers, registered while their UI is "open". The overlay
  //band outranks the transient one, so back closes the overlay first — the
  //ordering a lone router.back() has no way to know about.
  useEffect(() => {
    if (!overlayOpen) return
    return registerBackHandler(() => {
      append("Overlay (400) consumed the press")
      setOverlayOpen(false)
      return true
    }, BackPriority.Overlay)
  }, [overlayOpen, append])

  useEffect(() => {
    if (!transientOpen) return
    return registerBackHandler(() => {
      append("Transient (300) consumed the press")
      setTransientOpen(false)
      return true
    }, BackPriority.Transient)
  }, [transientOpen, append])

  //a handler that always defers, to show that returning false falls through
  useEffect(
    () =>
      registerBackHandler(() => {
        append("Affordance (200) deferred")
        return false
      }, BackPriority.Affordance),
    [append],
  )

  //the hook is the same registration with the lifetime handed to React — and it
  //takes an INLINE arrow on purpose: the handler is ref-held, so a new identity
  //every render must not re-register (which would reorder this band silently)
  useBackHandler(() => {
    append(`useBackHandler (${BackPriority.RouterBack}) deferred`)
    return false
  }, BackPriority.RouterBack)

  return (
    <LabPage
      title="Back chain"
      subtitle="A priority auction, not a flat handler. Open both fakes, then press back — the highest band wins, and a handler that returns false falls through to the next."
    >
      <LabBrief
        what="That a back press is auctioned to the highest-priority handler that wants it, that a handler returning false falls through to the next, and that the floor is a router pop or an app exit."
        steps={[
          "Open the fake overlay AND the fake transient, then press back once. The Overlay band (400) must consume it — check the log.",
          "Press back again. The Transient band (300) must consume that one.",
          "Press back a third time with nothing open. It must pop the route and take you back to the testing index.",
          "Re-open both, then use the PLATFORM back rather than the button: Android hardware/gesture back, or the browser Back button. The order must be identical.",
          "Watch for the deferring handler in the log: it must be reached and must NOT consume the press.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "The in-page button works, and so does the browser's Back button — adaptvBack pops history. There is no app to exit, so the floor is just a pop.",
          },
          pwa: {
            verdict: "works",
            note: "Same, plus the OS/edge back gesture where the shell provides one. An installed app with no history left simply stays put.",
          },
          ios: {
            verdict: "works",
            note: "The chain runs from the WebView's own interactive back-forward swipe as well as from the button. The floor pops history; on the first entry it does nothing rather than exiting, which matches iOS convention.",
          },
          android: {
            verdict: "works",
            note: "The hardware/gesture back button is the real test here, and the floor genuinely EXITS the app when there is no history left. Check the exit only when you mean to.",
          },
        }}
        wrong="Back closes the wrong thing first — the transient before the overlay, or the route before either. That is a flat handler list pretending to be a chain, and it means a back press can dismiss a page out from under a modal. Or a handler that returned false still swallowed the press."
      />

      <LabSection title="Bands">
        {Object.entries(BackPriority).map(([name, priority]) => (
          <LabRow key={name} label={name} value={String(priority)} />
        ))}
      </LabSection>

      <LabSection title="Register some handlers">
        <LabActions>
          <LabButton onClick={() => setOverlayOpen(true)}>
            Open a fake overlay
          </LabButton>
          <LabButton onClick={() => setTransientOpen(true)}>
            Open a fake menu
          </LabButton>
        </LabActions>
        <LabRow
          label="overlay registered"
          value={
            <LabBadge tone={overlayOpen ? "ok" : "muted"}>
              {String(overlayOpen)}
            </LabBadge>
          }
        />
        <LabRow
          label="menu registered"
          value={
            <LabBadge tone={transientOpen ? "ok" : "muted"}>
              {String(transientOpen)}
            </LabBadge>
          }
        />
      </LabSection>

      <LabSection
        title="Run the chain"
        description="On a native Android build the hardware back button runs exactly this. Everywhere else, press the button — it is the same call the shell's one platform listener makes."
      >
        <LabActions>
          <LabButton
            onClick={() => {
              const consumed = runBackChain()
              append(
                consumed
                  ? "runBackChain() → consumed"
                  : "runBackChain() → nobody handled it (router back is the floor)",
              )
            }}
          >
            runBackChain()
          </LabButton>
        </LabActions>
        <LabRow
          label="hardware back"
          value={
            <LabBadge tone={native ? "ok" : "muted"}>
              {native
                ? "wired to this chain"
                : "browser back — not this chain"}
            </LabBadge>
          }
          hint="An installed app has no URL bar, so it fully owns back. A browser tab keeps the browser's own affordance."
        />
        <LabRow
          label="useBackHandler(…, 100)"
          value={<LabBadge tone="ok">mounted</LabBadge>}
          hint="The hook form — registered for this component's lifetime, and it always defers here, so you can watch it in the log below without it stealing the press."
        />
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
