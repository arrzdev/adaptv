import { useChromeTint } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isInstalledApp } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/chrome-tint")({
  component: LabChromeTintPage,
})

/** The drawer's own curves, so this page and the sheet can be compared directly. */
const CURVES = [
  {
    label: "sheet open · 0.38s",
    duration: 0.38,
    easing: [0.32, 0.72, 0, 1] as [number, number, number, number],
  },
  {
    label: "sheet close · 0.22s",
    duration: 0.22,
    easing: [0.6, 0.3, 0.15, 0.5] as [number, number, number, number],
  },
  {
    label: "slow linear · 2s",
    duration: 2,
    easing: [0, 0, 1, 1] as [number, number, number, number],
  },
]

const TARGETS = ["#8f8f8e", "#e60000", "#0a0a0c", "#3b82f6"]

function LabChromeTintPage() {
  const chrome = useChromeTint()
  const [installed, setInstalled] = useState(false)
  const [live, setLive] = useState<string | null>(null)
  const [curve, setCurve] = useState(CURVES[0])

  useEffect(() => {
    setInstalled(isInstalledApp())
  }, [])

  //Poll, and only for THIS row. `chrome.base` above is reactive and re-renders on its own —
  //it is app state. The live tint is not: mid-transition it changes every frame, so the hook
  //deliberately exposes it as a `read()` rather than subscribing the tree to a 60fps value.
  //Watching an animation in flight is a debug readout, and polling is the honest way to do it.
  useEffect(() => {
    const id = setInterval(() => setLive(chrome.read()), 60)
    return () => clearInterval(id)
  }, [chrome])

  return (
    <LabPage
      title="Chrome tint"
      subtitle="Animating <meta name=&quot;theme-color&quot;> along a curve, so a mobile browser's toolbar moves with the app instead of sitting above it in a flat, unrelated colour."
    >
      <LabBrief
        what="That the browser's own toolbar can be tinted from one colour to another along a cubic-bezier — and that it lands exactly on the target, with no jump at either end."
        steps={[
          "Read the two rows first. In an installed PWA or a native build the tag is still there and still written — there is simply no toolbar reading it, so nothing below will look like it did anything.",
          "Pick a curve, then a target colour. Watch the TOOLBAR, not the page: it should ease, not snap.",
          "Press a second target while the first is still moving. The toolbar must continue from the colour it had reached, not jump back to the start.",
          "Press restore. The toolbar returns to the app's theme colour.",
          "Toggle the app theme while a tint is applied, then restore: it must land on the NEW theme's colour, not the one it started from.",
          "Open the Drawer lab and drag the sheet. The toolbar must track the finger with the scrim.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Chrome on Android is the target. Desktop browsers mostly ignore theme-color, so judge this on a phone.",
          },
          pwa: {
            verdict: "absent",
            note: "Installed apps render edge to edge with no toolbar. The calls still run and still write the tag; nothing reads it, so nothing moves.",
          },
          ios: {
            verdict: "partial",
            note: "Safari 15–18.7 follows the tag. iOS 26.0–26.5 ignores it entirely (B17) — WebKit now derives the top-bar tint from the rendered html/body background instead, so on those versions nothing here moves and that is correct behaviour, not a bug.",
          },
          android: {
            verdict: "absent",
            note: "Native builds have no browser chrome — the write is inert. Also note the bottom navigation bar never follows the app on web or PWA (B29); only the top bar is ever in play.",
          },
        }}
        wrong="The toolbar jumps straight to the target colour with no motion, or it snaps back to the theme colour the instant a second transition starts. Either means the tag is being written once instead of driven per frame."
      />

      <LabSection title="Where this does anything">
        <LabSupport
          supported={chrome.supported}
          supportedLabel="There is a theme-color tag to write"
          unsupportedLabel="No tag — nothing to write"
          detail="Note what this does NOT say: whether anything is watching. The tag exists in an installed app too; there is just no toolbar reading it. The calls below run either way and are harmless where nobody is listening, which is why there is no platform check in the hook."
        />
        <LabRow
          label="installed app?"
          value={
            <LabBadge tone="muted">{installed ? "yes" : "no"}</LabBadge>
          }
        />
        <LabRow
          label="theme colour (the base)"
          value={<LabBadge tone="muted">{chrome.base ?? "—"}</LabBadge>}
        />
        <LabRow
          label="tag right now"
          value={<LabBadge tone="muted">{live ?? "—"}</LabBadge>}
        />
      </LabSection>

      <LabSection
        title="Curve"
        description="The duration and cubic-bezier handed to the transition. The first two are the drawer's own, so the sheet and this page can be compared side by side."
      >
        <LabActions>
          {CURVES.map((entry) => (
            <LabButton key={entry.label} onClick={() => setCurve(entry)}>
              {entry.label}
            </LabButton>
          ))}
        </LabActions>
        <LabRow label="selected" value={curve.label} />
        <LabRow label="cubic-bezier" value={curve.easing.join(", ")} />
      </LabSection>

      <LabSection
        title="Drive the tint"
        description="Press one while another is still running — the second must take over from the colour on screen."
      >
        <LabActions>
          {TARGETS.map((color) => (
            <LabButton
              key={color}
              onClick={() =>
                chrome.transitionTo(color, {
                  duration: curve.duration,
                  easing: curve.easing,
                })
              }
            >
              → {color}
            </LabButton>
          ))}
        </LabActions>
        <LabActions>
          <LabButton
            onClick={() =>
              chrome.restore({
                duration: curve.duration,
                easing: curve.easing,
              })
            }
          >
            restore
          </LabButton>
        </LabActions>
      </LabSection>
    </LabPage>
  )
}
