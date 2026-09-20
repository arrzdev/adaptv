import { Collapsible } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import type { RefObject } from "react"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
  useClientValue,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/collapsible")({
  component: LabCollapsiblePage,
})

/**
 * The text find-in-page must reach while the panel is closed. Unique on purpose:
 * the e2e greps the SERVER html for it and asserts it sits under `hidden`.
 */
const NEEDLE = "until-found-needle-7f3a"

const TRIGGER_CLASS =
  "clickable flex w-full items-center justify-between gap-x-3 px-3 py-2 text-start text-sm font-medium text-foreground"

/**
 * Rotates with the root's `data-collapsible-open`, no JS: the root carries `group`,
 * and a presence attribute is what Tailwind v4's bare variant reads — no brackets.
 */
function Chevron() {
  return (
    <span
      aria-hidden
      className="shrink-0 text-subtle transition-transform duration-200 group-data-collapsible-open:rotate-180"
    >
      ▾
    </span>
  )
}

function LabCollapsiblePage() {
  return (
    <LabPage
      title="Collapsible"
      subtitle="A disclosure that animates to a MEASURED height and then lets go of it, keeps its closed content in the document for find-in-page, and flips in one commit under reduced motion."
    >
      <LabBrief
        what="The open/close height transition, the `hidden` → `until-found` upgrade that keeps closed content searchable, the resting state that carries no inline height, and the controlled/uncontrolled/disabled contract."
        steps={[
          "Tap the Uncontrolled row. The panel must slide open over ~200 ms — not jump — and the chevron must rotate with it. Tap again: it slides shut, and only THEN goes hidden.",
          "In Controlled, tap the row and watch the counter and last value. Then press “open” and “close”: the panel must follow the buttons, and the counter must NOT move for them (the owner set state directly; nothing was asked).",
          "In “Content that grows”, press “add a line” a few times. The panel must grow with each line and the inline-height row must read ABSENT the whole time — a panel that clips its own new content is the bug this proves out.",
          "Tap the Disabled row. Nothing moves, aria-expanded stays false.",
          "In “Find in page”, use the browser's find (⌘F / Ctrl+F on desktop, the share sheet's “Find on Page” on iOS) for the needle text printed on the card. On engines with until-found the closed panel opens itself. Elsewhere, press “dispatch beforematch” to fire the same path by hand: it must open INSTANTLY, no slide.",
          "Enable Reduce Motion in the OS (or DevTools rendering → prefers-reduced-motion) and reload. Every open/close must now flip in one frame with no transition phase.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. Chromium and Firefox honour `hidden=until-found` (support row reads true), so the browser's own find reaches the closed needle and opens the panel; A Safari without it (the iOS 18 floor; current desktop WebKit has it) reads false and the closed panel is plain `hidden`, which find-in-page skips — use the dispatch button there.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab for the engine underneath. An installed app has no find bar of its own, so the dispatch button is the way to exercise beforematch here.",
          },
          ios: {
            verdict: "works",
            note: "The transition, the resting auto height, reduced motion and the controlled contract all work. iOS 18 WebKit has no until-found, so the support row reads false, the closed panel is plain `hidden`, and Safari's Find on Page does not reach the needle. That is the engine, not the component — there is nothing to fix client-side; the dispatch button proves the beforematch path still works.",
          },
          android: {
            verdict: "works",
            note: 'Everything, including until-found: the WebView floor is Chromium 119 and until-found shipped in 102. The support row reads true and the closed panel carries hidden="until-found".',
          },
        }}
        wrong="A panel that jumps open or shut instead of animating (with Reduce Motion OFF). A grown panel whose new lines are clipped, or an inline-height row that reads present while the panel is open at rest. A panel that ends closed WITHOUT `hidden`, or open WITH it. A chevron that does not follow data-collapsible-open. A beforematch that slides instead of snapping open."
      />

      <UncontrolledSection />
      <ControlledSection />
      <GrowsSection />
      <DisabledSection />
      <UntilFoundSection />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={
            <>
              <LabBadge tone="ok">collapsible</LabBadge>
              <LabBadge tone="ok">collapsible-trigger</LabBadge>
              <LabBadge tone="ok">collapsible-panel</LabBadge>
            </>
          }
          hint="Root, trigger and panel — target any of them from global CSS with no imports."
        />
        <LabRow
          label="data-collapsible-open"
          value="present | absent"
          hint="On all three while open, valueless, gone while closed — a presence attribute namespaced per component (styling.md §3.1). It is what the chevron above keys its rotation on, through the root's `group` and the bare `group-data-collapsible-open:` variant."
        />
        <LabRow
          label="data-disabled"
          value="present | absent"
          hint="On the root and the trigger while disabled, next to the native `disabled` on the button."
        />
        <LabRow
          label="data-collapsible-opening · data-collapsible-closing"
          value="one while sliding · neither at rest"
          hint="On the panel only while a height transition is running, one or the other. Neither under reduced motion, neither after beforematch, neither at rest — so an open panel is never clipped by a stale inline height."
        />
        <LabRow
          label="--collapsible-duration"
          value="200ms"
          hint="Override on the panel (className or style) to retune the slide."
        />
        <LabRow
          label="--collapsible-easing"
          value="the default ease"
          hint="Same place. The trigger has no look of its own — both style tiers are undefined — so all of its styling is your className."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * SECTIONS
 * ============================================================================= */

function UncontrolledSection() {
  return (
    <LabSection
      title="Uncontrolled"
      description="defaultOpen={false}. The component owns the state; the chevron follows data-collapsible-open on the root through `group`."
    >
      <Collapsible className="group rounded-md bg-secondary">
        <Collapsible.Trigger className={TRIGGER_CLASS}>
          <span>Uncontrolled — tap to toggle</span>
          <Chevron />
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <div className="flex flex-col gap-y-1 px-3 pb-3 text-sm text-muted">
            <p>
              First line — the panel slides to this content's measured
              height.
            </p>
            <p>
              Second line — then the inline height is dropped, so it rests
              at auto.
            </p>
            <p>
              Third line — closing measures again, slides to 0, then hides.
            </p>
          </div>
        </Collapsible.Panel>
      </Collapsible>
    </LabSection>
  )
}

function ControlledSection() {
  const [open, setOpen] = useState(false)
  const [calls, setCalls] = useState(0)
  const [last, setLast] = useState<boolean | null>(null)

  return (
    <LabSection
      title="Controlled"
      description="`open` + `onOpenChange`. The trigger asks; the owner decides. The two buttons set state directly, so they never go through onOpenChange."
    >
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          setCalls((n) => n + 1)
          setLast(next)
          setOpen(next)
        }}
        className="group rounded-md bg-secondary"
      >
        <Collapsible.Trigger className={TRIGGER_CLASS}>
          <span>Controlled — the owner decides</span>
          <Chevron />
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <div className="px-3 pb-3 text-sm text-muted">
            <p>
              Open only because the owner's state says so — the buttons
              below move it without a single onOpenChange call.
            </p>
          </div>
        </Collapsible.Panel>
      </Collapsible>
      <LabRow
        label="open"
        value={
          <LabBadge tone={open ? "ok" : "muted"}>{String(open)}</LabBadge>
        }
      />
      <LabRow label="onOpenChange calls" value={String(calls)} />
      <LabRow
        label="last value"
        value={last === null ? null : String(last)}
        hint="null until the trigger has asked once. The buttons must not change it."
      />
      <LabActions>
        <LabButton onClick={() => setOpen(true)}>open</LabButton>
        <LabButton onClick={() => setOpen(false)}>close</LabButton>
      </LabActions>
    </LabSection>
  )
}

