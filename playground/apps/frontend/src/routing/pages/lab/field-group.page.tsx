import {
  FieldGroup,
  getFieldItemPosition,
  Link,
  Switch,
} from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { cn } from "@arrzdev/adaptv/utils"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabBadge,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/field-group")({
  component: LabFieldGroupPage,
})

/*
 * Every visual of the grouped list is the consumer's — adaptv locks only that a
 * row is a flex container and its label column stacks. So the iOS Settings look
 * is spelled here, once, and the corner radii come from `first:` / `last:` /
 * `only:` reading the rows box, whose only children are rows. There is no
 * `data-position`; that is the point under test.
 */
//the shorthand `label` / `description` render bare spans, so their type sits
//on the row the same way the dividers sit on the section
const ROW_CLASS =
  "gap-x-4 bg-surface px-4 py-3 first:rounded-t-xl last:rounded-b-xl only:rounded-xl data-disabled:opacity-40 [&_[data-part=title]]:text-base [&_[data-part=title]]:text-foreground [&_[data-part=description]]:text-sm [&_[data-part=description]]:text-muted"
//the rows box has no slot, so the dividers reach it through the section
const SECTION_CLASS =
  "flex flex-col [&>[data-part=rows]]:divide-y [&>[data-part=rows]]:divide-border [&_[data-part=header]]:px-4 [&_[data-part=header]]:pb-1 [&_[data-part=header]]:text-xs [&_[data-part=header]]:uppercase [&_[data-part=header]]:tracking-wide [&_[data-part=header]]:text-muted [&_[data-part=footer]]:px-4 [&_[data-part=footer]]:pt-1 [&_[data-part=footer]]:text-xs [&_[data-part=footer]]:text-muted"
const HEADER_CLASS =
  "flex items-center gap-x-2 px-4 pb-1 text-xs uppercase tracking-wide text-muted"
const TITLE_CLASS = "text-base text-foreground"
const DESCRIPTION_CLASS = "text-sm text-muted"

//`render` takes an ELEMENT, so the row's control is cloned into this label
//later and the linter cannot see it; the row's own label column is the text.
// biome-ignore lint/a11y/noLabelWithoutControl: the row clones its switch in
const LABEL_ROW = <label />

const POSITIONS = [
  [0, 1],
  [0, 3],
  [1, 3],
  [2, 3],
] as const

function PreferenceSwitch({
  checked,
  onCheckedChange,
  disabled,
  label,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <Switch
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "rounded-full transition-colors",
        checked
          ? "bg-primary"
          : "bg-secondary ring-1 ring-inset ring-border",
      )}
    >
      <Switch.Thumb className="rounded-full bg-white shadow" />
    </Switch>
  )
}

