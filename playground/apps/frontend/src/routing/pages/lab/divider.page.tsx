import { Divider } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabCaveat, LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/divider")({
  component: LabDividerPage,
})

/** Which `min-resolution` step of the stylesheet's ladder picked the hairline's scale. */
function densityBucket(): string {
  for (const step of [4, 3, 2]) {
    if (matchMedia(`(min-resolution: ${step}dppx)`).matches)
      return `${step}dppx`
  }
  return "1dppx"
}

function LabDividerPage() {
  const horizontal = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState<string | null>(null)

  const composited = useRef<HTMLDivElement>(null)
  const compositedChild = useRef<HTMLDivElement>(null)
  const plain = useRef<HTMLDivElement>(null)
  const [clipReadout, setClipReadout] = useState<string | null>(null)

  //measured after mount, never during render: the server has no screen to ask, and
  //a render-time `devicePixelRatio` would hydrate as a text mismatch
  useEffect(() => {
    const el = horizontal.current
    if (!el) return
    const dpr = window.devicePixelRatio
    //the bounding rect is AFTER the transform: the 1px border scaled to the density
    const painted = el.getBoundingClientRect().height
    setReadout(
      `dpr ${dpr} · border ${getComputedStyle(el).borderTopWidth} · drawn ${painted.toFixed(4)}px · ${(painted * dpr).toFixed(2)} device px · ${densityBucket()}`,
    )
  }, [])

  useEffect(() => {
    const a = composited.current
    const b = plain.current
    const child = compositedChild.current
    if (!a || !b || !child) return
    setClipReadout(
      `composited radius ${getComputedStyle(a).borderRadius} · plain radius ${getComputedStyle(b).borderRadius} · child transform ${getComputedStyle(child).transform}`,
    )
  }, [])

  return (
    <LabPage
      title="Divider"
      subtitle="A hairline rule that is one DEVICE pixel, a border rather than a background, and says what it is."
    >
      <LabBrief
        what="the hairline's width at this screen's density, its survival under forced colours, its orientation semantics, and a side probe of WebKit clipping a composited child to a rounded parent."
        steps={[
          "Read the hairline readout: `border` is the 1px the stylesheet draws as the engine snapped it to device pixels, `drawn` is that border after the density scale, and `device px` must read 1.00 — the rule is one physical pixel, never a CSS pixel.",
          "Look at the rules themselves. The horizontal one should be as thin as the rule between two rows of the platform's own Settings app; the vertical one must run the full height of its row.",
          "The red rule is a plain `border-red-500` on className — the colour is the consumer's, the width is not.",
          "Enable a high-contrast / forced-colours mode (Windows: Settings → Accessibility → Contrast themes). Every rule must stay visible; a background-drawn rule would vanish.",
          "Clip probe: the two boxes below must look identical — a rounded box with a filled inside. If the left one's corners are square, the engine is not clipping a composited child to its rounded parent.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "A 1x monitor reads `dpr 1 · border 1px · drawn 1.0000px · 1.00 device px · 1dppx`; a Retina display reads `dpr 2 · border 1px · drawn 0.5000px · 1.00 device px · 2dppx`. Both boxes of the clip probe are rounded.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab — the density and the engine do not change on install.",
          },
          ios: {
            verdict: "works",
            note: "A 3x phone reads `dpr 3 · border 1px · drawn 0.3333px · 1.00 device px · 3dppx`, and the rule is visibly as thin as the ones in the Settings app. The clip probe is the reason this page exists on device: WebKit has historically let a composited child escape a rounded `overflow-hidden` parent.",
          },
          android: {
            verdict: "works",
            note: "A Pixel reads `dpr 2.625 · border 0.761905px · drawn 0.3810px · 1.00 device px · 2dppx`: the WebView snaps the 1px border DOWN to two device pixels before the scale, which is why the scale is 1 over the floor of the ratio and the whole-number bucket is exact.",
          },
        }}
        wrong="`device px` reads 2.00 or 3.00 — the rule is a CSS pixel wide and visibly heavier than the platform's. The vertical rule is shorter than its row. A rule disappears under forced colours. The composited clip-probe box shows square corners while the plain one is rounded."
      />

      <LabSection
        title="Hairline"
        description="A horizontal rule between two rows. The readout is measured from it after mount."
      >
        <div className="flex flex-col">
          <p className="py-3 text-sm text-foreground">Above the rule</p>
          <Divider ref={horizontal} data-testid="divider-h" />
          <p className="py-3 text-sm text-foreground">Below the rule</p>
        </div>
        <LabRow
          label="hairline"
          value={<span data-testid="divider-readout">{readout}</span>}
          hint="dpr · the border as written · the border after the density scale · that in device pixels · the ladder step that matched"
        />
      </LabSection>

      <LabSection
        title="Vertical"
        description="orientation=&quot;vertical&quot; rules down a flex row and stretches to the row's height without being told it."
      >
        <div
          data-testid="divider-v-row"
          className="flex items-center gap-x-4"
        >
          <p className="py-6 text-sm text-foreground">Tall cell</p>
          <Divider orientation="vertical" data-testid="divider-v" />
          <p className="py-1 text-sm text-foreground">Short cell</p>
        </div>
      </LabSection>

      <LabSection
        title="Decorative and recoloured"
        description="`decorative` renders role=&quot;none&quot; and no orientation; any border-* colour utility repaints the rule."
      >
        <div className="flex flex-col gap-y-3">
          <p className="text-xs text-muted">
            decorative — seen, not announced
          </p>
          <Divider decorative data-testid="divider-decorative" />
          <p className="text-xs text-muted">
            className=&quot;border-red-500&quot;
          </p>
          <Divider
            className="border-red-500"
            data-testid="divider-colour"
          />
        </div>
        <LabCaveat>
          Under forced colours every rule on this page is recoloured to the
          system&apos;s text colour, including the red one — that is the
          engine doing its job, not the component losing the colour.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Clip probe"
        description="Not a Divider. Two rounded, overflow-hidden boxes with a filled child: the left child is composited (will-change-transform + translateZ(0)), the right is the plain control. They must look identical."
      >
        <div data-testid="clip-probe" className="flex flex-wrap gap-4">
          <div
            ref={composited}
            data-testid="clip-probe-composited"
            className="h-32 w-64 overflow-hidden rounded-2xl bg-primary"
          >
            <div
              ref={compositedChild}
              data-testid="clip-probe-child"
              className="h-full w-full bg-error will-change-transform"
              style={{ transform: "translateZ(0)" }}
            />
          </div>
          <div
            ref={plain}
            data-testid="clip-probe-plain"
            className="h-32 w-64 overflow-hidden rounded-2xl bg-primary"
          >
            <div className="h-full w-full bg-error" />
          </div>
        </div>
        <LabRow
          label="clip probe"
          value={
            <span data-testid="clip-probe-readout">{clipReadout}</span>
          }
        />
      </LabSection>
    </LabPage>
  )
}
