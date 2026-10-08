import { TextArea as BaseTextArea, Input } from "adaptv/components"
import { useKeyboard } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { Search, X } from "lucide-react"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { TextArea, TextInput } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/fields")({
  component: LabFieldsPage,
})

//no display utility in here on purpose: Input's grouped layout supplies its own
//`flex`, and a consumer `block` in the same conflict group would out-merge it and
//lay the slots out as blocks
const FIELD_SHELL =
  "w-full rounded-md bg-surface px-3 py-2 text-base text-foreground ring-1 ring-inset ring-border placeholder:text-muted focus-within:ring-primary"

function LabFieldsPage() {
  const { isOpen, height } = useKeyboard()
  const [search, setSearch] = useState("")
  const [simple, setSimple] = useState("")
  const [long, setLong] = useState("")
  const [log, setLog] = useState<LabLogEntry[]>([])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="Input & TextArea"
      subtitle="Text entry is where every platform difference lands at once: the keyboard's height, the return key's label, autofill's colours, and — on iOS — a caret that does not follow a moving element."
    >
      <LabBrief
        what="That both fields type, that leading and trailing slots sit inside the field rather than beside it, that the submit key fires once, that TextArea grows with its content up to maxRows, and that the caret stays with the field while the keyboard opens."
        steps={[
          "Focus the search field and type. The magnifier must stay put and the clear button must appear only when there is text.",
          "Press the keyboard's action key (or Enter). onSubmitKey must fire exactly once — check the log.",
          "Type several lines into the auto-resizing TextArea. It must grow line by line, then STOP at maxRows and start scrolling instead.",
          "While the keyboard is open, watch the live height number below: it must be non-zero, and data-keyboard-open must read present.",
          "Scroll this page up and down with the keyboard open, then look closely at the caret in the focused field. It must be attached to the text, not floating somewhere else on screen.",
          "Fill the field from the browser's or OS's autofill and check the text colour: it must be the app's foreground colour, not black on yellow.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Everything except a real keyboard: on desktop the height stays 0 and data-keyboard-open never appears, which is correct. The action key is the physical Enter key.",
          },
          pwa: {
            verdict: "partial",
            note: "On a phone, a real keyboard with a height inferred from visualViewport geometry — approximate, and it can lag a frame behind the animation. On desktop, same as the browser tab.",
          },
          ios: {
            verdict: "works",
            note: "An exact height from the OS, no inference. This is the target the caret-repaint patch exists for: the system caret overlay does not track CSS transforms, so a moving field would otherwise leave a detached ghost caret.",
          },
          android: {
            verdict: "works",
            note: "An exact height from the OS. Also the target where enterKeyHint most visibly changes the action key's glyph — check the search field shows a magnifier or “search” rather than a plain return arrow.",
          },
        }}
        wrong="onSubmitKey fires twice, or fires on every keystroke. The TextArea keeps growing past maxRows and pushes the page. A ghost caret is left behind when the field moves — that is the iOS patch failing, and it is the ugliest bug on this page. Autofilled text is black on a yellow background."
      />

      <LabSection title="Live keyboard state">
        <LabRow
          label="isOpen"
          value={
            <LabBadge tone={isOpen ? "ok" : "muted"}>
              {String(isOpen)}
            </LabBadge>
          }
        />
        <LabRow label="height" value={`${height}px`} />
      </LabSection>

      <LabSection
        title="Input with slots"
        description="Leading and trailing render INSIDE the field box, so the text never runs under them. They are slots rather than absolutely positioned icons for exactly that reason."
      >
        <Input
          type="search"
          enterKeyHint="search"
          value={search}
          placeholder="Search — press the action key"
          aria-label="Search field"
          className={FIELD_SHELL}
          onChange={(event) => setSearch(event.target.value)}
          onSubmitKey={() => note(`onSubmitKey("${search}")`)}
        >
          <Input.Leading className="pe-2">
            <Search size={16} aria-hidden className="text-muted" />
          </Input.Leading>
          {search.length > 0 && (
            <Input.Trailing className="ps-2">
              <button
                type="button"
                aria-label="Clear the search field"
                onClick={() => setSearch("")}
                className="clickable text-muted"
              >
                <X size={16} aria-hidden />
              </button>
            </Input.Trailing>
          )}
        </Input>
        <LabRow label="value" value={search === "" ? null : search} />
      </LabSection>

      <LabSection
        title="The app's TextInput wrapper"
        description="What a consumer actually writes: the primitive plus a label shell and the app's ring. Same field, so a bug here is a bug in the primitive."
      >
        <TextInput
          value={simple}
          onChange={setSimple}
          onSubmit={() => note("TextInput onSubmit (Enter, desktop)")}
          placeholder="Type here, then press Enter"
          enterKeyHint="done"
          aria-label="Plain text field"
        />
      </LabSection>

      <LabSection
        title="TextArea — autoResize"
        description="Grows with the content from `rows` up to `maxRows`, then scrolls. The floor is the rows prop, not a min-height class, so the empty height is the primitive's to own."
      >
        <BaseTextArea
          autoResize
          rows={2}
          maxRows={5}
          value={long}
          placeholder="Type several lines. It must stop growing at five."
          aria-label="Auto-resizing text area"
          className={`${FIELD_SHELL} resize-none`}
          onChange={(event) => setLong(event.target.value)}
          onSubmitKey={() => note("TextArea onSubmitKey")}
        />
        <LabRow
          label="lines typed"
          value={long === "" ? 0 : long.split("\n").length}
        />
      </LabSection>

      <LabSection
        title="TextArea — the app's wrapper, fixed height"
        description="autoResize={false}: the field fills a parent sized to about four lines and the text scrolls inside it. The comparison is the point — the field above must move as you type and this one must not."
      >
        {/*
         * The height is on a parent, not the field's className: with autoResize off
         * the shell's h-full is locked and out-merges a className height.
         */}
        <div className="h-30">
          <TextArea
            autoResize={false}
            value={long}
            onChange={setLong}
            placeholder="Same value, fixed height. It must never grow."
            aria-label="Fixed-height text area"
          />
        </div>
      </LabSection>

      <LabSection title="Disabled">
        <TextInput
          value="cannot be edited"
          onChange={() => undefined}
          disabled
          aria-label="Disabled field"
        />
      </LabSection>

      <LabSection title="The caret patch">
        <LabCaveat>
          On iOS the system caret overlay does not track CSS transforms, so
          a field that moves leaves a detached ghost caret behind. adaptv
          mutes the caret while the field moves and force-repaints it on
          settle — which means the caret briefly VANISHING during a
          transition is the patch working, and a caret left stranded
          mid-screen is the patch failing. Nothing to see on any other
          target.
        </LabCaveat>
      </LabSection>

      <StressProbes note={note} />

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

