import type { RadioGroupItemProps } from "adaptv/components"
import { RadioGroup, useRadioGroupItem } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import type { FormEvent } from "react"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { cn } from "@/utils/cn"

export const Route = createFileRoute("/_providers/lab/radio-group")({
  component: LabRadioGroupPage,
})

/*
 * The app's look for a radio, as a Tier 2 consumer writes it: a Box that branches
 * on useRadioGroupItem(). Every probe on this page uses it, so the page tests the
 * primitive in the app's own visual language.
 */
function BrandBox() {
  const { isChecked, isDisabled } = useRadioGroupItem()
  return (
    <RadioGroup.Box
      className={cn(
        "ring-1 ring-inset",
        isChecked ? "bg-primary ring-primary" : "bg-surface ring-border",
        isDisabled && "opacity-50",
      )}
    >
      <RadioGroup.Indicator
        className={cn(isChecked && "text-primary-foreground")}
      />
    </RadioGroup.Box>
  )
}
//the item looks for its box by this name, as Checkbox does: without it the item
//would also draw its default box beside this one
BrandBox.displayName = "RadioGroup.Box"

function Item({ children, ...props }: RadioGroupItemProps) {
  return (
    <RadioGroup.Item
      {...props}
      className="rounded-md py-1 pe-3 text-sm text-foreground"
    >
      <BrandBox />
      <span>{children}</span>
    </RadioGroup.Item>
  )
}

function LabRadioGroupPage() {
  const [log, setLog] = useState<LabLogEntry[]>([])
  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="RadioGroup"
      subtitle="One choice out of several, on native radios: the browser owns arrow keys, Tab, Space and form submission, and each radio lies invisibly over its whole item."
    >
      <LabBrief
        what="The two things RadioGroup owns. Two groups mounted with no name stay independent (a radio group is keyed on its name, so a shared literal name would make them one). And each radio's accessible element is its whole item, not a 1px speck, so VoiceOver frames the row and a tap at its centre selects."
        steps={[
          "In “Two instances”, pick Large on the left, then Small on the right. The left must still say Large: selecting in one group never clears the other.",
          "Tap the centre of each option in the controlled group. Each tap moves the selection, the readout follows, and the change count goes up by exactly one.",
          "Press “freeze”, then tap another option. The selection must stay where it was while the change count still goes up.",
          "With a keyboard: Tab into the controlled group (focus lands on the selected option), press the arrow keys (the selection moves with focus), then Tab once: focus leaves the group.",
          "In “A disabled option”, arrow through the group: Beta is skipped, and tapping it does nothing.",
          "Submit the form without choosing: the browser refuses (required). Choose Yearly and submit: the output reads plan=yearly. Press Reset: no option is painted as chosen any more, and a tap on Yearly chooses it again.",
          "In “Controlled form”, choose Express, then press Start over: Express stays chosen and painted, the change count stays at 1, and Place order sends delivery=express.",
          "Press an option and drag your finger off it before letting go: nothing is chosen. Then choose that option another way (VoiceOver double-tap, or a keyboard): it is chosen on the first try.",
          "In the RTL group the circle sits on the right of each label. In Chrome ArrowLeft moves to the next option (the one drawn to its left); Safari keeps ArrowRight as next in either direction.",
          "With VoiceOver on (iOS): swipe to an option. The frame is the whole row, it reads radio button, its name, and “1 of 3”; double-tap selects it.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. The keyboard half is easiest to check here: arrows move the selection, Tab enters at the selected option and leaves in one press.",
          },
          pwa: {
            verdict: "works",
            note: "Same engine as the browser tab, same result.",
          },
          ios: {
            verdict: "works",
            note: "WKWebView. The accessibility frame of each radio (idb describe, VoiceOver) is its whole row, and a centre tap selects. With a hardware keyboard the arrows stop at the last option instead of wrapping and are not flipped under RTL, as in every Safari form; Tab reaches radios only with “Press Tab to highlight each item” on or Full Keyboard Access.",
          },
          android: {
            verdict: "works",
            note: "Android WebView is Chromium: same as the browser tab. TalkBack frames the whole row.",
          },
        }}
        wrong="Selecting on one side of “Two instances” clears the other side. A centre tap does nothing, or the VoiceOver frame is a speck at the row's edge. One tap counts two changes. After Reset an option still shows its dot. An arrow key moves focus but not the selection, or lands on Beta. The form submits with no plan, or submits the wrong one."
      />

      <TwoInstances note={note} />
      <ControlledProbe note={note} />
      <DisabledProbe note={note} />
      <FormProbe />
      <ControlledFormProbe />
      <RtlProbe note={note} />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv · data-part"
          value={<LabBadge tone="ok">radio-group</LabBadge>}
          hint="data-adaptv='radio-group' with data-part='root' on the group only; each item is data-part='item', its circle 'box' and its dot 'indicator'. Target every group from global CSS with no imports, and its options with [data-adaptv='radio-group'] [data-part='item']."
        />
        <LabRow
          label="data-checked · data-disabled"
          value="presence, on the item"
          hint="data-disabled is on the group too while the whole group is disabled."
        />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