function LabFieldGroupPage() {
  const [dark, setDark] = useState(false)
  const [animations, setAnimations] = useState(true)
  const [haptics, setHaptics] = useState(false)
  const [toggles, setToggles] = useState(0)
  const [log, setLog] = useState<LabLogEntry[]>([])
  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  function toggled(name: string, set: (next: boolean) => void) {
    return (next: boolean) => {
      set(next)
      setToggles((count) => count + 1)
      note(`${name} → ${next ? "on" : "off"}`)
    }
  }

  return (
    <LabPage
      title="FieldGroup"
      subtitle="The grouped settings form: titled sections of label-and-control rows with a footer of fine print. adaptv ships the structure; every colour, inset and corner is the page's own className."
    >
      <LabBrief
        what="That a Section is a real <section> labelled by its header, that its rows box holds ONLY rows (so first: / last: / only: paint the grouped corners with no data-position), that a row rendered as a <label> toggles its switch from anywhere on the row, that a disabled row is inert, that a row rendered as a <Link> navigates, and that the keyboard visits the controls and never a row."
        steps={[
          "Tap the TEXT of the Dark mode row, away from the switch. The switch must flip and the toggles counter must go up by one.",
          "Tap the Haptics row. Nothing changes — the row is disabled and so is its switch.",
          "Look at the corners: the first row is rounded on top only, the middle row on neither, the last on the bottom only, and the single row in the third section on all four.",
          "Tap the Testing row. It must open the testing index; the back chevron there must bring you back here.",
          "On desktop, press Tab from the top of the page: the focus ring must visit the three switches and then the Testing link, never a row.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, with the mouse and the keyboard. The row IS a <label>, so the browser's own label activation reaches the switch's checkbox.",
          },
          pwa: {
            verdict: "works",
            note: "Same. The list is plain DOM; nothing here depends on the shell.",
          },
          ios: {
            verdict: "works",
            note: "Same, and the one thing to feel is that a tap on the row text toggles as crisply as a tap on the track itself.",
          },
          android: {
            verdict: "works",
            note: "Same. A press that scrolls the page must not toggle — the switch rides the gesture engine, the label does not.",
          },
        }}
        wrong="Tapping the row text does nothing and only the track toggles. A corner is rounded on a middle row, or square on the single row. The disabled row still flips. Tab lands on a row div. The Testing row does not navigate, or navigates on a press that was a scroll."
      />

      <FieldGroup className="flex flex-col gap-y-6">
        <FieldGroup.Section
          title="Preferences"
          footer="Three switches. Each row is a <label>, so the whole row is the switch's hit area. The third is disabled on both the row and the control."
          className={SECTION_CLASS}
        >
          <FieldGroup.Row
            label="Dark mode"
            description="Follows the row, not the track"
            render={LABEL_ROW}
            className={ROW_CLASS}
          >
            <PreferenceSwitch
              checked={dark}
              onCheckedChange={toggled("Dark mode", setDark)}
              label="Dark mode"
            />
          </FieldGroup.Row>
          <FieldGroup.Row
            label="Animations"
            render={LABEL_ROW}
            className={ROW_CLASS}
          >
            <PreferenceSwitch
              checked={animations}
              onCheckedChange={toggled("Animations", setAnimations)}
              label="Animations"
            />
          </FieldGroup.Row>
          <FieldGroup.Row
            label="Haptics"
            description="Disabled — must never flip"
            disabled
            render={LABEL_ROW}
            className={ROW_CLASS}
          >
            <PreferenceSwitch
              checked={haptics}
              onCheckedChange={toggled("Haptics", setHaptics)}
              disabled
              label="Haptics"
            />
          </FieldGroup.Row>
        </FieldGroup.Section>

        <FieldGroup.Section
          title="Framework"
          footer="A navigation row is a real link: the row renders as the app's Link, so ⌘-click, preload and the hold-to-cancel all still work."
          className={SECTION_CLASS}
        >
          <FieldGroup.Row
            label="Testing"
            description="Opens the testing index"
            render={<Link to="/lab" />}
            className={cn(ROW_CLASS, "clickable")}
          >
            <span aria-hidden className="text-subtle">
              ›
            </span>
          </FieldGroup.Row>
        </FieldGroup.Section>

        <FieldGroup.Section className={SECTION_CLASS}>
          <FieldGroup.Header className={HEADER_CLASS}>
            <span>One row</span>
            <LabBadge tone="ok">only:</LabBadge>
          </FieldGroup.Header>
          <FieldGroup.Row
            label="Alone in its section"
            description="Rounded on all four corners"
            className={ROW_CLASS}
          >
            <LabBadge tone="muted">no control</LabBadge>
          </FieldGroup.Row>
        </FieldGroup.Section>

        <FieldGroup.Section
          title="Slots"
          footer="The description below is a <FieldGroup.Description> element with its own className, not the shorthand prop."
          className={SECTION_CLASS}
        >
          <FieldGroup.Row className={ROW_CLASS}>
            <FieldGroup.Label className={TITLE_CLASS}>
              Slotted label
            </FieldGroup.Label>
            <FieldGroup.Description
              className={cn(DESCRIPTION_CLASS, "italic")}
            >
              a description that brought its own markup
            </FieldGroup.Description>
            <LabBadge tone="muted">slot</LabBadge>
          </FieldGroup.Row>
        </FieldGroup.Section>
      </FieldGroup>

      <LabSection
        title="Readout"
        description="What the page believes. The e2e suite reads these."
      >
        <LabRow
          label="Dark mode"
          value={
            <span data-readout="pref-dark">{dark ? "on" : "off"}</span>
          }
        />
        <LabRow
          label="Animations"
          value={
            <span data-readout="pref-animations">
              {animations ? "on" : "off"}
            </span>
          }
        />
        <LabRow
          label="Haptics"
          value={
            <span data-readout="pref-haptics">
              {haptics ? "on" : "off"}
            </span>
          }
        />
        <LabRow
          label="toggles"
          value={<span data-readout="toggles">{toggles}</span>}
          hint="How many times any switch reported a change. A row tap that flips the switch counts once, never twice."
        />
      </LabSection>

      <LabSection
        title="getFieldItemPosition"
        description="The same classification as a value, for rows built outside a Section where no rows box exists for first: / last: to read."
      >
        <table className="w-full font-mono text-sm text-foreground">
          <thead className="text-xs text-subtle">
            <tr>
              <th className="pb-1 text-start font-medium">index</th>
              <th className="pb-1 text-start font-medium">total</th>
              <th className="pb-1 text-end font-medium">position</th>
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map(([index, total]) => (
              <tr key={`${index}-${total}`}>
                <td>{index}</td>
                <td>{total}</td>
                <td
                  className="text-end"
                  data-readout={`pos-${index}-${total}`}
                >
                  {getFieldItemPosition(index, total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <LabCaveat>
          An index outside the group throws a RangeError rather than
          returning a row with no corners — a loop bound off by one fails
          loudly.
        </LabCaveat>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
