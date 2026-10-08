import { Select } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
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
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/select")({
  component: LabSelectPage,
})

/*
 * Every value the page reports is a `<span data-lab-readout="…">` holding TEXT and
 * nothing else. The e2e suite reads the component back through those spans only —
 * never through a class, never through the component's own DOM — so a restyle of
 * the lab cannot break the suite and the suite cannot pass by accident on a page
 * that merely looks right.
 */
function Readout({ name, children }: { name: string; children: string }) {
  return (
    <span data-lab-readout={name} className="font-mono">
      {children}
    </span>
  )
}

//Apple → Avocado → Banana (disabled) → Blueberry is the ORDER the keyboard case
//depends on: two ArrowDowns from Apple must land on Blueberry, stepping over
//Banana. Twelve in total so the open list is taller than half a phone screen
//and the height cap has something to cap.
const FRUITS = [
  { value: "apple", label: "Apple" },
  { value: "avocado", label: "Avocado" },
  { value: "banana", label: "Banana", disabled: true },
  { value: "blueberry", label: "Blueberry" },
  { value: "cherry", label: "Cherry" },
  { value: "fig", label: "Fig" },
  { value: "grape", label: "Grape" },
  { value: "kiwi", label: "Kiwi" },
  { value: "lemon", label: "Lemon" },
  { value: "mango", label: "Mango" },
  { value: "peach", label: "Peach" },
  { value: "plum", label: "Plum" },
] as const

const SIZES = [
  { value: "s", label: "S" },
  { value: "m", label: "M" },
  { value: "l", label: "L" },
] as const

//Five hundred rows, so the open cost, the height cap and the keyboard walk over
//a list far taller than any screen can be measured. Labels carry no space (Space
//picks in the list, so a typeahead prefix must not need one) and are zero-padded
//so a prefix like "n25" has exactly one first match, N250.
const HUGE = Array.from({ length: 500 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0")
  return { value: `n${n}`, label: `N${n}` }
})

const TRIGGER_CLASS =
  "clickable inline-flex min-w-40 items-center justify-between gap-x-2 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border data-[placeholder]:text-muted"

/**
 * Watch one Select's open state from OUTSIDE the component.
 *
 * The root stamps `data-select-open` while the list is up and the list carries
 * `data-side` once it has been placed; neither is reported through a prop, and
 * the lab must not reach into the component for them. So a MutationObserver on
 * the document (the list is `position: fixed` and may be rendered anywhere)
 * reads the two attributes back whenever either changes, scoped to the Select
 * inside `wrapper` — there are five on this page and each card reports its own.
 */
function useOpenProbe(wrapper: RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<string | null>(null)

  useEffect(() => {
    const read = () => {
      const root = wrapper.current?.querySelector('[data-adaptv="select"]')
      const isOpen = root?.hasAttribute("data-select-open") ?? false
      setOpen(isOpen)
      const content = isOpen
        ? document.querySelector<HTMLElement>(
            '[data-adaptv="select-content"]',
          )
        : null
      setSide(content?.dataset.side ?? null)
    }
    const observer = new MutationObserver(read)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-select-open", "data-side"],
    })
    read()
    return () => observer.disconnect()
  }, [wrapper])

  return { open, side }
}

