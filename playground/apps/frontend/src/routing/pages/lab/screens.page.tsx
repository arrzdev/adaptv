//adaptv's Link, not TanStack's: `to` here is a plain string, and a route that
//deliberately does not exist cannot be expressed against the generated tree
import { Link } from "adaptv/components"
import { useOrientation } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/screens")({
  component: LabScreensPage,
})

const LINK_CLASS =
  "block rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle"

function LabScreensPage() {
  const { orientation, isPortrait } = useOrientation()
  const [splashSeen, setSplashSeen] = useState<boolean | null>(null)

  /*
   * Poll briefly rather than sampling once on mount.
   *
   * The overlay self-unmounts when the app is ready, and on a COLD load this effect
   * runs while it is still up — so a single sample reported "STILL PRESENT" on every
   * fresh load and "gone" only after a client-side navigation. That is a false alarm
   * baked into the very page whose job is to catch the real one, and it trains you to
   * ignore the row. Give it a second to leave, then report what is actually true.
   */
  useEffect(() => {
    let cancelled = false
    const deadline = Date.now() + 1500
    const check = () => {
      if (cancelled) return
      const present =
        document.querySelector("[data-adaptv-splash]") !== null
      if (!present || Date.now() > deadline) {
        setSplashSeen(present)
        return
      }
      setTimeout(check, 100)
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <LabPage
      title="Full-screen chrome"
      subtitle="The three components that take over the whole screen and are therefore the hardest to catch: the 404, the rotate guard, and the launch overlay. None of them can be opened from a button — each has to be provoked."
    >
      <LabBrief
        what="That the app's own 404 screen, orientation guard and splash overlay each appear when their condition holds, are branded and safe-area aware, and get out of the way when it stops holding."
        steps={[
          "Tap “a route that does not exist”. The app's 404 screen must appear — the mascot, the 404 numeral and a Back home link — not a raw router error and not a blank page.",
          "Come back and tap the second link, which loads the same URL fresh. The server-rendered 404 must look identical to the client-navigated one.",
          "From the 404, press Back home. It must land on the tasks screen with the app fully working.",
          "Rotate the device to landscape. The rotate guard must cover the screen with the app's own message, and rotating back must dismiss it with no flash.",
          "Check the guard's padding while it is up: its text must clear the notch and the home indicator on both edges.",
          "Cold-start the app (fully quit it, or hard-reload) and watch the splash: the mascot must be centred in the screen below the status bar and must NOT jump downward a moment after it appears. On iOS 26 an installed app may move it up once, by up to 31 pt, in its first ~100 ms: that is the launch height following the view below the status bar.",
          "Confirm the splash hands over to the app rather than lingering — and that no splash element is left in the DOM afterwards (the row below checks this).",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "404 works. The rotate guard depends on the manifest orientation, which a browser tab does not enforce — on a desktop window it will not appear at all, and that is correct. The splash overlay does show on a cold load, but there is no OS launch image behind it.",
          },
          pwa: {
            verdict: "works",
            note: "All three, and the splash is the interesting one: on an iOS standalone cold start the initial containing block paints small and then expands, so a naive centre would shift the mascot downward. The overlay pins its centring region to the frozen launch height to prevent exactly that.",
          },
          ios: {
            verdict: "works",
            note: "All three. Here there are TWO splashes in sequence — the OS launch image, then this overlay — and the handoff between them must not flash a different background colour.",
          },
          android: {
            verdict: "works",
            note: "All three. Also check the hardware back button from the 404 screen: it must leave the app or return to the previous route, not sit there doing nothing.",
          },
        }}
        wrong="A bad URL shows the router's default error page or a blank screen instead of the app's 404. The rotate guard appears and then will not go away, or its text sits under the status bar. The splash mascot jumps downward after the first frame (the launch-height freeze is gone), or a splash element is still in the DOM after boot and is silently eating taps."
      />

      <LabSection
        title="UiNotFound — via the app's notFoundScreen"
        description="adaptv owns the host; the app supplies the screen through adaptv.config.ts (notFoundScreen). So what you are testing here is the wiring as much as the component."
      >
        <Link to="/lab/definitely-not-a-route" className={LINK_CLASS}>
          a route that does not exist (client navigation)
        </Link>
        <a href="/lab/definitely-not-a-route" className={LINK_CLASS}>
          the same URL, loaded fresh (server render)
        </a>
        <LabRow
          label="configured screen"
          value="@/components/not-found-screen"
          hint="Swapped in via adaptv.config.ts. Without it you would get adaptv's own neutral UiNotFound, which is the fallback rather than the intent."
        />
      </LabSection>

      <LabSection
        title="OrientationGuard — rotate the device"
        description="The app's manifest locks to portrait, and WebKit has never shipped screen.orientation.lock() — so on iOS the only honest response to a rotated device is to ask for it back. That is what this screen is."
      >
        <LabRow
          label="orientation"
          value={orientation}
          hint="Live on a device: rotate and watch it change, and the guard should appear at the same moment. On a DESKTOP browser it reports the monitor, not the window — so it reads landscape however narrow you make the window, and resizing will not move it. That is screen.orientation behaving correctly, not a broken readout."
        />
        <LabRow
          label="isPortrait"
          value={
            <LabBadge tone={isPortrait ? "ok" : "warn"}>
              {String(isPortrait)}
            </LabBadge>
          }
        />
        <LabCaveat>
          Nothing on this page can force the guard up — the shell mounts it
          only when the device is genuinely rotated away from the locked
          orientation, which is the right design and the reason this card
          is instructions rather than a button. On a desktop browser it
          will never appear, however narrow you make the window.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="PwaSplashOverlay — cold start only"
        description="It is mounted before the app has booted and self-unmounts by returning null, so by the time any route exists it is already gone. The only way to see it is to start the app."
      >
        <LabRow
          label="[data-adaptv-splash] still in the DOM"
          value={
            splashSeen === null ? (
              <LabBadge tone="muted">checking…</LabBadge>
            ) : (
              <LabBadge tone={splashSeen ? "bad" : "ok"}>
                {splashSeen ? "STILL PRESENT" : "gone, as expected"}
              </LabBadge>
            )
          }
          hint="An overlay left mounted covers the app with an invisible full-screen element and swallows every tap."
        />
        <LabRow
          label="how to watch it"
          value="fully quit the app and relaunch"
          hint="A soft navigation will not do it — the gate is only closed once per boot."
        />
      </LabSection>
    </LabPage>
  )
}