function SizeGroup({
  label,
  testId,
  note,
}: {
  label: string
  testId: string
  note: (text: string) => void
}) {
  const [value, setValue] = useState("medium")
  return (
    <div data-testid={testId} className="flex flex-col gap-y-2">
      <RadioGroup
        aria-label={label}
        defaultValue="medium"
        onValueChange={(next) => {
          note(`${label} → ${next}`)
          setValue(next)
        }}
      >
        <Item value="small">Small</Item>
        <Item value="medium">Medium</Item>
        <Item value="large">Large</Item>
      </RadioGroup>
      <LabRow
        label="selected"
        value={
          <LabBadge tone="ok">
            <span data-testid={`${testId}-value`}>{value}</span>
          </LabBadge>
        }
      />
    </div>
  )
}

function TwoInstances({ note }: { note: (text: string) => void }) {
  return (
    <LabSection
      title="Two instances, no name"
      description="The same component mounted twice with no `name`. Each instance gets its own id-derived name, so the browser sees two radio groups. With a shared literal name it would see one, and a choice on one side would clear the other."
    >
      <div className="grid grid-cols-2 gap-x-4">
        <SizeGroup label="Left size" testId="instance-left" note={note} />
        <SizeGroup
          label="Right size"
          testId="instance-right"
          note={note}
        />
      </div>
    </LabSection>
  )
}

function ControlledProbe({ note }: { note: (text: string) => void }) {
  const [value, setValue] = useState<string | null>("monthly")
  const [changes, setChanges] = useState(0)
  const [frozen, setFrozen] = useState(false)
  return (
    <LabSection
      title="Controlled"
      description="`value` + `onValueChange`. Every selection reports once; the owner decides what is checked."
    >
      <RadioGroup
        aria-label="Billing"
        value={value}
        onValueChange={(next) => {
          note(`onValueChange(${next})${frozen ? " — refused" : ""}`)
          setChanges((n) => n + 1)
          if (!frozen) setValue(next)
        }}
      >
        <Item value="monthly">Monthly</Item>
        <Item value="yearly">Yearly</Item>
        <Item value="lifetime">Lifetime</Item>
      </RadioGroup>
      <LabRow
        label="value"
        value={
          <LabBadge tone={value ? "ok" : "muted"}>
            <span data-testid="controlled-value">{String(value)}</span>
          </LabBadge>
        }
      />
      <LabRow
        label="onValueChange calls"
        value={<span data-testid="controlled-changes">{changes}</span>}
        hint="Exactly one per tap, per Space, per arrow key."
      />
      <LabActions>
        <LabButton onClick={() => setFrozen((f) => !f)}>
          {frozen ? "unfreeze" : "freeze the controlled group"}
        </LabButton>
        <LabButton onClick={() => setValue(null)}>clear</LabButton>
      </LabActions>
    </LabSection>
  )
}