function FruitCard() {
  const wrapper = useRef<HTMLDivElement>(null)
  const { open } = useOpenProbe(wrapper)
  const [value, setValue] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)

  return (
    <LabSection
      title="1 · Fruit — uncontrolled, with a placeholder"
      description="No value to start, so the trigger shows its placeholder. Banana is disabled: the keyboard must step over it and a tap on it must do nothing. Twelve options is taller than half a phone screen, so the list caps its height and scrolls."
    >
      <div ref={wrapper}>
        <Select
          aria-label="Fruit"
          placeholder="Pick a fruit"
          onValueChange={(next) => {
            setValue(next)
            setChanges((n) => n + 1)
          }}
        >
          <Select.Trigger className={TRIGGER_CLASS}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content aria-label="Fruit options">
            {FRUITS.map((fruit) => (
              <Select.Option
                key={fruit.value}
                value={fruit.value}
                disabled={"disabled" in fruit}
              >
                {fruit.label}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
      </div>
      <LabRow
        label="value"
        value={<Readout name="fruit">{value ?? "none"}</Readout>}
      />
      <LabRow
        label="list"
        value={
          <LabBadge tone={open ? "ok" : "muted"}>
            <Readout name="fruit-open">{open ? "open" : "closed"}</Readout>
          </LabBadge>
        }
      />
      <LabRow
        label="onValueChange calls"
        value={<Readout name="fruit-changes">{String(changes)}</Readout>}
      />
    </LabSection>
  )
}

function ControlledCard() {
  const [value, setValue] = useState("")
  const [changes, setChanges] = useState(0)
  //frozen: the owner still hears every pick but refuses to move — the trigger
  //must keep showing the owner's value, and the native select must agree
  const [frozen, setFrozen] = useState(false)

  return (
    <LabSection
      title="2 · Controlled"
      description="`value` + `onValueChange`. The buttons set the value from outside; the list reports what the user picked and the owner decides what to show. Frozen, the owner refuses every pick: the trigger and the hidden native select keep the owner's value."
    >
      <Select
        aria-label="Controlled"
        placeholder="Nothing yet"
        value={value}
        onValueChange={(next) => {
          if (!frozen) setValue(next)
          setChanges((n) => n + 1)
        }}
      >
        <Select.Trigger className={TRIGGER_CLASS}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content aria-label="Controlled options">
          <Select.Option value="apple">Apple</Select.Option>
          <Select.Option value="cherry">Cherry</Select.Option>
          <Select.Option value="mango">Mango</Select.Option>
        </Select.Content>
      </Select>
      <LabActions>
        <LabButton onClick={() => setValue("cherry")}>
          set cherry
        </LabButton>
        <LabButton onClick={() => setValue("")}>clear</LabButton>
        <LabButton onClick={() => setFrozen((f) => !f)}>
          {frozen ? "unfreeze" : "freeze"}
        </LabButton>
      </LabActions>
      <LabRow
        label="value"
        value={<Readout name="controlled">{value || "none"}</Readout>}
      />
      <LabRow
        label="owner"
        value={
          <Readout name="controlled-frozen">
            {frozen ? "frozen" : "following"}
          </Readout>
        }
      />
      <LabRow
        label="onValueChange calls"
        value={
          <Readout name="controlled-changes">{String(changes)}</Readout>
        }
      />
    </LabSection>
  )
}

function FormCard() {
  const form = useRef<HTMLFormElement>(null)
  const [formSize, setFormSize] = useState<string | null>(null)
  const [nativeSize, setNativeSize] = useState<string | null>(null)

  return (
    <LabSection
      title="3 · In a form"
      description="The hidden native <select name=“size”> is what the form sees. Submit reads FormData first and the native element's own .value second — they must agree with the trigger."
    >
      <form
        ref={form}
        className="flex flex-col gap-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const picked = data.get("size")
          setFormSize(typeof picked === "string" ? picked : "missing")
          const native =
            event.currentTarget.querySelector<HTMLSelectElement>(
              'select[name="size"]',
            )
          setNativeSize(native ? native.value : "missing")
        }}
      >
        <Select aria-label="Size" name="size" placeholder="Pick a size">
          <Select.Trigger className={TRIGGER_CLASS}>
            <Select.Value />
          </Select.Trigger>
          <Select.Content aria-label="Size options">
            {SIZES.map((size) => (
              <Select.Option key={size.value} value={size.value}>
                {size.label}
              </Select.Option>
            ))}
          </Select.Content>
        </Select>
        <LabActions>
          <LabButton onClick={() => form.current?.requestSubmit()}>
            submit
          </LabButton>
        </LabActions>
      </form>
      <LabRow
        label="FormData.get(“size”)"
        value={
          <Readout name="form-size">{formSize ?? "not submitted"}</Readout>
        }
      />
      <LabRow
        label="native select .value"
        value={
          <Readout name="native-size">
            {nativeSize ?? "not submitted"}
          </Readout>
        }
      />
    </LabSection>
  )
}

