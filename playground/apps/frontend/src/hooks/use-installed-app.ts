import { isInstalledApp } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"

/**
 * Is this the INSTALLED app — a native Capacitor build or a standalone PWA —
 * rather than a browser tab?
 *
 * This is the trap it exists to keep the app out of: `(display-mode: standalone)`
 * looks like the same question and is not. That media query reads **false** inside
 * a Capacitor WebView, so a gate written on it silently switches itself off on the
 * two native targets — which is exactly where an installed-app affordance is needed
 * most. `isInstalledApp()` answers native OR standalone (including legacy iOS
 * `navigator.standalone`), and is what every "am I installed?" gate here goes
 * through. It is the SHELL axis; `getOS()` is the separate OS axis — adaptv's
 * `utils/platform.ts` header lays both out.
 *
 * Lives here rather than in adaptv because two call sites in one app is not yet a
 * framework export. If a third app needs it, that is when it moves.
 *
 * Returns `false` on the server and for the first client render: it reads
 * `window`/`navigator`, these pages are server-rendered, and the honest answer only
 * arrives in an effect. So whatever this gates has to be safe to arm a frame late —
 * true for a gesture listener, not true for anything that changes layout.
 */
export function useIsInstalledApp(): boolean {
  const [installed, setInstalled] = useState(false)
  useEffect(() => setInstalled(isInstalledApp()), [])
  return installed
}