function DisabledProbe({ note }: { note: (text: string) => void }) {
  return (
    <LabSection
      title="A disabled option"
      description="Beta is disabled: skipped by the arrow keys, inert to a tap, never submitted. The second group is disabled as a whole."
    >
      <RadioGroup
        aria-label="Letters"
        defaultValue="alpha"
        onValueChange={(next) => note(`letters → ${next}`)}
      >
        <Item value="alpha">Alpha</Item>
        <Item value="beta" disabled>
          Beta
        </Item>
        <Item value="gamma">Gamma</Item>
      </RadioGroup>
      <RadioGroup
        aria-label="Locked"
        defaultValue="on"
        disabled
        orientation="horizontal"
        onValueChange={() => note("THIS MUST NEVER APPEAR")}
      >
        <Item value="on">On</Item>
        <Item value="off">Off</Item>
      </RadioGroup>
    </LabSection>
  )
}

function FormProbe() {
  const [submitted, setSubmitted] = useState<string | null>(null)
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entries = [...new FormData(event.currentTarget).entries()]
    setSubmitted(
      entries.map(([key, value]) => `${key}=${String(value)}`).join("&"),
    )
  }
  return (
    <LabSection
      title="Form"
      description="An explicit `name` and `required`. The browser refuses to submit with nothing chosen, and submits the chosen value under the name. Reset clears the radios and the painted dot with them."
    >
      <form
        onSubmit={onSubmit}
        onReset={() => setSubmitted(null)}
        className="flex flex-col gap-y-3"
      >
        <RadioGroup aria-label="Plan" name="plan" required>
          <Item value="monthly">Monthly</Item>
          <Item value="yearly">Yearly</Item>
        </RadioGroup>
        <input type="hidden" name="source" value="lab" />
        <div className="flex gap-x-2">
          <button
            type="submit"
            className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle"
          >
            Submit
          </button>
          <button
            type="reset"
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle"
          >
            Reset
          </button>
        </div>
      </form>
      <LabRow
        label="FormData"
        value={
          <output data-testid="form-output" className="font-mono text-xs">
            {submitted ?? "not submitted"}
          </output>
        }
      />
    </LabSection>
  )
}

function ControlledFormProbe() {
  const [value, setValue] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)
  const [submitted, setSubmitted] = useState<string | null>(null)
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const entries = [...new FormData(event.currentTarget).entries()]
    setSubmitted(
      entries.map(([key, entry]) => `${key}=${String(entry)}`).join("&"),
    )
  }
  return (
    <LabSection
      title="Controlled form"
      description="A controlled group with no `defaultValue` inside a form. Reset has no default to report, so onValueChange stays silent and the radios go back on the owner's value: what is painted, what is checked and what submits stay the same."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-y-3">
        <RadioGroup
          aria-label="Delivery"
          name="delivery"
          value={value}
          onValueChange={(next) => {
            setChanges((n) => n + 1)
            setValue(next)
          }}
        >
          <Item value="pickup">Pickup</Item>
          <Item value="express">Express</Item>
        </RadioGroup>
        <div className="flex gap-x-2">
          <button
            type="submit"
            className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle"
          >
            Place order
          </button>
          <button
            type="reset"
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle"
          >
            Start over
          </button>
        </div>
      </form>
      <LabRow
        label="value"
        value={
          <LabBadge tone={value ? "ok" : "muted"}>
            <span data-testid="controlled-form-value">
              {String(value)}
            </span>
          </LabBadge>
        }
      />
      <LabRow
        label="onValueChange calls"
        value={
          <span data-testid="controlled-form-changes">{changes}</span>
        }
        hint="One per choice; a reset adds none."
      />
      <LabRow
        label="FormData"
        value={
          <output
            data-testid="controlled-form-output"
            className="font-mono text-xs"
          >
            {submitted ?? "not submitted"}
          </output>
        }
      />
    </LabSection>
  )
}

function RtlProbe({ note }: { note: (text: string) => void }) {
  return (
    <LabSection
      title="RTL"
      description="The same group under dir='rtl'. The layout is logical classes only, so the circle moves to the inline start (the right), and the browser flips ArrowLeft/ArrowRight."
    >
      <div dir="rtl" data-testid="rtl">
        <RadioGroup
          aria-label="Direction"
          defaultValue="one"
          orientation="horizontal"
          onValueChange={(next) => note(`rtl → ${next}`)}
        >
          <Item value="one">One</Item>
          <Item value="two">Two</Item>
          <Item value="three">Three</Item>
        </RadioGroup>
      </div>
    </LabSection>
  )
}