function ClippedCard() {
  const wrapper = useRef<HTMLDivElement>(null)
  const { open, side } = useOpenProbe(wrapper)

  return (
    <LabSection
      title="4 · Clipped — a trigger the page cannot show the list around"
      description="The trigger sits low inside an overflow-hidden box, itself inside a fixed-height scroller. The list is position: fixed, so it escapes both and flips above the trigger when there is no room below."
    >
      <div className="h-44 overflow-y-auto rounded-md bg-secondary/40 p-3">
        <p className="text-xs text-muted">
          scroll me — the trigger is at the bottom
        </p>
        <div className="h-40" />
        <div
          ref={wrapper}
          className="overflow-hidden rounded-md bg-secondary p-3"
        >
          <Select aria-label="Clipped" placeholder="Open from here">
            <Select.Trigger className={TRIGGER_CLASS}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content aria-label="Clipped options">
              {FRUITS.slice(0, 6).map((fruit) => (
                <Select.Option key={fruit.value} value={fruit.value}>
                  {fruit.label}
                </Select.Option>
              ))}
            </Select.Content>
          </Select>
        </div>
        <div className="h-4" />
      </div>
      <LabRow
        label="data-side while open"
        value={
          <Readout name="clipped-side">
            {open ? (side ?? "unplaced") : "closed"}
          </Readout>
        }
      />
      <LabCaveat>
        The list must float over the page, whole, on whichever side has
        room — never sliced by the grey box or the scroller's edge.
      </LabCaveat>
    </LabSection>
  )
}

function DisabledCard() {
  const [value, setValue] = useState("mango")

  return (
    <LabSection
      title="5 · Disabled"
      description="A disabled Select with a value. It shows the value, takes no press, opens on no key, and never fires."
    >
      <Select
        aria-label="Disabled"
        disabled
        value={value}
        onValueChange={setValue}
      >
        <Select.Trigger className={TRIGGER_CLASS}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content aria-label="Disabled options">
          <Select.Option value="mango">Mango</Select.Option>
          <Select.Option value="peach">Peach</Select.Option>
        </Select.Content>
      </Select>
      <LabRow
        label="value"
        value={<Readout name="disabled-value">{value}</Readout>}
      />
    </LabSection>
  )
}

function HugeCard() {
  const [value, setValue] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)

  return (
    <LabSection
      title="6 · Five hundred options"
      description="A list far taller than any screen. It must open without a stall, cap its height inside the viewport, and keep Home, End and typeahead correct across all five hundred rows."
    >
      <Select
        aria-label="Huge"
        placeholder="Pick one of 500"
        onValueChange={(next) => {
          setValue(next)
          setChanges((n) => n + 1)
        }}
      >
        <Select.Trigger className={TRIGGER_CLASS}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content aria-label="Huge options">
          {HUGE.map((row) => (
            <Select.Option key={row.value} value={row.value}>
              {row.label}
            </Select.Option>
          ))}
        </Select.Content>
      </Select>
      <LabRow
        label="value"
        value={<Readout name="huge">{value ?? "none"}</Readout>}
      />
      <LabRow
        label="onValueChange calls"
        value={<Readout name="huge-changes">{String(changes)}</Readout>}
      />
    </LabSection>
  )
}

