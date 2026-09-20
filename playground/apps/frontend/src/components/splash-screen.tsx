import { PwaSplashOverlay } from "@arrzdev/adaptv/components"
import type { SplashScreenProps } from "@arrzdev/adaptv/config"
import type { CSSProperties } from "react"
import { useEffect, useState } from "react"
import { SplashMascot } from "@/components/illustrations/splash-mascot"
import { ReservedSvgSpace } from "@/components/reserved-svg-space"
import { useAppBootstrapReady } from "@/data/app-bootstrap-ready"

//---- Splash dismiss -----------------------------------------------------------
//Both are measured from `revealedAt` — the moment the OS launch splash came off and
//this screen became something a person can see — NOT from mount. The splash is mounted
//and painted underneath the OS splash on purpose (that overlap is what makes the
//handoff seamless), so timing from mount spends the minimum behind the OS splash and
//flashes the brand for whatever is left of it.
const SPLASH_MIN_MS = 1000
const SPLASH_POST_READY_MS = 100

//---- Splash screen animation settings ----------------------------------------
const SPLASH_WORDMARK = "CHOPCHOP"
const SPLASH_FILL_MS = 700
const SPLASH_PULSE_DELAY_MS = 750
const SPLASH_PULSE_MS = 1700

// Standalone only: anchor the splash's *centering region* (not the coverage box) to the
// frozen launch-viewport height at top:0. On an iOS standalone cold start the ICB paints
// small then expands after first paint, which would re-center the mascot downward — the
// launch shift. `--pwa-launch-height` is captured pre-paint from the resolved 100vh
// (getLaunchViewportInitScript), so the centering region never grows. It can shrink once: an
// iOS 26 installed app's view drops below the status bar ~120ms after the head script, and the
// height follows it down until the splash is revealed.
// The coverage box stays `fixed inset-0` (live viewport), so its bottom can never leak app
// content even if the frozen height comes in short. In the browser there's no shift, so the
// region keeps inset-0 (lvh fallback) and a frozen height can't fight the address bar.
const SPLASH_CENTER_CLASS =
  "app:h-[var(--pwa-launch-height,100lvh)] app:bottom-auto!"

const splashStyle = {
  "--splash-fill-ms": `${SPLASH_FILL_MS}ms`,
  "--splash-pulse-delay-ms": `${SPLASH_PULSE_DELAY_MS}ms`,
  "--splash-pulse-ms": `${SPLASH_PULSE_MS}ms`,
} as CSSProperties

//---- Splash screen component --------------------------------------------------
//adaptv mounts this and expects it to SELF-UNMOUNT: return null once the app has
//booted far enough to paint. "ready" is the local bootstrap gate
//(data/app-bootstrap-ready) — set after the local store seeds, NOT after the
//backend is reached — so the handoff happens even offline / with the backend
//unreachable. The app then renders its UI (empty or a "can't reach server"
//state); it never hangs on the splash waiting for the network.
//
//The one prop is `revealedAt`: the moment the OS launch splash came off. It is the
//only clock this screen may count against, because it is mounted underneath that
//splash and mount time is not view time (measured at ~230ms apart on a Pixel, and
//far more on a slow boot).
export function SplashScreen({ revealedAt }: SplashScreenProps) {
  const ready = useAppBootstrapReady()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    //`null` while the OS launch splash is still covering this — nobody has seen it
    //yet, so there is nothing to count down from.
    if (!ready || revealedAt === null) return

    const seenFor = Date.now() - revealedAt
    const delay = Math.max(SPLASH_MIN_MS - seenFor, SPLASH_POST_READY_MS)
    const timeout = setTimeout(() => setDismissed(true), delay)
    return () => clearTimeout(timeout)
  }, [ready, revealedAt])

  if (dismissed) return null

  return (
    <PwaSplashOverlay
      centerClassName={SPLASH_CENTER_CLASS}
      style={splashStyle}
    >
      <ReservedSvgSpace className="w-72 max-h-72">
        <SplashMascot className="block size-full" />
      </ReservedSvgSpace>
      <p className="relative m-0 origin-center text-center font-sans text-4xl font-bold tracking-[0.22em] uppercase animate-splash-wordmark-pulse">
        <span className="block text-primary/30">{SPLASH_WORDMARK}</span>
        <span
          aria-hidden
          className="absolute inset-0 block text-primary animate-splash-wordmark-fill"
        >
          {SPLASH_WORDMARK}
        </span>
      </p>
    </PwaSplashOverlay>
  )
}

export default SplashScreen
