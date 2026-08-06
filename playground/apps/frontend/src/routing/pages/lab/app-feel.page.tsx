import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabBadge, LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/app-feel")({
  component: LabAppFeelPage,
})

/** The `<html>` attribute each `ui` option stamps, and what it turns off. */
const STAMPS = [
  {
    attr: "data-adaptv-no-select",
    option: "ui.noSelect",
    effect: "user-select: none on everything but text fields",
  },
  {
    attr: "data-adaptv-hide-scrollbars",
    option: "ui.hideScrollbars",
    effect: "scrollbar-width: none + the webkit scrollbar chrome",
  },
  {
    attr: "data-adaptv-no-touch-callout",
    option: "ui.touchCallout",
    effect:
      "-webkit-touch-callout: none on a[href] — the iOS long-press preview",
  },
] as const

//a fixed list, so each row has a real key — the box only exists to be tall
//enough to scroll
const SCROLL_LINES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
] as const

/**
 * The two app-feel resets a consumer gets to decide.
 *
 * The page is worth opening on more than one target for the same reason the
 * options exist: with the default `"app"`, the rows below read *stamped* in an
 * installed app and *absent* in a browser tab — and the text under them is
 * selectable in exactly the second case.
 */
function LabAppFeelPage() {
  const [stamps, setStamps] = useState<Record<string, boolean> | null>(
    null,
  )

  //read after mount: the attributes are written by the pre-paint init script, and
  //the server has no platform to resolve them against
  useEffect(() => {
    const root = document.documentElement
    setStamps(
      Object.fromEntries(
        STAMPS.map(({ attr }) => [attr, root.hasAttribute(attr)]),
      ),
    )
  }, [])

  return (
    <LabPage
      title="App feel"
      subtitle="Text selection and scrollbars are the two resets whose alternative is different, not broken — so they are config, not doctrine. Everything else in patches.css fixes something genuinely broken and has no knob."
    >
      <LabBrief
        what="The three resets that are the app's call rather than doctrine — text selection, scrollbars and the iOS long-press callout — and the one that is doctrine and has no knob."
        steps={[
          "Read the three stamp rows. With the default “app” scope they must be STAMPED in an installed app or a native build, and ABSENT in a browser tab.",
          "Try to select the first paragraph: long-press on touch, drag on desktop. It must be selectable exactly when data-adaptv-no-select is absent.",
          "Try to select the second paragraph, which carries the `selectable` utility. It must select on EVERY target — that is a utility beating the reset on cascade layer order alone.",
          "Scroll the small box and watch the gutter: a visible scrollbar means hideScrollbars is not stamped here.",
          "Long-press the link in the callout card. On iOS, the preview sheet must appear in a browser tab and must NOT appear in an installed app or a native build.",
          "Try to select the image. It must be unselectable on every target, whatever the stamps say.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "All three absent by default, so text selects, scrollbars show, and the iOS callout works. That is deliberate: a browser user has to be able to select an error message and long-press a link.",
          },
          pwa: {
            verdict: "works",
            note: "All three stamped. A drag is a gesture here, not a selection. This is the target where the difference from the browser tab should be most obvious.",
          },
          ios: {
            verdict: "works",
            note: "All three stamped, and the callout one is only observable here — -webkit-touch-callout is WebKit-only and Blink never shipped it.",
          },
          android: {
            verdict: "partial",
            note: "noSelect and hideScrollbars stamped. touchCallout is stamped too but has no visible effect, because the property does not exist in Chromium — absent behaviour, correct stamp.",
          },
        }}
        wrong="Text is unselectable in a browser tab (the app answer applied to the web, which is hostile — the user cannot copy an error message). The `selectable` paragraph fails to select in an installed app, which means the utility layer is no longer beating the reset. Or an image highlights blue when you drag it, which will also break every gesture that starts on a thumbnail."
      />

      <LabSection
        title="Resolved stamps"
        description="config × platform, resolved once in the pre-paint script and written to <html>. The CSS is a single static rule keyed on the attribute — there is no per-config stylesheet."
      >
        {STAMPS.map(({ attr, option, effect }) => (
          <LabRow
            key={attr}
            label={attr}
            value={
              stamps === null ? (
                <LabBadge tone="muted">reading…</LabBadge>
              ) : (
                <LabBadge tone={stamps[attr] ? "ok" : "muted"}>
                  {stamps[attr] ? "stamped" : "absent"}
                </LabBadge>
              )
            }
            hint={`${option} — ${effect}`}
          />
        ))}
      </LabSection>

      <LabSection
        title="Try to select this paragraph"
        description="Long-press on touch, drag on desktop."
      >
        <p className="text-sm text-foreground">
          In a browser tab the default leaves selection alone, because a
          user has to be able to select an error message, hit Ctrl+A, and
          copy a code snippet. In an installed app a drag is a gesture, not
          a selection, so the reset applies.
        </p>
        <p className="selectable text-sm text-muted">
          This second paragraph carries the <code>selectable</code>{" "}
          utility, so it stays selectable on every target — utilities are a
          later cascade layer than adaptv&apos;s reset, so it wins on layer
          order alone, with no <code>!important</code> anywhere.
        </p>
      </LabSection>

      <LabSection
        title="Scroll this box"
        description="Whether it shows a scrollbar is the ui.hideScrollbars answer for this target."
      >
        <div className="max-h-24 overflow-y-auto rounded-md bg-secondary p-3 text-sm text-muted">
          {SCROLL_LINES.map((line) => (
            <p key={line}>Line {line} — scroll me and watch the gutter.</p>
          ))}
        </div>
      </LabSection>

      <LabSection title="Text fields are never affected">
        <input
          type="text"
          defaultValue="select this text — input, textarea and [contenteditable] always keep native selection"
          className="w-full rounded-md bg-secondary px-3 py-2 text-sm text-foreground"
        />
      </LabSection>

      <LabSection
        title="ui.touchCallout — long-press this link"
        description="In an installed app the iOS preview sheet is a browser artefact leaking through, and it fights any long-press gesture the app owns. In an iOS Safari tab it is a real affordance — long-press → copy link, open in new tab — that removing costs the user something. So it is stamped, not doctrine."
      >
        <a
          href="https://example.com"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-primary underline"
        >
          example.com — long-press me on iOS
        </a>
        <p className="text-xs text-muted">
          Nothing to see on Android or on desktop:{" "}
          <code>-webkit-touch-callout</code> is WebKit-only and Blink never
          shipped it. The stamp is still applied there; it simply matches
          nothing.
        </p>
      </LabSection>

      <LabSection
        title="Media is unselectable regardless of the knob"
        description="Doctrine, not taste. A selected image paints a blue wash over the picture, and a selection-drag that starts on one is the browser's cue to begin a native image drag — which steals the pointer and makes a Swipeable row with a thumbnail stop tracking the finger."
      >
        {/* an inline SVG rather than a bitmap: it needs no network, and `svg`
            is one of the four selectors the reset names */}
        <svg
          viewBox="0 0 120 48"
          role="img"
          aria-label="A test graphic"
          className="h-12 w-32 rounded-md"
        >
          <rect
            width="120"
            height="48"
            fill="currentColor"
            opacity="0.15"
          />
          <circle
            cx="24"
            cy="24"
            r="12"
            fill="currentColor"
            opacity="0.5"
          />
          <rect
            x="48"
            y="14"
            width="56"
            height="20"
            rx="4"
            fill="currentColor"
            opacity="0.35"
          />
        </svg>
        <p className="text-sm text-muted">
          Try to select the graphic above, and to drag it. Both must fail
          on every target — including a browser tab, where the{" "}
          <code>ui.noSelect</code> stamp is absent and the text around it
          selects perfectly well.
        </p>
      </LabSection>
    </LabPage>
  )
}