function FlipDisabledCard() {
  const [disabled, setDisabled] = useState(false)
  const [value, setValue] = useState<string | null>(null)
  const [changes, setChanges] = useState(0)

  //the flip rides a timer, not a click: pressing a button while the list is open
  //is an outside press that closes it first, and the point is to disable the
  //Select UNDER an open list
  return (
    <LabSection
      title="7 · Disabled while open"
      description="Press the button, then open the list within a second: the Select is disabled underneath the open list. Whatever the list does next, a disabled Select must not take a pick."
    >
      <Select
        aria-label="Flip"
        placeholder="Open me, then wait"
        disabled={disabled}
        onValueChange={(next) => {
          setValue(next)
          setChanges((n) => n + 1)
        }}
      >
        <Select.Trigger className={TRIGGER_CLASS}>
          <Select.Value />
        </Select.Trigger>
        <Select.Content aria-label="Flip options">
          <Select.Option value="alpha">Alpha</Select.Option>
          <Select.Option value="beta">Beta</Select.Option>
          <Select.Option value="gamma">Gamma</Select.Option>
        </Select.Content>
      </Select>
      <LabActions>
        <LabButton
          disabled={disabled}
          onClick={() => {
            window.setTimeout(() => setDisabled(true), 1000)
          }}
        >
          disable in 1 s
        </LabButton>
        <LabButton disabled={!disabled} onClick={() => setDisabled(false)}>
          enable
        </LabButton>
      </LabActions>
      <LabRow
        label="disabled"
        value={
          <Readout name="flip-disabled">{disabled ? "yes" : "no"}</Readout>
        }
      />
      <LabRow
        label="value"
        value={<Readout name="flip">{value ?? "none"}</Readout>}
      />
      <LabRow
        label="onValueChange calls"
        value={<Readout name="flip-changes">{String(changes)}</Readout>}
      />
    </LabSection>
  )
}

function LabSelectPage() {
  return (
    <LabPage
      title="Select"
      subtitle="One picker on every target: a real listbox with a keyboard, a menu that lands on screen wherever its trigger is, the back gesture closing it instead of leaving, and a hidden native select so a plain form still gets the value."
    >
      <LabBrief
        what="That the same menu opens on every target, that it is fully driveable from a keyboard (arrows, Home/End, Enter, Escape, and typing the first letters of an option), that the back gesture closes the open list instead of navigating, that the list stays on screen when its trigger is clipped or near an edge, and that a form submits the picked value through the hidden native select."
        steps={[
          "Tap the Fruit trigger. The list opens attached to it, the row for “list” says open, and it fits on screen — twelve options scroll inside the list, not off the bottom.",
          "Pick Blueberry. The trigger now reads Blueberry, the value row reads blueberry, and onValueChange has fired exactly once.",
          "On a keyboard: focus the Fruit trigger, press ArrowDown. The list opens with Apple highlighted. Two more ArrowDowns highlight Blueberry — Banana is disabled and must be stepped over. Enter picks it and focus returns to the trigger.",
          "Open the list and type “ch”. Cherry highlights. Enter picks it. Escape from an open list closes it without changing anything and returns focus to the trigger.",
          "Open any list and press the back gesture (edge swipe on iOS, the system back on Android). The list closes and the page stays.",
          "In the form card pick M and press submit. Both readouts say m — the one from FormData and the one from the native select itself.",
          "Scroll the clipped box to its trigger and open it. The list floats whole over the page, on whichever side has room; the readout names that side.",
          "Try the disabled one. Nothing opens, nothing fires, the value stays mango.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, including the full keyboard walk and typeahead. This is the target to check focus return on: after Enter or Escape the trigger has a visible focus ring.",
          },
          pwa: {
            verdict: "works",
            note: "Same. The list near the bottom must clear the home indicator, not tuck under it.",
          },
          ios: {
            verdict: "works",
            note: "Tap-driven. The one to watch is the back gesture: an edge swipe with a list open must close the list and leave the page where it is. A hardware keyboard on an iPad should drive it like the web.",
          },
          android: {
            verdict: "works",
            note: "Same, and the system back must be consumed by the open list before it pops the route.",
          },
        }}
        wrong="ArrowDown highlights Banana, or Enter on a highlighted option does nothing. Focus is lost after picking (the next Tab starts from the top of the page). The list opens off the bottom of the screen for the clipped trigger, or is sliced by its box. The back gesture leaves the page with the list still open. The form readouts disagree with the trigger, or FormData has no size at all. The disabled one opens."
      />

      <FruitCard />
      <ControlledCard />
      <FormCard />
      <ClippedCard />
      <DisabledCard />
      <HugeCard />
      <FlipDisabledCard />
    </LabPage>
  )
}
