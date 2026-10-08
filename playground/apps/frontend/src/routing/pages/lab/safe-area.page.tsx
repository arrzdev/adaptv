import { View } from "adaptv/components"
import { useInsets } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabBadge,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/safe-area")({
  component: LabSafeAreaPage,
})

/**
 * The utilities under test, each with the arithmetic it claims to do.
 *
 * `expected` is a function of the measured inset rather than a constant, so the
 * page can grade itself on a device it has never seen. `--spacing` is Tailwind's
 * default 0.25rem = 4px, so `offset-4` is inset + 16px and `or-8` is
 * max(inset, 32px).
 */
const TOP_UTILITIES = [
  {
    className: "pt-safe",
    label: "pt-safe",
    expected: (inset: number) => inset,
    hint: "the raw inset",
  },
  {
    className: "pt-safe-offset-4",
    label: "pt-safe-offset-4",
    expected: (inset: number) => inset + 16,
    hint: "inset + 16px — content that must clear the notch AND breathe",
  },
  {
    className: "pt-safe-or-8",
    label: "pt-safe-or-8",
    expected: (inset: number) => Math.max(inset, 32),
    hint: "max(inset, 32px) — a floor for the devices that have no inset",
  },
] as const

function LabSafeAreaPage() {
  const insets = useInsets()

  return (
    <LabPage
      title="Safe area"
      subtitle="One contract, four numbers, and about ninety utilities built on them. The failure mode is a title tucked under a notch on exactly one device, which is why the numbers are printed rather than eyeballed."
    >
      <LabBrief
        what="That the four --adaptv-inset-* variables carry the real device insets, that the p-safe / -safe-offset-N / -safe-or-N families compute from them, and that useInsets agrees with the CSS to the pixel."
        steps={[
          "Compare the useInsets numbers with the measured CSS numbers in the next card. Every row must say `agrees`.",
          "Look at the three top-padding probes: each prints what it measured and what it should be, and grades itself.",
          "Rotate the device to landscape and back. On a notched phone the left/right insets become non-zero in landscape and the top usually shrinks — every number on the page must follow, live, with no reload.",
          "Scroll to the coloured bar at the bottom and check that the orange band is exactly the unsafe region: on a home-indicator phone it should sit under the indicator, not somewhere near it.",
          "On iOS, also check the top of THIS page's header — the shell pads with the safe area, so the title must never be under the status bar.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "On a desktop browser all four insets are 0, and every row still has to agree — 0 == 0 is a real pass here, and -safe-or-8 must still show its 32px floor. On mobile Safari in a tab the bottom inset is non-zero and changes as the address bar collapses.",
          },
          pwa: {
            verdict: "works",
            note: "The real insets, from env(safe-area-inset-*) with viewport-fit=cover. This is where a notch first shows up on iOS, because a Safari tab hides most of it behind chrome.",
          },
          ios: {
            verdict: "works",
            note: "Real insets from env(). iOS injects no CSS variable of its own, so the var(--safe-area-inset-top, env(...)) chain falls through to the env() half — which is the fallback, not the primary, and that ordering is deliberate.",
          },
          android: {
            verdict: "works",
            note: "Real insets, but from the OTHER half of the chain: Capacitor's SystemBars plugin injects --safe-area-inset-* on <html> because env() reads 0 in Android WebView below 140. If the numbers are 0 on a gesture-nav Android device, that injection is what is missing.",
          },
        }}
        wrong="A useInsets number and its CSS measurement disagree (they read the same variables; a mismatch means one of the two paths is broken). Every inset is 0 on a device that visibly has a notch or a home indicator — on Android that is the injected variable missing, on iOS it is viewport-fit=cover missing. Or the numbers do not change on rotation, which means nothing is subscribed."
      />

      <LabSection
        title="useInsets() vs the CSS"
        description="The hook does not read the custom properties directly — a var()/env() chain's computed value is engine-dependent and happy-dom returns the literal text. It hands the vars to a real padding property on four throwaway probes and reads the used value back, because a used value is always an absolute px length."
      >
        <InsetAgreement insets={insets} />
      </LabSection>

      <LabSection
        title="The three top-padding families"
        description="Every one of these is measured on a real element below, not computed in JS from the hook."
      >
        {TOP_UTILITIES.map((utility) => (
          <PaddingProbe
            key={utility.className}
            className={utility.className}
            label={utility.label}
            hint={utility.hint}
            expected={utility.expected(insets.top)}
          />
        ))}
      </LabSection>

      <LabSection
        title="View's `safe` prop"
        description="The same utilities, reached from a prop, and applied as `locked` — structural padding wins over className because a View that was asked to clear the notch and did not is broken, not restyled."
      >
        <View
          safe="all"
          className="rounded-md bg-secondary p-0 text-sm text-foreground"
        >
          <span className="block bg-primary/20">
            {'<View safe="all" className="p-0" />'} — the p-0 is
            deliberately fighting the prop, and must lose
          </span>
        </View>
        <SafePropProbe />
      </LabSection>

      <LabSection
        title="See the band"
        description="The orange strip is the bottom inset, drawn at full width. On a home-indicator phone it should be exactly the strip the indicator lives in."
      >
        <div className="overflow-hidden rounded-md bg-secondary">
          <div className="px-3 py-6 text-center text-sm text-foreground">
            content
          </div>
          <div className="bg-primary/40 pb-safe">
            <div className="h-px" aria-hidden />
          </div>
        </div>
        <LabCaveat>
          This page is inside a scroller with its own safe padding, so the
          band is a measurement of the VARIABLE, not of where the indicator
          physically is. To check the real edge, look at the app&apos;s own
          bottom edge on the Tasks screen — a scroller that ends flush
          under the indicator is the bug this contract exists to stop.
        </LabCaveat>
      </LabSection>

      <LabSection title="The raw variables">
        <RawVariables />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

const SIDES = ["top", "right", "bottom", "left"] as const

function InsetAgreement({
  insets,
}: {
  insets: { top: number; right: number; bottom: number; left: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [css, setCss] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () => {
      const style = getComputedStyle(node)
      setCss({
        top: Number.parseFloat(style.paddingTop),
        right: Number.parseFloat(style.paddingRight),
        bottom: Number.parseFloat(style.paddingBottom),
        left: Number.parseFloat(style.paddingLeft),
      })
    }
    measure()
    //rotation and the collapsing mobile address bar both change the insets
    //without changing anything React knows about
    window.addEventListener("resize", measure)
    window.addEventListener("orientationchange", measure)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("orientationchange", measure)
    }
  }, [])

  return (
    <>
      {/* a zero-height p-safe probe: it contributes the four insets as real
          padding, which is the only reading that is an absolute px length on
          every engine */}
      <div ref={ref} className="p-safe" aria-hidden />
      {SIDES.map((side) => {
        const hook = insets[side]
        const measured = css?.[side]
        const agrees =
          measured !== undefined && Math.abs(measured - hook) < 0.5
        return (
          <LabRow
            key={side}
            label={side}
            value={
              css === null ? (
                <LabBadge tone="muted">measuring…</LabBadge>
              ) : (
                <LabBadge tone={agrees ? "ok" : "bad"}>
                  {`${hook}px hook · ${measured?.toFixed(1)}px css · ${agrees ? "agrees" : "DISAGREES"}`}
                </LabBadge>
              )
            }
          />
        )
      })}
    </>
  )
}

