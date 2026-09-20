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

/**
 * A second handler in the SAME band as the fake overlay. Two stacked overlays tie
 * on priority, and the one registered last — opened last — has to consume first,
 * whichever you open first. It is a component on purpose: it is mounted only while
 * open and registers through `useBackHandler`, so closing it is an UNMOUNT, and the
 * hook's own cleanup is the only thing that takes it back out of the chain.
 */
function SecondOverlay({ onBack }: { onBack: () => void }) {
  useBackHandler(() => {
    onBack()
    return true
  }, BackPriority.Overlay)
  return null
}

function LabBackChainPage() {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [secondOverlayOpen, setSecondOverlayOpen] = useState(false)
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
          "Re-open both, then use the PLATFORM back rather than the button: Android hardware/gesture back, or the left-edge swipe in an installed app. The order must be identical.",
          "Watch for the deferring handler in the log: it must be reached and must NOT consume the press.",
          "Open the second fake overlay, then the first, and press back. Both sit in the Overlay band, so the one opened LAST must consume first. Repeat in the other order: the winner must swap.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "The in-page button runs the chain. The browser's Back button does not: nothing here listens to history, so it pops the route with both fakes still open and the page leaves under them (headless Chromium and WebKit). Escape is not a chain input in a tab either. There is no app to exit, so the floor is just a pop.",
          },
          pwa: {
            verdict: "works",
            note: "The in-page button, plus the lab shell's left-edge swipe, which runs the same chain: overlay, then menu, then a pop. With no history left the swipe goes to the testing index. On iOS, a Safari tab's edge swipe is the browser's Back (see web); only the installed app has this one.",
          },
          ios: {
            verdict: "works",
            note: "Capacitor leaves WebKit's own back-forward swipe off (register B15), so the back gesture is the lab shell's left-edge swipe, and it runs the chain like the button. With no history left the swipe goes to the testing index rather than exiting.",
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
          <LabButton onClick={() => setSecondOverlayOpen(true)}>
            Open a second fake overlay
          </LabButton>
          {secondOverlayOpen && (
            <SecondOverlay
              onBack={() => {
                append("Second overlay (400) consumed the press")
                setSecondOverlayOpen(false)
              }}
            />
          )}
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
          label="second overlay registered"
          value={
            <LabBadge tone={secondOverlayOpen ? "ok" : "muted"}>
              {String(secondOverlayOpen)}
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