function GrowsSection() {
  const hostRef = useRef<HTMLDivElement>(null)
  const probe = usePanelProbe(hostRef)
  const [lines, setLines] = useState(1)

  return (
    <LabSection
      title="Content that grows"
      description="Open at rest carries NO inline height, so content that arrives later is not clipped. Press the button and watch the panel and the readout grow together."
    >
      <div ref={hostRef}>
        <Collapsible defaultOpen className="group rounded-md bg-secondary">
          <Collapsible.Trigger className={TRIGGER_CLASS}>
            <span>Grows — open at rest</span>
            <Chevron />
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div className="flex flex-col gap-y-1 px-3 pb-3 text-sm text-muted">
              {Array.from({ length: lines }, (_, i) => (
                <p key={String(i)}>
                  Line {i + 1} — added after the panel settled, and not
                  clipped.
                </p>
              ))}
            </div>
          </Collapsible.Panel>
        </Collapsible>
      </div>
      <LabActions>
        <LabButton onClick={() => setLines((n) => n + 1)}>
          add a line
        </LabButton>
      </LabActions>
      <LabRow
        label="panel clientHeight"
        value={probe ? `${probe.clientHeight}px` : undefined}
      />
      <LabRow
        label="inline height"
        value={
          probe === null ? undefined : (
            <LabBadge tone={probe.inlineHeight === "" ? "ok" : "bad"}>
              {probe.inlineHeight === "" ? "absent" : probe.inlineHeight}
            </LabBadge>
          )
        }
        hint="Must read ABSENT whenever the panel is at rest. Present only during a transition."
      />
    </LabSection>
  )
}

