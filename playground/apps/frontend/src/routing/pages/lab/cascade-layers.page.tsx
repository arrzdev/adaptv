import { Image } from "@arrzdev/adaptv/components"
import { useEffect, useRef, useState } from "react"
import labPhotoTallUrl from "@/assets/lab-photo-tall.jpg?url"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabCascadeLayersPage,
})

const FIELD =
  "w-full rounded-md bg-secondary px-3 py-2 text-sm text-foreground"

function LabCascadeLayersPage() {
  return (
    <LabPage
      title="Cascade layers"
      subtitle="The one contract that, if it breaks, breaks silently and everywhere: adaptv ships no !important, so every rule it has must lose to anything the consuming app writes."
    >
      <LabBrief
        what="That an unlayered app rule beats an adaptv patch even when it is LESS specific, that a Tailwind utility beats a primitive's base, and that a primitive's locked classes still cannot be overridden."
        steps={[
          "Skim the “Layer order” card — it is context, not a verdict, because minification legitimately rewrites the statement. The two measured cards below are the test.",
          "Look at the two text fields: the second one carries an unlayered app class of LOWER specificity than adaptv's patch. Its computed line-height must be the app's, not adaptv's, and the field must visibly be taller.",
          "Long-press the two links in the tap-highlight card on a touch device. The second must flash orange; the first must flash nothing.",
          "Check the locked card: the Image below was given `static overflow-visible` by the app, and its computed position must still read `relative` — locked structure is the one thing a className may not take away.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Every row green. Cascade layers are Baseline-wide and have no platform behaviour of their own — this page is testing the BUILD, not the engine, which is why it looks identical everywhere it is correct.",
          },
          pwa: {
            verdict: "works",
            note: "Identical to the browser tab: same bundle, same stylesheet.",
          },
          ios: {
            verdict: "partial",
            note: "Same result, with one row that only means something here: the tap-highlight demo is a WebKit-only property, so it is the one card whose visible half exists on iOS and nowhere else.",
          },
          android: {
            verdict: "works",
            note: "Identical, and the tap highlight is visible here too — Chromium implements -webkit-tap-highlight-color as well.",
          },
        }}
        wrong="The unlayered field's computed line-height comes back as adaptv's 1.5 — that means adaptv's CSS is no longer inside its layer, or the layer order was lost, and every consumer override in every app has silently become a specificity fight that they will lose. The other direction is just as bad: if the Image's position reads `static`, `locked` has stopped locking and structural classes are now overridable by accident."
      />

      <LabSection
        title="Layer order"
        description="`@layer theme, base, adaptv, components, utilities;` must be the FIRST rule of the app's entry stylesheet — CSS fixes layer order by first mention, and a name first mentioned later is appended to the END rather than inserted. adaptv's vite plugin injects it. What shipped is below, for context only."
      >
        <LayerStatement />
      </LabSection>

      <LabSection
        title="1 · An unlayered app rule beats an adaptv patch"
        description="adaptv sets `input[type=text] { line-height: 1.5 }` in @layer adaptv.reset at specificity (0,1,1). The second field adds `.lab-unlayered-line-height { line-height: 3 }` from the app's own main.css — unlayered, and LESS specific. Unlayered wins anyway; that is the whole promise."
      >
        <LineHeightProbe />
      </LabSection>

      <LabSection
        title="2 · Same, for a patch you can feel"
        description="@layer adaptv.patches removes the grey tap flash from every a[href] — doctrine, because it is a second uglier press feedback on top of the one adaptv already draws. An app that wants it back just writes the rule."
      >
        <a href="#cascade-lab" className={`${FIELD} block`}>
          plain link — no flash on long-press
        </a>
        <a
          href="#cascade-lab"
          className={`${FIELD} lab-unlayered-tap-highlight block`}
        >
          link + unlayered app rule — flashes orange
        </a>
        <TapHighlightProbe />
      </LabSection>

      <LabSection
        title="3 · A utility beats a primitive's base; nothing beats its locked"
        description="Inside a primitive the split is enforced by mergeStyles, not by the cascade: `base` is what the component would look like if you said nothing, and a consumer class in the same conflict group replaces it. `locked` is applied last and cannot be replaced, because it is structure the component's own behaviour depends on."
      >
        <LockedProbe />
        <LabCaveat>
          The `base` half of this is tailwind-merge, not layer order — the
          conflicting default class is <em>removed</em> rather than
          out-cascaded. Worth knowing when you debug it: if a base class
          survives an override, the fix is a missing conflict group in{" "}
          <code>utils/cn.ts</code>, not a layer.
        </LabCaveat>
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/**
 * Every `@layer …;` statement in the stylesheets that actually shipped.
 *
 * INFORMATIONAL ONLY, and deliberately not graded. Lightning CSS rewrites the
 * source statement during minification — a production build of this app emits
 * `@layer adaptv,components;` rather than the five-name line the source
 * contains, because the other three names are already registered by the layered
 * blocks around them. Grading that string would fail a perfectly correct build,
 * which is worse than not grading it at all.
 *
 * The behavioural cards below are the real test: they measure what the cascade
 * DID, which is the only thing that matters and the only thing minification
 * cannot rewrite.
 *
 * Cross-origin sheets throw on `cssRules` (the Google Fonts import is one), so
 * every sheet is read in its own `try`.
 */
function LayerStatement() {
  //an id per hit rather than the text as a key: two sheets can legitimately
  //carry the same statement, and they are two facts, not one
  const [statements, setStatements] = useState<
    { id: string; text: string }[] | null
  >(null)

  useEffect(() => {
    const found: { id: string; text: string }[] = []
    for (const [index, sheet] of Array.from(
      document.styleSheets,
    ).entries()) {
      let rules: CSSRule[]
      try {
        rules = Array.from(sheet.cssRules)
      } catch {
        continue
      }
      for (const [position, rule] of rules.entries()) {
        //CSSLayerStatementRule is not in every lib.dom yet; the cssText shape
        //(`@layer a, b, c;`) is stable and is all this needs
        const text = rule.cssText.trim()
        if (text.startsWith("@layer ") && text.endsWith(";")) {
          found.push({ id: `${index}:${position}`, text })
        }
      }
    }
    setStatements(found)
  }, [])

  if (statements === null) {
    return <LabRow label="statements" value={null} />
  }

  return (
    <>
      {statements.length === 0 ? (
        <LabRow label="statements" value={null} />
      ) : (
        statements.map(({ id, text }, index) => (
          <LabRow key={id} label={`statement ${index + 1}`} value={text} />
        ))
      )}
      <LabCaveat>
        Read at runtime from <code>document.styleSheets</code>, so this is
        what shipped rather than what the source says — but it is{" "}
        <strong>not a verdict</strong>. A production build minifies the
        five-name statement down to whatever names are not already
        registered elsewhere, so <code>@layer adaptv,components;</code>{" "}
        here is normal and correct. Judge the cascade by the two measured
        cards below, not by this string.
      </LabCaveat>
    </>
  )
}

function LineHeightProbe() {
  const patchedRef = useRef<HTMLInputElement>(null)
  const overriddenRef = useRef<HTMLInputElement>(null)
  const [values, setValues] = useState<{
    patched: string
    overridden: string
  } | null>(null)

  useEffect(() => {
    if (!patchedRef.current || !overriddenRef.current) return
    setValues({
      patched: getComputedStyle(patchedRef.current).lineHeight,
      overridden: getComputedStyle(overriddenRef.current).lineHeight,
    })
  }, [])

  const won =
    values !== null &&
    values.patched !== values.overridden &&
    Number.parseFloat(values.overridden) >
      Number.parseFloat(values.patched)

  return (
    <>
      <input
        ref={patchedRef}
        type="text"
        defaultValue="adaptv's line-height: 1.5"
        className={FIELD}
      />
      <input
        ref={overriddenRef}
        type="text"
        defaultValue="the app's unlayered line-height: 3"
        className={`${FIELD} lab-unlayered-line-height`}
      />
      <LabRow
        label="adaptv.reset (0,1,1)"
        value={values?.patched ?? null}
      />
      <LabRow
        label="app, unlayered (0,1,0)"
        value={values?.overridden ?? null}
      />
      <LabRow
        label="verdict"
        value={
          values === null ? (
            <LabBadge tone="muted">measuring…</LabBadge>
          ) : (
            <LabBadge tone={won ? "ok" : "bad"}>
              {won
                ? "the app won, at lower specificity"
                : "ADAPTV WON — layers are broken"}
            </LabBadge>
          )
        }
      />
    </>
  )
}

function TapHighlightProbe() {
  const ref = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current?.querySelector("a")
    if (!node) return
    setValue(
      getComputedStyle(node).getPropertyValue(
        "-webkit-tap-highlight-color",
      ) || null,
    )
  }, [])

  return (
    <div ref={ref}>
      <a
        href="#cascade-lab"
        className="lab-unlayered-tap-highlight hidden"
      >
        probe
      </a>
      <LabRow
        label="-webkit-tap-highlight-color (overridden link)"
        value={value}
        hint="Firefox and desktop Safari do not implement this property at all, so `not reported here` on a desktop browser is expected. The visible test is a long-press on a phone."
      />
    </div>
  )
}

function LockedProbe() {
  const imageRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<string | null>(null)

  useEffect(() => {
    const root = imageRef.current?.firstElementChild
    if (root instanceof HTMLElement) {
      setPosition(getComputedStyle(root).position)
    }
  }, [])

  return (
    <>
      <div ref={imageRef} className="w-24">
        {/* the app asks for `static` and `overflow-visible`; both are in
            Image's locked layout class, so both requests are dropped */}
        <Image
          src={labPhotoTallUrl}
          aspectRatio={1}
          alt=""
          className="static overflow-visible rounded-md"
        />
      </div>
      <LabRow
        label="Image root, asked for `static`"
        value={
          position === null ? (
            <LabBadge tone="muted">measuring…</LabBadge>
          ) : (
            <LabBadge tone={position === "relative" ? "ok" : "bad"}>
              {position}
            </LabBadge>
          )
        }
        hint="`relative` is correct: it is what makes every layer inside the image one card in a single stack. If this reads `static` the slots will escape the box."
      />
    </>
  )
}
