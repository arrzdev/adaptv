import type {
  AdaptvImageAsset,
  ImageFit,
} from "@arrzdev/adaptv/components"
import { Image } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import type { ReactNode } from "react"
import { useLayoutEffect, useRef, useState } from "react"
import labPhoto from "@/assets/lab-photo.jpg?adaptv-image"
import labPhotoTallUrl from "@/assets/lab-photo-tall.jpg?url"
import labPhotoWideUrl from "@/assets/lab-photo-wide.jpg?url"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/image")({
  component: LabImagePage,
})

const FITS: readonly ImageFit[] = [
  "cover",
  "contain",
  "fill",
  "none",
  "scale-down",
]

/** A 404 on every target: no such file is emitted, on the web or in the bundle. */
const MISSING_URL = "/lab/this-image-does-not-exist.jpg"

function LabImagePage() {
  //Per-card reload. A page-wide nonce was not enough: after the first pass every
  //image is warm, decodes instantly, and the blurred placeholder is never on screen
  //long enough to look at — which is the whole thing this page exists to show. Each
  //card gets its own button so one image can be re-run without disturbing the rest.
  //
  //TWO things are needed together. `?v=n` defeats the HTTP cache, and the bumped
  //`key` remounts the component — without the remount React keeps the same <img>
  //and the load state never returns to "loading".
  //
  //A STATIC IMPORT can be busted too, contrary to an earlier note here: it is an
  //object, so spreading it and rewriting `src` keeps `width`/`height`/`lqip` intact
  //while changing the URL. That matters, because the static import is the only card
  //where the placeholder comes from the build pipeline rather than from a prop.
  const [nonces, setNonces] = useState<Record<string, number>>({})
  const nonceOf = (card: string) => nonces[card] ?? 0
  const reload = (card: string) =>
    setNonces((n) => ({ ...n, [card]: (n[card] ?? 0) + 1 }))
  const bustUrl = (card: string, url: string) => {
    const n = nonceOf(card)
    return n === 0 ? url : `${url}${url.includes("?") ? "&" : "?"}v=${n}`
  }
  const bustAsset = (card: string, asset: AdaptvImageAsset) => {
    const n = nonceOf(card)
    return n === 0 ? asset : { ...asset, src: bustUrl(card, asset.src) }
  }

  return (
    <LabPage
      title="Image"
      subtitle="The claim is that the box exists before the bytes do. Every card below puts a hard rule and a caption DIRECTLY under the image, so a shift moves something you are already looking at."
    >
      <LabBrief
        what="That an <Image> reserves its final box on the first frame, so nothing below it ever moves — from a static import, from an aspect ratio, and from a positioned parent."
        steps={[
          "Read the reserved/now numbers under each image before doing anything: they are the wrapper height at first layout and right now, and they must be equal.",
          "Press “Re-fetch the string images”. The blurred placeholder should appear, then the photo fades in — and the caption under it must not move by a pixel.",
          "Throttle to Slow 3G (browser DevTools) or turn Wi-Fi off and on, then press it again: the placeholder now lasts long enough to watch properly.",
          "Scroll the whole page slowly to the bottom and back. Nothing should jump as lazy images below the fold decode.",
          "Check the last two cards: the 404 must land on the red error slot, and the null src must show the invalid slot — both inside a box that already had the right size.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Reserved == now on every card. The blur is a 16px WebP baked at build time, so it paints in the same frame as the HTML — never a flash of empty box.",
          },
          pwa: {
            verdict: "works",
            note: "Identical to the browser tab: this is all layout and one <img>, with no platform branch anywhere in the component.",
          },
          ios: {
            verdict: "works",
            note: "Identical box behaviour. Note WKWebView never fires layout-shift entries, so DevTools cannot score this — the reserved/now numbers on the page are the measurement on iOS.",
          },
          android: {
            verdict: "works",
            note: "Identical. This is the one target where chrome://inspect can also show real CLS regions, if you want a second opinion.",
          },
        }}
        wrong="The caption under an image drops down (or the page grows) the moment the photo decodes; or a card shows reserved 0.0px; or the root element carries data-image-unreserved. Any one of those means the box was not reserved and the component's whole reason for existing has regressed."
      />

      <LabSection
        title="1 · A static import, and nothing else"
        description={
          <>
            <LabActions>
              <LabButton onClick={() => reload("static")}>
                Reload (nonce {nonceOf("static")})
              </LabButton>
            </LabActions>
            <code>
              {'import photo from "./lab-photo.jpg?adaptv-image"'}
            </code>{" "}
            then <code>{"<Image src={photo} />"}</code>. No width, no
            height, no ratio: the build measured the file and the blur rode
            along.
          </>
        }
      >
        <ShiftWatch caption="1200 × 800 · reserved from the asset">
          <Image
            src={bustAsset("static", labPhoto)}
            key={nonceOf("static")}
            alt="A generated test photo"
            className="rounded-md"
          />
        </ShiftWatch>
        <LabRow label="asset.width" value={`${labPhoto.width}px`} />
        <LabRow label="asset.height" value={`${labPhoto.height}px`} />
        <LabRow
          label="asset.lqip"
          value={
            labPhoto.lqip ? `${labPhoto.lqip.length} B data: URL` : null
          }
          hint="Absent for vectors, animations and sources under 40px. A missing placeholder is cosmetic; a missing dimension would be a layout shift."
        />
      </LabSection>

      <LabSection
        title="2 · A URL string with aspectRatio"
        description="The remote-image case: adaptv never saw the file, so the caller supplies the ratio. The URL below is served over HTTP exactly like a remote one — same code path, but it still resolves with the network off, which a real remote host would not."
      >
        <LabActions>
          <LabButton onClick={() => reload("placeholder")}>
            Reload (nonce {nonceOf("placeholder")})
          </LabButton>
        </LabActions>
        <ShiftWatch caption="aspectRatio={16 / 9} · reserved from the ratio">
          <Image
            src={bustUrl("placeholder", labPhotoWideUrl)}
            key={nonceOf("placeholder")}
            aspectRatio={16 / 9}
            alt="A generated test photo, sixteen by nine"
            className="rounded-md"
          >
            <Image.Placeholder>
              <span className="absolute inset-x-0 bottom-2 text-center text-xs font-medium text-white/90">
                Image.Placeholder — chrome over the blur
              </span>
            </Image.Placeholder>
          </Image>
        </ShiftWatch>
        <LabCaveat>
          There is no build-time blur for a string src, so this card paints
          a flat grey surface until the bytes land. That is expected — the
          reservation is doctrine, the blur is a build-time bonus.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="3 · fill, inside a relative h-64 parent"
        description="fill reserves nothing itself — it stretches to a box somebody else owns. The parent below is the thing with the height, and it is the one form with a genuine runtime failure mode."
      >
        <LabActions>
          <LabButton onClick={() => reload("fill")}>
            Reload (nonce {nonceOf("fill")})
          </LabButton>
        </LabActions>
        <ShiftWatch caption="the PARENT is h-64; the image has no ratio of its own">
          <div className="relative h-64 overflow-hidden rounded-md">
            <Image
              src={bustUrl("fill", labPhotoWideUrl)}
              key={nonceOf("fill")}
              fill
              alt="A generated test photo, filling its parent"
            />
          </div>
        </ShiftWatch>
      </LabSection>

      <LabSection
        title="4 · All five fit values"
        description="A 700 × 1100 portrait source in a square box, so the five are actually distinguishable. fit is a prop rather than a class because the placeholder's background-size must agree with the img's object-fit or the blur→photo swap is itself a jump."
      >
        <LabActions>
          <LabButton onClick={() => reload("fit")}>
            Reload (nonce {nonceOf("fit")})
          </LabButton>
        </LabActions>
        <div className="grid grid-cols-2 gap-3">
          {FITS.map((fit) => (
            <div key={fit} className="flex flex-col gap-y-1">
              <Image
                src={bustUrl("fit", labPhotoTallUrl)}
                key={`${fit}-${nonceOf("fit")}`}
                aspectRatio={1}
                fit={fit}
                alt={`Fit ${fit}`}
                className="rounded-md"
              />
              <span className="text-center font-mono text-xs text-muted">
                {fit}
              </span>
            </div>
          ))}
        </div>
        <LabRow
          label="what you should see"
          value="cover ≠ contain ≠ fill"
          hint="cover crops top and bottom; contain letterboxes with grey bands; fill squashes the photo; none shows a 1:1 centre crop; scale-down matches contain here."
        />
      </LabSection>

      <LabSection
        title="5 · placeholder={false}"
        description="Same static import as card 1, with the blur switched off. The box is still reserved — that is the point of the pair."
      >
        <LabActions>
          <LabButton onClick={() => reload("noplaceholder")}>
            Reload (nonce {nonceOf("noplaceholder")})
          </LabButton>
        </LabActions>
        <ShiftWatch caption="no blur, same reservation">
          <Image
            src={bustAsset("noplaceholder", labPhoto)}
            key={nonceOf("noplaceholder")}
            placeholder={false}
            alt="A generated test photo with no placeholder"
            className="rounded-md"
          />
        </ShiftWatch>
      </LabSection>

      <LabSection
        title="6 · A deliberate 404 → Image.Error"
        description={`src="${MISSING_URL}" — a file that exists on no target.`}
      >
        <LabActions>
          <LabButton onClick={() => reload("error")}>
            Reload (nonce {nonceOf("error")})
          </LabButton>
        </LabActions>
        <ShiftWatch caption="the box was reserved before the request failed">
          <Image
            src={bustUrl("error", MISSING_URL)}
            key={nonceOf("error")}
            aspectRatio={16 / 9}
            alt="An image that cannot load"
            className="rounded-md"
          >
            <Image.Error>
              <span className="flex size-full items-center justify-center text-sm font-medium text-error">
                Image.Error — could not load
              </span>
            </Image.Error>
          </Image>
        </ShiftWatch>
      </LabSection>

      <LabSection
        title="7 · src={null} → Image.Invalid"
        description="An image whose URL has not arrived yet still has a box. That is the whole claim, in its smallest form."
      >
        <ShiftWatch caption="reserved with no src at all">
          <Image
            src={null}
            aspectRatio={16 / 9}
            alt=""
            className="rounded-md"
          >
            <Image.Invalid>
              <span className="flex size-full items-center justify-center text-sm font-medium text-subtle">
                Image.Invalid — no src
              </span>
            </Image.Invalid>
          </Image>
        </ShiftWatch>
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * SHIFT WATCH
 * ============================================================================= */

/**
 * `docs/design/image.md §10.2`, rendered live: measure the box at first layout,
 * measure it again whenever it changes, and print both.
 *
 * This is on the page rather than in DevTools because the Layout Instability API
 * does not exist in WebKit and never has — on iOS these two numbers ARE the
 * measurement. The hard rule and the caption underneath are the second, cruder
 * instrument: a shift has to move something the eye is already resting on.
 */
function ShiftWatch({
  caption,
  children,
}: {
  caption: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [reserved, setReserved] = useState<number | null>(null)
  const [now, setNow] = useState<number | null>(null)

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const first = node.getBoundingClientRect().height
    setReserved(first)
    setNow(first)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setNow(entry.contentRect.height)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  //a sub-pixel wobble is the browser rounding a percentage box, not a shift
  const stable =
    reserved !== null && now !== null && Math.abs(reserved - now) < 1

  return (
    <div className="flex flex-col">
      <div ref={ref}>{children}</div>
      {/* the rule sits flush against the image on purpose — a shift of even a
          few px is visible against a 1px line, and invisible against a gap */}
      <div className="border-t border-border-strong" aria-hidden />
      <div className="flex items-baseline justify-between gap-x-3 pt-1">
        <span className="min-w-0 truncate text-xs text-muted">
          {caption}
        </span>
        <span className="shrink-0 font-mono text-xs">
          {reserved === null ? (
            <LabBadge tone="muted">measuring…</LabBadge>
          ) : (
            <LabBadge tone={stable ? "ok" : "bad"}>
              {`reserved ${reserved.toFixed(1)} → now ${now?.toFixed(1)}`}
            </LabBadge>
          )}
        </span>
      </div>
    </div>
  )
}