function DisabledSection() {
  return (
    <LabSection
      title="Disabled"
      description="disabled on the root. The trigger is a real disabled button: no click, no keyboard, no state change."
    >
      <Collapsible disabled className="group rounded-md bg-secondary">
        <Collapsible.Trigger
          className={`${TRIGGER_CLASS} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          <span>Disabled — nothing happens</span>
          <Chevron />
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <div className="px-3 pb-3 text-sm text-muted">
            <p>If you can read this, disabled did not hold.</p>
          </div>
        </Collapsible.Panel>
      </Collapsible>
    </LabSection>
  )
}

function UntilFoundSection() {
  const hostRef = useRef<HTMLDivElement>(null)
  const probe = usePanelProbe(hostRef)
  //resolved through useSyncExternalStore with a server snapshot: the server has no
  //document, and reading it during render would mismatch the hydration
  const supportsBeforematch = useClientValue(
    () => "onbeforematch" in document.body,
    false,
  )

  function dispatchBeforematch() {
    hostRef.current
      ?.querySelector('[data-adaptv="collapsible-panel"]')
      ?.dispatchEvent(new Event("beforematch"))
  }

  return (
    <LabSection
      title="Find in page (until-found)"
      description="The closed panel's text stays in the document. On engines with hidden=until-found the browser's own find reaches it and fires beforematch; the panel then opens instantly, with no slide."
    >
      <div ref={hostRef}>
        <Collapsible className="group rounded-md bg-secondary">
          <Collapsible.Trigger className={TRIGGER_CLASS}>
            <span>Find in page — closed until found</span>
            <Chevron />
          </Collapsible.Trigger>
          <Collapsible.Panel>
            <div className="px-3 pb-3 text-sm text-muted">
              <p>
                Search for this token while the panel is closed:{" "}
                <span className="font-mono text-foreground">{NEEDLE}</span>
              </p>
            </div>
          </Collapsible.Panel>
        </Collapsible>
      </div>
      <LabActions>
        <LabButton onClick={dispatchBeforematch}>
          dispatch beforematch
        </LabButton>
      </LabActions>
      <LabRow
        label="hidden"
        value={
          probe === null ? undefined : (
            <LabBadge tone="muted">
              {probe.hidden === null
                ? "absent"
                : JSON.stringify(probe.hidden)}
            </LabBadge>
          )
        }
        hint='getAttribute("hidden") on that panel, live. "" is the server value and the fallback; "until-found" is the post-hydration upgrade where the engine supports it.'
      />
      <LabRow
        label="onbeforematch in document.body"
        value={
          <LabBadge tone={supportsBeforematch ? "ok" : "muted"}>
            {String(supportsBeforematch)}
          </LabBadge>
        }
        hint="The engine's until-found support. false is correct on WebKit — nothing to fix."
      />
      <LabRow
        label="transition phase"
        value={probe ? (probe.phase ?? "absent") : undefined}
        hint="data-collapsible-opening / data-collapsible-closing on the panel. Must stay absent through a beforematch open."
      />
      {!supportsBeforematch && (
        <LabCaveat>
          No until-found on this engine: the closed panel is plain
          `hidden`, so the browser's find-in-page will not reach the
          needle. That is the engine, not the component. The dispatch
          button exercises the same open path by hand.
        </LabCaveat>
      )}
    </LabSection>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

type PanelProbe = {
  hidden: string | null
  open: boolean
  phase: "opening" | "closing" | null
  inlineHeight: string
  clientHeight: number
}

/**
 * The panel inside `hostRef`, read live.
 *
 * A MutationObserver for the attributes the contract moves (`hidden`,
 * `data-collapsible-open`, `data-collapsible-opening` / `-closing`, the inline
 * `style`) and a ResizeObserver for the height, so the readouts follow the
 * transition frame by frame instead of the last render. `null` until mounted: the
 * server has no panel to read, and a guessed value would mismatch the hydration.
 */
function usePanelProbe(hostRef: RefObject<HTMLDivElement | null>) {
  const [probe, setProbe] = useState<PanelProbe | null>(null)

  useEffect(() => {
    const panel = hostRef.current?.querySelector<HTMLElement>(
      '[data-adaptv="collapsible-panel"]',
    )
    if (!panel) return

    const read = () =>
      setProbe({
        hidden: panel.getAttribute("hidden"),
        open: panel.hasAttribute("data-collapsible-open"),
        phase: panel.hasAttribute("data-collapsible-opening")
          ? "opening"
          : panel.hasAttribute("data-collapsible-closing")
            ? "closing"
            : null,
        inlineHeight: panel.style.height,
        clientHeight: panel.clientHeight,
      })
    read()

    const mutations = new MutationObserver(read)
    mutations.observe(panel, {
      attributes: true,
      childList: true,
      subtree: true,
    })
    const resizes = new ResizeObserver(read)
    resizes.observe(panel)
    return () => {
      mutations.disconnect()
      resizes.disconnect()
    }
  }, [hostRef])

  return probe
}
