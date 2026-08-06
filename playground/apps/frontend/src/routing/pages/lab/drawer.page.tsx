import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { AppDrawer, TextInput } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/drawer")({
  component: LabDrawerPage,
})

const LINES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
] as const

function LabDrawerPage() {
  const [basic, setBasic] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const [keyboard, setKeyboard] = useState(false)
  const [nested, setNested] = useState(false)
  const [inner, setInner] = useState(false)
  const [noDrag, setNoDrag] = useState(false)
  const [draft, setDraft] = useState("")
  const [log, setLog] = useState<LabLogEntry[]>([])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="Drawer"
      subtitle="A bottom sheet is the hardest gesture in the app: it has to drag, fling, scroll internally, host a keyboard, nest inside itself and still hand the back button back in the right order."
    >
      <LabBrief
        what="That a drawer opens and closes from a drag, a fling, the overlay, the close button and the back gesture — and that its internal scroller and the drag never fight each other."
        steps={[
          "Open the basic drawer. Drag the handle down slowly: the sheet must follow your finger the whole way and settle back if you release near the top.",
          "Drag down past about a third of its height and release. It must close, not snap back.",
          "Flick it down fast from only a few pixels of travel. Velocity alone must close it.",
          "Tap the dimmed overlay. It must close. Then reopen and press the back affordance (Android hardware back, or the iOS edge swipe): it must close the drawer FIRST, not navigate away from this page.",
          "Open the scrolling drawer. Scroll its content to the bottom, then keep pulling down: the sheet must NOT start dragging while the scroller has room, and must only take over once the scroller is at the top.",
          "Open the keyboard drawer and focus the field. The sheet must lift so the field stays visible, and closing the keyboard must put it back.",
          "Open the nested drawer, then the inner one. Back / overlay must close the INNER one first.",
          "Open the disableDrag drawer and try to drag it. Nothing must move; the close button must still work.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, with the mouse standing in for a finger. Back is the browser's Back button here. The keyboard drawer does nothing visible on desktop because there is no on-screen keyboard.",
          },
          pwa: {
            verdict: "works",
            note: "Everything. On an installed iOS PWA the keyboard case is the interesting one: the sheet has to lift against a visualViewport-inferred height rather than an exact one, so a frame of lag is expected and a wrong resting position is not.",
          },
          ios: {
            verdict: "works",
            note: "Everything, with an exact keyboard height. Also check the edge swipe: swiping from the left edge with a drawer open must close the drawer rather than leaving the page.",
          },
          android: {
            verdict: "works",
            note: "Everything. The hardware/gesture back button is the one to be strict about — it must consume the press to close the drawer and only pop the route on a second press.",
          },
        }}
        wrong="The sheet stops following your finger mid-drag (the gesture lost the pointer, usually to a scroller or an image drag). Pulling down inside a scrolled-to-bottom list starts dragging the sheet. The back button navigates away while a drawer is open, leaving an orphaned overlay. A nested drawer closes the outer one first. The sheet ends up behind the keyboard."
      />

      <LabSection
        title="1 · Drag, fling, overlay, back"
        description="Four independent ways out. The back chain is why the drawer registers a handler at the Overlay priority band rather than just listening for a key."
      >
        <LabActions>
          <LabButton onClick={() => setBasic(true)}>Open</LabButton>
        </LabActions>
        <AppDrawer
          open={basic}
          onOpenChange={(open) => {
            note(`basic drawer ${open ? "opened" : "closed"}`)
            setBasic(open)
          }}
        >
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Basic drawer</AppDrawer.Title>
                <AppDrawer.Description>
                  Drag the handle. Fling it. Tap the dim. Press back.
                </AppDrawer.Description>
                <AppDrawer.Close className="clickable mt-4 w-full rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground">
                  Close
                </AppDrawer.Close>
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
      </LabSection>

      <LabSection
        title="2 · A scroller inside the sheet"
        description="The gesture arbiter's hardest case: two things want the same downward drag. The rule is that the scroller wins until it is at the top, and only then does the sheet take over."
      >
        <LabActions>
          <LabButton onClick={() => setScrolling(true)}>Open</LabButton>
        </LabActions>
        <AppDrawer open={scrolling} onOpenChange={setScrolling}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content className="max-h-[70dvh]">
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Scrolling content</AppDrawer.Title>
                {LINES.map((line) => (
                  <p key={line} className="py-3 text-sm text-foreground">
                    Line {line} — scroll to the bottom, then keep pulling.
                  </p>
                ))}
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
      </LabSection>

      <LabSection
        title="3 · avoidKeyboard"
        description="On by default. The drawer handles its own avoidance — an AvoidKeyboard inside one is redundant and will fight it."
      >
        <LabActions>
          <LabButton onClick={() => setKeyboard(true)}>Open</LabButton>
        </LabActions>
        <AppDrawer open={keyboard} onOpenChange={setKeyboard}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Type in here</AppDrawer.Title>
                <AppDrawer.Description>
                  The field must stay visible above the keyboard.
                </AppDrawer.Description>
                <div className="mt-4">
                  <TextInput
                    value={draft}
                    onChange={setDraft}
                    autoFocus
                    placeholder="Autofocused — the keyboard should raise itself"
                    aria-label="Drawer field"
                  />
                </div>
              </AppDrawer.Shell>
              <AppDrawer.Footer>
                <AppDrawer.Close className="clickable w-full rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground">
                  Close
                </AppDrawer.Close>
              </AppDrawer.Footer>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
        <LabCaveat>
          Autofocus can only raise the iOS keyboard from a drawer mounted
          in page/outlet scope — that is why the app&apos;s login drawer
          lives on the settings page rather than inside the auth provider.
          If the keyboard does not come up by itself here, tap the field;
          if it comes up on the tap, the autofocus path is what regressed.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="4 · Nested"
        description="A drawer opened from inside a drawer. Both are registered on the back chain, and the inner one has to win."
      >
        <LabActions>
          <LabButton onClick={() => setNested(true)}>Open</LabButton>
        </LabActions>
        <AppDrawer open={nested} onOpenChange={setNested}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Outer</AppDrawer.Title>
                <button
                  type="button"
                  onClick={() => setInner(true)}
                  className="clickable mt-4 w-full rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground"
                >
                  Open the inner drawer
                </button>
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
        <AppDrawer open={inner} onOpenChange={setInner}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Inner</AppDrawer.Title>
                <AppDrawer.Description>
                  Back or the overlay must close THIS one and leave the
                  outer drawer standing.
                </AppDrawer.Description>
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
      </LabSection>

      <LabSection
        title="5 · disableDrag"
        description="For a sheet whose dismissal must be deliberate — a destructive confirm, a required choice."
      >
        <LabActions>
          <LabButton onClick={() => setNoDrag(true)}>Open</LabButton>
        </LabActions>
        <AppDrawer open={noDrag} onOpenChange={setNoDrag} disableDrag>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>Not draggable</AppDrawer.Title>
                <AppDrawer.Description>
                  Try to drag the handle. Nothing should move.
                </AppDrawer.Description>
                <AppDrawer.Close className="clickable mt-4 w-full rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground">
                  Close
                </AppDrawer.Close>
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
      </LabSection>

      <LabSection title="Log">
        <LabRow
          label="open drawers"
          value={
            [basic, scrolling, keyboard, nested, inner, noDrag].filter(
              Boolean,
            ).length
          }
        />
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
