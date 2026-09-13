import { Icon, Text } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { ArrowLeft, Bell, CircleAlert, Star, WifiOff } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/icon")({
  component: LabIconPage,
})

/** The text sizes the inline probe walks: Tailwind's own scale, smallest to largest. */
const INLINE_SIZES = [
  ["xs", "text-xs"],
  ["base", "text-base"],
  ["2xl", "text-2xl"],
  ["4xl", "text-4xl"],
] as const

function LabIconPage() {
  return (
    <LabPage
      title="Icon"
      subtitle="An <svg> from any icon set, exposed to screen readers correctly on every engine and sized with the text around it."
    >
      <LabBrief
        what="the two quirks Icon owns: decorative vs meaningful exposure of an <svg> (aria-hidden vs role=img + aria-label), and the 1em box plus the scaleWithSystem opt-in that lets an icon follow iOS Dynamic Type."
        steps={[
          "Turn on the screen reader (VoiceOver / TalkBack) and swipe through the Exposure card. The two labelled icons are read as images named “Sync failed” and “Offline”; the star next to “Starred” is skipped and only the word is read; the icon-only button is read as a button named “Back”.",
          "Read the Exposure readout: every decorative icon is aria-hidden with no role, every labelled one is role=img with its name.",
          "In the inline card each star must be exactly as tall and as wide as the font-size printed next to it.",
          "Read the Dynamic Type card's numbers. On desktop and on Android the text factor is 1 and every icon is 20px.",
          "On iOS (the app, a Safari tab or an installed PWA): Settings → Accessibility → Display & Text Size → Larger Text, turn on Larger Accessibility Sizes and drag the slider to the far right, come back, and RELOAD. The Text grows in both rows; in the first row the bell stays at 20px, in the second it grows by the same factor as the text.",
          "Still on iOS at that size, tap “Bell size-6”: row 2's bell must read 24px × the factor. Tap it again, then “scaleWithSystem off”: it must read 20px × the factor, then exactly 20px. A number that keeps growing, or a bell stuck above 20px after the opt-out, is the bug.",
          "The RTL card: the arrow with rtl:-scale-x-100 points left in the LTR box and right in the RTL box; the plain one points left in both.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Exposure and the 1em box work in every engine. scaleWithSystem follows the engine, not the target: in Safari on iOS the factor is measured and the opted-in bell grows after a reload (measured 3.12× at the largest size on iOS 16.2 and 26.1). Desktop Safari and every Chromium are outside the -webkit-touch-callout gate, so there the factor reads 1.00× and both bells are 20px.",
          },
          pwa: {
            verdict: "partial",
            note: "The same split as the browser tab. Installed from Safari on iOS it is iOS WebKit, so the opted-in bell grows with the text after a reload. Installed from desktop Chrome or Safari, or on Android, the factor reads 1.00× and both bells stay 20px.",
          },
          ios: {
            verdict: "works",
            note: "Everything. At the default text size the factor is 1.00× and both bells are 20px; at the largest accessibility size the factor is above 3× and only the opted-in bell grows with it, after a reload.",
          },
          android: {
            verdict: "partial",
            note: "Exposure and the 1em box work. scaleWithSystem is absent and correct: Blink never shipped -webkit-touch-callout, so the factor is 1 and nothing is scaled.",
          },
        }}
        wrong="A screen reader reads the decorative star, or reads a labelled icon as “group” or skips it. An inline star is a different size from its text. Off iOS, the opted-in bell is anything but 20px. On iOS after a reload at a large text size, the opted-in bell holds at 20px (the factor is not reaching it), reads the factor SQUARED (about 194px at 3.12×), keeps growing as the size buttons are tapped, or the plain one grows too."
      />

      <ExposureProbe />
      <InlineProbe />
      <DynamicTypeProbe />
      <RtlProbe />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={<LabBadge tone="ok">icon</LabBadge>}
          hint="Target every icon from global CSS with no imports: [data-adaptv='icon'] { … }"
        />
        <LabRow
          label="data-scale-with-system"
          value="present only when scaleWithSystem"
          hint="A presence marker; the sizing itself is done in JS, like Text's."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/** The exposure attributes one icon ended up with, as a tester reads them. */
function exposureOf(el: Element | null): string {
  if (!el) return "—"
  const role = el.getAttribute("role")
  const name = el.getAttribute("aria-label")
  const hidden = el.getAttribute("aria-hidden")
  return [
    role ? `role=${role}` : "no role",
    name ? `aria-label="${name}"` : "no name",
    hidden ? `aria-hidden=${hidden}` : "not hidden",
  ].join(" · ")
}

function ExposureProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState<Record<string, string> | null>(
    null,
  )

  useEffect(() => {
    const at = (id: string) =>
      exposureOf(
        root.current?.querySelector(`[data-testid="${id}"]`) ?? null,
      )
    setReadout({
      "decorative star": at("icon-decorative"),
      "labelled alert": at("icon-labelled-alert"),
      "labelled offline": at("icon-labelled-offline"),
      "icon in the button": at("icon-in-button"),
    })
  }, [])

  return (
    <LabSection
      title="Exposure"
      description="No label → aria-hidden. A label → role=img + aria-label. Never role=none: a named svg is still announced through it."
    >
      <div
        ref={root}
        data-testid="icon-exposure"
        className="flex flex-col gap-y-3"
      >
        <Text className="inline-flex items-center gap-x-2 text-base text-foreground">
          <Icon render={<Star />} data-testid="icon-decorative" />
          Starred
        </Text>
        <div className="flex items-center gap-x-4 text-foreground">
          <Icon
            render={<CircleAlert />}
            label="Sync failed"
            className="size-6 text-error"
            data-testid="icon-labelled-alert"
          />
          <Icon
            render={<WifiOff />}
            label="Offline"
            className="size-6 text-subtle"
            data-testid="icon-labelled-offline"
          />
          <button
            type="button"
            aria-label="Back"
            className="rounded-md bg-secondary p-2 text-foreground"
          >
            <Icon
              render={<ArrowLeft />}
              className="size-5"
              data-testid="icon-in-button"
            />
          </button>
        </div>
      </div>
      {readout === null ? (
        <p className="text-sm text-muted italic">reading…</p>
      ) : (
        Object.entries(readout).map(([label, value]) => (
          <LabRow key={label} label={label} value={value} />
        ))
      )}
      <LabCaveat>
        The button is the pattern for an icon-only control: the BUTTON
        carries the name and its icon stays decorative, so the reader says
        “Back, button” once instead of an image inside an unnamed button.
      </LabCaveat>
    </LabSection>
  )
}

function InlineProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const [key] of INLINE_SIZES) {
      const text = root.current?.querySelector<HTMLElement>(
        `[data-testid="inline-text-${key}"]`,
      )
      const icon = root.current?.querySelector(
        `[data-testid="inline-icon-${key}"]`,
      )
      if (!text || !icon) continue
      const box = icon.getBoundingClientRect()
      next[`text-${key}`] =
        `font ${getComputedStyle(text).fontSize} · icon ${box.width}×${box.height}px`
    }
    setRows(next)
  }, [])

  return (
    <LabSection
      title="Inline in Text"
      description="The default box is 1em on both axes, so an icon inside a run of text is the text's size with no class at all."
    >
      <div
        ref={root}
        data-testid="icon-inline"
        className="flex flex-col gap-y-2"
      >
        {INLINE_SIZES.map(([key, size]) => (
          <Text
            key={key}
            data-testid={`inline-text-${key}`}
            className={`inline-flex items-center gap-x-2 text-foreground ${size}`}
          >
            <Icon render={<Star />} data-testid={`inline-icon-${key}`} />
            {size}
          </Text>
        ))}
      </div>
      {rows === null ? (
        <p className="text-sm text-muted italic">measuring…</p>
      ) : (
        Object.entries(rows).map(([label, value]) => (
          <LabRow key={label} label={label} value={value} />
        ))
      )}
    </LabSection>
  )
}

/**
 * Two rows of the same pair: a `size-5` bell beside a `Text scaleWithSystem`. Only the
 * second bell opts in. Off iOS all four numbers match their row; on iOS after a reload
 * at a larger text size, the text grows in both rows and only the second bell with it.
 */