function PaddingProbe({
  className,
  label,
  hint,
  expected,
}: {
  className: string
  label: string
  hint: string
  expected: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = () =>
      setMeasured(Number.parseFloat(getComputedStyle(node).paddingTop))
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [])

  const correct = measured !== null && Math.abs(measured - expected) < 0.5

  return (
    <>
      <div ref={ref} className={className} aria-hidden />
      <LabRow
        label={label}
        value={
          measured === null ? (
            <LabBadge tone="muted">measuring…</LabBadge>
          ) : (
            <LabBadge tone={correct ? "ok" : "bad"}>
              {`${measured.toFixed(1)}px · expected ${expected.toFixed(1)}px`}
            </LabBadge>
          )
        }
        hint={hint}
      />
    </>
  )
}

function SafePropProbe() {
  const ref = useRef<HTMLDivElement>(null)
  const [padding, setPadding] = useState<string | null>(null)

  useEffect(() => {
    const node = ref.current?.previousElementSibling
    if (node instanceof HTMLElement) {
      const style = getComputedStyle(node)
      setPadding(
        `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      )
    }
  }, [])

  return (
    <div ref={ref}>
      <LabRow
        label="resolved padding"
        value={padding}
        hint="Must equal the four insets, not 0px 0px 0px 0px. On a device with no insets all five values are 0 and this card proves nothing — check it on a phone."
      />
    </div>
  )
}

function RawVariables() {
  const [values, setValues] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const style = getComputedStyle(document.documentElement)
    setValues(
      Object.fromEntries(
        [
          "--adaptv-inset-top",
          "--adaptv-inset-right",
          "--adaptv-inset-bottom",
          "--adaptv-inset-left",
          "--safe-area-inset-top",
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      ),
    )
  }, [])

  return (
    <>
      {values === null ? (
        <p className="text-sm text-muted italic">reading…</p>
      ) : (
        Object.entries(values).map(([name, value]) => (
          <LabRow key={name} label={name} value={value} />
        ))
      )}
      <LabCaveat>
        These four are read straight off <code>:root</code>, and what a{" "}
        <code>var()</code>/<code>env()</code> chain serialises to is
        engine-dependent — Chrome substitutes and returns <code>0px</code>,
        other engines hand back the literal text. Treat this card as
        informational and the measured cards above as the result.{" "}
        <code>--safe-area-inset-top</code> is the Capacitor-injected one:
        present on Android, absent on iOS and on the web, and that absence
        is correct.
      </LabCaveat>
    </>
  )
}
