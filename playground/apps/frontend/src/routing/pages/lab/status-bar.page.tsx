import {
  applyStatusBar,
  enableEdgeToEdge,
  reprobeAndroidInsets,
} from "@arrzdev/adaptv/capabilities"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { getOS, isNativePlatform } from "@arrzdev/adaptv/utils"
import { useCallback, useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/status-bar")({
  component: LabStatusBarPage,
})

const INSET_VARS = [
  "--safe-area-inset-top",
  "--safe-area-inset-bottom",
  "--safe-area-inset-left",
  "--safe-area-inset-right",
]

function LabStatusBarPage() {
  const [native, setNative] = useState(false)
  const [os, setOs] = useState("web")
  const [insets, setInsets] = useState<Record<string, string>>({})

  const readInsets = useCallback(() => {
    const root = document.documentElement
    const computed = getComputedStyle(root)
    setInsets(
      Object.fromEntries(
        INSET_VARS.map((name) => [
          name,
          //the inline value is the one SystemBars injects on Android; the
          //computed value is what the CSS actually resolves to
          root.style.getPropertyValue(name) ||
            computed.getPropertyValue(name) ||
            "",
        ]),
      ),
    )
  }, [])

  useEffect(() => {
    setNative(isNativePlatform())
    setOs(getOS())
    readInsets()
  }, [readInsets])

  return (
    <LabPage
      title="Status bar"
      subtitle="The thing a PWA cannot do. On a native build adaptv styles the system bars and draws content under them; in a browser the chrome is the browser's."
    >
      <LabBrief
        what="Styling the system bars and drawing content underneath them — the thing a PWA cannot do at all, and the thing an Android release build got wrong once already."
        steps={[
          "Read the support row: on web everything below is a no-op and the page says so.",
          "Press the light and dark icon-style buttons. On native the status-bar icons must actually change colour.",
          "Toggle the theme from Settings and come back: the bars must follow, because useStatusBar(resolvedTheme) is mounted app-wide.",
          "On Android, press the edge-to-edge button and confirm the app draws UNDER the bars — and that the bars are transparent, not grey.",
          "Press the inset re-probe and check the four inset variables below it: they must be non-zero for the bars that exist.",
          "Rotate the device and re-probe. The insets must change.",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "No API at all. The browser owns its chrome, and the theme-color meta is the only influence the app has.",
          },
          pwa: {
            verdict: "absent",
            note: "Still no API. An installed PWA gets the manifest's theme colour behind the status bar and nothing else — no icon-style control, no edge-to-edge switch.",
          },
          ios: {
            verdict: "partial",
            note: "Icon style works. iOS has no edge-to-edge switch because it is always edge-to-edge; the safe-area insets are the mechanism instead.",
          },
          android: {
            verdict: "works",
            note: "Both. This is where edge-to-edge is a real toggle and where the injected --safe-area-inset-* variables come from — the same values the Safe area page grades.",
          },
        }}
        wrong="On Android the bars go opaque grey instead of transparent, or content stops drawing under them — that is edge-to-edge lost, and the app suddenly has letterboxes. On iOS, light icons on a light bar (or the reverse) means the theme sync is dead."
      />

      <LabSection title="Where this does anything">
        <LabSupport
          supported={native}
          supportedLabel="Native — the system bars are ours"
          unsupportedLabel="Web/PWA — the browser owns the bars"
          detail="Every call below is a no-op off native and returns without throwing, so the call site never branches."
        />
        <LabRow label="os" value={os} />
      </LabSection>

      <LabSection
        title="Icon style"
        description="Goes through Capacitor 8's core SystemBars, which styles both the status AND navigation bars. The naming is inverted: Style.Dark means light content, for a dark background."
      >
        <LabActions>
          <LabButton onClick={() => applyStatusBar("light")}>
            applyStatusBar(&quot;light&quot;)
          </LabButton>
          <LabButton onClick={() => applyStatusBar("dark")}>
            applyStatusBar(&quot;dark&quot;)
          </LabButton>
        </LabActions>
        <LabCaveat>
          Background colour is deliberately never set here.{" "}
          <code>setBackgroundColor</code> resolves successfully and does
          nothing on Android API 35+, and always did nothing on iOS — the
          bar background comes from the rendered html/body colour under the
          inset instead.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Edge-to-edge and the Android inset probe"
        description="SystemBars decides once, from DOMContentLoaded, whether the page opted into drawing under the bars. If that probe loses a race with the router rewriting <head>, the app is stuck on the padded fallback for the rest of the process — the grey status-bar band."
      >
        <LabActions>
          <LabButton
            onClick={() => {
              enableEdgeToEdge()
              readInsets()
            }}
          >
            enableEdgeToEdge()
          </LabButton>
          <LabButton
            onClick={() => {
              reprobeAndroidInsets()
              readInsets()
            }}
          >
            reprobeAndroidInsets()
          </LabButton>
          <LabButton onClick={readInsets}>Re-read insets</LabButton>
        </LabActions>
        {INSET_VARS.map((name) => (
          <LabRow key={name} label={name} value={insets[name] || null} />
        ))}
      </LabSection>
    </LabPage>
  )
}