/**
 * Stress probes, read by `e2e/stress-fields.spec.ts`. Each is a shape the page
 * above does not offer and a spec cannot build from outside: a parent that
 * applies its controlled value late (what a debounced store does), a field whose
 * `disabled` flips while it has focus, a box of zero width around an
 * auto-resizing field, an auto-resizing field with the default `maxRows`, a field
 * mounted with `autoFocus` on demand, and the native attributes (`readOnly`,
 * `maxLength`, `type="number"`) the primitive forwards untouched. Nothing here is
 * a wrapper: every field is the primitive, so a bug here is a bug in the primitive.
 */
function StressProbes({ note }: { note: (text: string) => void }) {
  const [sync, setSync] = useState("")
  const [lagged, setLagged] = useState("")
  const [laggedArea, setLaggedArea] = useState("")
  const [liveDisabled, setLiveDisabled] = useState(false)
  const [autofocusMounted, setAutofocusMounted] = useState(false)

  return (
    <LabSection
      title="Stress probes"
      description="Hostile shapes for the e2e suite: a controlled value that lands 50ms late, a field disabled under the caret, a zero-width box, and the native attributes the primitive only forwards."
    >
      <Input
        value={sync}
        aria-label="Sync controlled field"
        className={FIELD_SHELL}
        onChange={(event) => setSync(event.target.value)}
      />
      <Input
        value={lagged}
        aria-label="Lagging controlled field"
        className={FIELD_SHELL}
        onChange={(event) => {
          //the parent applies the value LATE — a debounced store, a round trip.
          //React restores the DOM value to the prop after the event, so a
          //keystroke faster than the lag is lost; that is React's contract, and
          //the spec types slower than the lag on purpose.
          const next = event.target.value
          setTimeout(() => setLagged(next), 50)
        }}
      />
      <LabRow
        label="lagging value"
        value={lagged === "" ? null : lagged}
        testId="lagging-value"
      />
      <BaseTextArea
        rows={2}
        maxRows={5}
        value={laggedArea}
        aria-label="Lagging text area"
        className={`${FIELD_SHELL} resize-none`}
        onChange={(event) => {
          const next = event.target.value
          setTimeout(() => setLaggedArea(next), 50)
        }}
      />
      <Input
        defaultValue=""
        disabled={liveDisabled}
        aria-label="Toggleable field"
        className={FIELD_SHELL}
        onSubmitKey={() => note("toggleable onSubmitKey")}
      />
      <LabActions>
        <LabButton
          testId="toggle-live-disabled"
          onClick={() => setLiveDisabled((disabled) => !disabled)}
        >
          {liveDisabled
            ? "enable the toggleable field"
            : "disable the toggleable field"}
        </LabButton>
        <LabButton
          testId="mount-autofocus"
          disabled={autofocusMounted}
          onClick={() => setAutofocusMounted(true)}
        >
          mount an autofocus field
        </LabButton>
      </LabActions>
      {autofocusMounted && (
        <Input
          autoFocus
          defaultValue=""
          aria-label="Autofocus field"
          className={FIELD_SHELL}
        />
      )}
      <Input
        readOnly
        defaultValue="read only"
        aria-label="Read-only field"
        className={FIELD_SHELL}
        onSubmitKey={() => note("read-only onSubmitKey")}
      />
      <Input
        maxLength={10}
        defaultValue=""
        aria-label="Max length field"
        className={FIELD_SHELL}
      />
      <Input
        type="number"
        defaultValue=""
        aria-label="Number field"
        className={FIELD_SHELL}
      />
      <BaseTextArea
        rows={2}
        defaultValue=""
        aria-label="Uncapped text area"
        className={`${FIELD_SHELL} resize-none`}
      />
      {/*
       * A box of zero width: every character wraps onto its own line, so the
       * measurement is as hostile as it gets. The field must neither throw nor
       * loop its ResizeObserver.
       */}
      <div
        data-testid="zero-width-box"
        style={{ width: 0, overflow: "hidden" }}
      >
        <BaseTextArea
          rows={2}
          maxRows={5}
          defaultValue=""
          aria-label="Zero-width text area"
          className={`${FIELD_SHELL} resize-none`}
        />
      </div>
    </LabSection>
  )
}
