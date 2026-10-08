import type { DropdownPlacement } from "adaptv/components"
import { Dropdown } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabCaveat,
  LabLog,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/dropdown")({
  component: LabDropdownPage,
})

const ITEMS = [
  "Rename",
  "Duplicate",
  "Move to…",
  "Archive",
  "Delete",
] as const
const LONG_ITEMS = Array.from({ length: 30 }, (_, i) => `Option ${i + 1}`)
//five hundred rows: the open cost and the cap on a menu no screen can hold
const HUGE_ITEMS = Array.from({ length: 500 }, (_, i) => `Row ${i + 1}`)

const TRIGGER_CLASS =
  "clickable shrink-0 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border"

function Menu({
  label,
  placement,
  items = ITEMS as readonly string[],
  note,
}: {
  label: string
  placement?: DropdownPlacement
  items?: readonly string[]
  note: (text: string) => void
}) {
  return (
    <Dropdown placement={placement}>
      <Dropdown.Trigger aria-label={label} className={TRIGGER_CLASS}>
        {label}
      </Dropdown.Trigger>
      <Dropdown.Content aria-label={`${label} menu`}>
        {items.map((item) => (
          <Dropdown.Item
            key={item}
            onSelect={() => note(`${label} → ${item}`)}
          >
            {item}
          </Dropdown.Item>
        ))}
      </Dropdown.Content>
    </Dropdown>
  )
}

function LabDropdownPage() {
  const [log, setLog] = useState<LabLogEntry[]>([])
  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="Dropdown"
      subtitle="An anchored menu whose whole job is to land in the right place: below by default, flipped when there's no room, shifted to stay on screen, and never clipped by the thing it opens from."
    >
      <LabBrief
        what="That the menu opens attached to its trigger, FLIPS above when there is no room below, SHIFTS sideways to stay in the viewport, escapes an overflow-clipped container (a carousel), caps its height and scrolls when it is too tall, and dismisses on an outside tap, on the back gesture, and on Escape."
        steps={[
          "Open the first menu. It must appear directly under the trigger, left edges aligned.",
          "Scroll so the “near the bottom” trigger sits low in the screen, then open it: with no room below it must FLIP and open upward instead.",
          "Open the right-edge menu. Its right side must stay on screen — it shifts left rather than spilling off the edge.",
          "Scroll the horizontal carousel so a trigger is half cut off by the strip, then open it. The menu must appear over the page (not clipped inside the strip) and inside the viewport.",
          "Open the long menu. It must not run off the screen — it caps its height and scrolls internally.",
          "With any menu open: tap outside (closes), press the back gesture (Android back, or the left-edge swipe in an installed app): it closes the menu and does NOT navigate away, and press Escape on desktop (closes).",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, with the mouse. The browser's Back is browser history, not the back chain, so it is expected to leave the page under an open menu, as it does under a drawer (measured there, not for a menu). This is the easiest target to watch the flip and the shift on — resize the window narrow and the right-edge case becomes obvious.",
          },
          pwa: {
            verdict: "works",
            note: "Same, with the on-device safe area folded in: a menu near the bottom must clear the home indicator, not tuck under it.",
          },
          ios: {
            verdict: "works",
            note: "The one to watch is the carousel case: a fixed-positioned menu must escape the strip's overflow and the back gesture (edge swipe) must close it rather than leave the page.",
          },
          android: {
            verdict: "works",
            note: "Same, and the hardware/gesture back must consume the press to close the menu before it pops the route.",
          },
        }}
        wrong="The menu opens off the bottom of the screen when the trigger is low (no flip). Its right edge spills past the viewport. Inside the carousel it is clipped to the strip instead of floating over the page. A long menu runs off-screen instead of scrolling. The back gesture navigates away while a menu is open, leaving it orphaned."
      />

      <LabSection
        title="1 · Default — opens below, start-aligned"
        description="With room, the menu sits directly under the trigger with their left edges aligned. Everything else is a deviation the engine makes to keep it on screen."
      >
        <Menu label="Actions" note={note} />
      </LabSection>

      <LabSection
        title="2 · Right edge — shifts to stay on screen"
        description="A start-aligned menu on a trigger near the right edge would spill off. It shifts left so its right edge stays inside the viewport."
      >
        <div className="flex justify-end">
          <Menu label="Right-edge menu" note={note} />
        </div>
      </LabSection>

      <LabSection
        title="3 · Occlusion — a trigger inside a scrolling carousel"
        description="The strip clips its children with overflow. A fixed-positioned menu must float OVER the page, on the visible part of the screen, not be trapped inside the strip."
      >
        <div className="overflow-x-auto rounded-md bg-secondary/40 p-3">
          <div className="flex w-max gap-x-3">
            {[
              "Card one",
              "Card two",
              "Card three",
              "Card four",
              "Card five",
            ].map((card) => (
              <Menu key={card} label={card} note={note} />
            ))}
          </div>
        </div>
        <LabCaveat>
          Scroll the strip until a trigger is half cut off, then open it —
          the menu should appear over the page, clamped to the viewport,
          not sliced by the strip's edge.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="4 · Too tall — caps height and scrolls"
        description="A menu taller than the space it has must not run off the screen. It caps to the available height and scrolls its own content."
      >
        <Menu label="Long menu" items={LONG_ITEMS} note={note} />
      </LabSection>

      <LabSection
        title="5 · Near the bottom — flips upward"
        description="This trigger sits low on the page on purpose. Scroll it near the bottom of the screen and open it: with no room below, the menu opens ABOVE the trigger."
      >
        <Menu
          label="Near the bottom"
          placement="bottom-start"
          note={note}
        />
      </LabSection>

      <LabSection
        title="6 · Five hundred items"
        description="A menu far taller than any screen. It must open without a stall and cap its height inside the viewport like the long menu, at any size."
      >
        <Menu label="Huge menu" items={HUGE_ITEMS} note={note} />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
