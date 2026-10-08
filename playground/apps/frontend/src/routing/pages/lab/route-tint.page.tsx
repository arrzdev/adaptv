import { Link } from "adaptv/components"
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

/**
 * The tint this route pins — deliberately nothing like EITHER theme colour, so a
 * screenshot cannot accidentally agree with the app. The theme colours themselves
 * are NOT repeated here: `scripts/ota-lab.ts` rewrites `themeColor` in
 * `adaptv.config.ts` in place, so any copy of them goes stale the first time the
 * OTA bench runs. Held in a const because the page prints it too; adaptv resolves
 * a top-level const the same way it resolves an inline literal.
 */
const ROUTE_TINT = "#0b6e4f"

export const Route = createFileRoute("/_providers/lab/route-tint")({
  //THE THING UNDER TEST. A literal, because adaptv reads it out of this file at
  //build time — see the option's own docs, and `shell/route-tints.ts`.
  chromeTint: ROUTE_TINT,
  component: LabRouteTintPage,
})

/** What the two outputs actually read, live. */
function useChromeSurfaces() {
  const [surfaces, setSurfaces] = useState<{
    meta: string | null
    html: string | null
  }>({ meta: null, html: null })

  useEffect(() => {
    //polled rather than subscribed: these are the DOM's answer, not the app's
    //state, and the point of the row is to catch a disagreement between them
    const read = () =>
      setSurfaces({
        meta:
          document
            .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
            ?.content?.toLowerCase() ?? null,
        html:
          getComputedStyle(document.documentElement).backgroundColor ||
          null,
      })
    read()
    const id = setInterval(read, 250)
    return () => clearInterval(id)
  }, [])

  return surfaces
}

function LabRouteTintPage() {
  const { meta, html } = useChromeSurfaces()

  return (
    <LabPage
      title="Route tint"
      subtitle="A route declaring the colour the browser's chrome should be, and adaptv having it on screen before the app has booted."
    >
      <LabBrief
        what="That `chromeTint` on a route pins the browser chrome to that colour, that it is right on the very FIRST frame of a cold launch (not after a flash of the theme colour), and that leaving the route hands the chrome back to the theme rather than to a parent route."
        steps={[
          "Read the two rows below: the meta tag and the html background must BOTH be the route's colour. Neither alone covers every platform.",
          "COLD LAUNCH THIS URL. Open /lab/route-tint in a new tab, or force-quit the installed app and relaunch it here. There must be no frame of the theme colour first — that frame is the whole reason the colour is computed at build time.",
          "Navigate to the lab index and back with the links below. The chrome must change with the SCREEN, not with the tap.",
          "Toggle the app theme while on this page. The chrome must NOT move: a route that pins the chrome pins it in both themes.",
          "Go to any other lab page. The chrome returns to the app's theme colour — not to whatever a layout above it might have wanted.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Chrome on Android tints its toolbar from the meta tag. Desktop browsers mostly ignore theme-color, so judge this on a phone.",
          },
          pwa: {
            verdict: "partial",
            note: "No toolbar, and only one band takes the tint: measured on the iOS simulator, iOS 18.0 shows it at the bottom only and iOS 26.1 at the top only (B33). On 18.0 the page runs under a see-through status bar, so the top band is the page's own top: it stays the page background while the page is parked at the top, and the tint reaches it only through the edge fade once the page scrolls.",
          },
          ios: {
            verdict: "partial",
            note: "Safari 15–18.7 reads the meta tag and iOS 26+ Safari the rendered html/body edge (B17), but this build follows neither: measured on iOS 18.0 and 26.1, the status bar keeps the page's own pixels and the tint shows only as a gradient at the bottom edge (B33).",
          },
          android: {
            verdict: "partial",
            note: "Native builds go edge to edge, so the status bar follows the html paint. The bottom navigation bar never follows the app on web or PWA (B29).",
          },
        }}
        wrong="A frame of the app's theme colour before this route's colour appears on a cold launch. That means the tint was resolved after boot instead of before paint — the build-time table missed this route."
      />

      <LabSection
        title="What the two outputs say"
        description="Both must read the route's colour. They are not redundant: the meta tag is the Android/Chrome and iOS ≤ 18 Safari path, and the html paint is the iOS 26+ one, where the tag is inert."
      >
        <LabRow
          label="declared chromeTint"
          value={<LabBadge tone="muted">{ROUTE_TINT}</LabBadge>}
        />
        <LabRow
          label="meta theme-color"
          value={<LabBadge tone="muted">{meta ?? "—"}</LabBadge>}
          hint="what a browser toolbar reads"
        />
        <LabRow
          label="html background"
          value={<LabBadge tone="muted">{html ?? "—"}</LabBadge>}
          hint="what iOS 26 reads, and what paints the safe-area bands the content leaves"
        />
        <LabCaveat>
          The app's own content covers the edges, so the html paint is only
          visible in the bands above and below it. That is the point — in
          iOS 26 Safari those bands ARE the chrome. The native iOS app, and
          the installed app on iOS 18, keep the page's own pixels at the
          top.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Leave and come back"
        description="The fallback is always the app's global theme colours. There is no inheritance from a parent route — /lab declares no tint, so it gets the theme."
      >
        <div className="flex flex-wrap gap-3 text-sm">
          <Link to="/lab" className="text-accent underline">
            /lab · no tint
          </Link>
          <Link to="/lab/chrome-tint" className="text-accent underline">
            /lab/chrome-tint · no tint, animates instead
          </Link>
        </div>
      </LabSection>
    </LabPage>
  )
}