function DynamicTypeProbe() {
  const plainText = useRef<HTMLSpanElement>(null)
  const plainIcon = useRef<SVGSVGElement>(null)
  const scaledText = useRef<HTMLSpanElement>(null)
  const scaledIcon = useRef<SVGSVGElement>(null)
  const [rows, setRows] = useState<Record<string, string> | null>(null)
  //row 2's bell can be resized and opted out live: both re-run Icon's measurement on a
  //node it has already scaled, which a mount alone never does
  const [large, setLarge] = useState(false)
  const [optedIn, setOptedIn] = useState(true)
  const bellClass = large ? "size-6" : "size-5"

  useEffect(() => {
    const font = (el: HTMLElement | null) =>
      el ? Number.parseFloat(getComputedStyle(el).fontSize) : Number.NaN
    const width = (el: SVGSVGElement | null) =>
      el ? el.getBoundingClientRect().width : Number.NaN
    //text-base is 16px built, so the scaled Text's size ÷ 16 is the factor both
    //opted-in elements were multiplied by
    const factor = font(scaledText.current) / 16
    setRows({
      "text factor (scaleWithSystem text-base ÷ 16px)": `${factor.toFixed(2)}×`,
      "row 1 — text": `${font(plainText.current)}px`,
      "row 1 — bell, size-5, not opted in": `${width(plainIcon.current)}px`,
      "row 2 — text": `${font(scaledText.current)}px`,
      [`row 2 — bell, ${bellClass}, scaleWithSystem ${optedIn ? "on" : "off"}`]: `${width(scaledIcon.current)}px`,
      "@supports (-webkit-touch-callout: none)": String(
        typeof CSS !== "undefined" &&
          CSS.supports("-webkit-touch-callout", "none"),
      ),
    })
  }, [bellClass, optedIn])

  return (
    <LabSection
      title="Beside a scaled Text"
      description="Dynamic Type reaches a sibling icon only by measurement. Both rows scale the text; only the second row's bell opts in."
    >
      <div className="flex flex-col gap-y-3 rounded-md bg-secondary p-3">
        <div className="flex items-center gap-x-2 text-foreground">
          <Icon
            ref={plainIcon}
            render={<Bell />}
            className="size-5"
            data-testid="dt-icon-plain"
          />
          <Text
            ref={plainText}
            scaleWithSystem
            className="text-base"
            data-testid="dt-text-plain"
          >
            Reminders — the bell stays put
          </Text>
        </div>
        <div className="flex items-center gap-x-2 text-foreground">
          <Icon
            ref={scaledIcon}
            render={<Bell />}
            scaleWithSystem={optedIn}
            className={bellClass}
            data-testid="dt-icon-scaled"
          />
          <Text
            ref={scaledText}
            scaleWithSystem
            className="text-base"
            data-testid="dt-text-scaled"
          >
            Reminders — the bell grows with the text
          </Text>
        </div>
      </div>
      <div className="flex gap-x-2">
        <button
          type="button"
          data-testid="dt-toggle-size"
          onClick={() => setLarge((value) => !value)}
          className="rounded-md bg-secondary px-3 py-2 text-sm text-foreground"
        >
          {large ? "Bell size-5" : "Bell size-6"}
        </button>
        <button
          type="button"
          data-testid="dt-toggle-scale"
          onClick={() => setOptedIn((value) => !value)}
          className="rounded-md bg-secondary px-3 py-2 text-sm text-foreground"
        >
          {optedIn ? "scaleWithSystem off" : "scaleWithSystem on"}
        </button>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted italic">measuring…</p>
      ) : (
        Object.entries(rows).map(([label, value]) => (
          <LabRow key={label} label={label} value={value} />
        ))
      )}
      <LabCaveat>
        Do not opt in an icon that sits INSIDE a scaled Text at the default
        1em: it already follows the text's font-size, and opting in would
        scale it twice. The opt-in is for a fixed-size icon beside the
        text. A scaled size is fixed px: the icon re-measures when its own
        class or glyph changes, not when the font-size around it does.
      </LabCaveat>
    </LabSection>
  )
}

function RtlProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    //Tailwind 4's scale utilities write the individual `scale` property, not
    //`transform` — so `transform` reads "none" on a flipped glyph
    const scale = (id: string) => {
      const el = root.current?.querySelector(`[data-testid="${id}"]`)
      return el ? getComputedStyle(el).scale : "—"
    }
    setRows({
      "ltr · rtl:-scale-x-100": scale("rtl-ltr-flip"),
      "rtl · rtl:-scale-x-100": scale("rtl-rtl-flip"),
      "rtl · plain": scale("rtl-rtl-plain"),
    })
  }, [])

  return (
    <LabSection
      title="Right-to-left"
      description="No mirror prop: rtl:-scale-x-100 on className flips a directional glyph under dir=rtl. Which glyphs are directional is the icon set's knowledge."
    >
      <div ref={root} className="grid grid-cols-2 gap-3 text-foreground">
        <div dir="ltr" className="flex items-center gap-x-2">
          <Icon
            render={<ArrowLeft />}
            className="size-6 rtl:-scale-x-100"
            data-testid="rtl-ltr-flip"
          />
          <span className="text-sm">ltr</span>
        </div>
        <div dir="rtl" className="flex items-center gap-x-2">
          <Icon
            render={<ArrowLeft />}
            className="size-6 rtl:-scale-x-100"
            data-testid="rtl-rtl-flip"
          />
          <Icon
            render={<ArrowLeft />}
            className="size-6"
            data-testid="rtl-rtl-plain"
          />
          <span className="text-sm">rtl</span>
        </div>
      </div>
      {rows === null ? (
        <p className="text-sm text-muted italic">measuring…</p>
      ) : (
        Object.entries(rows).map(([label, value]) => (
          <LabRow key={label} label={label} value={value} />
        ))
      )}
    </LabSection>
  )
}
