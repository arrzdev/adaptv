import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useState } from "react"
import { LoginDrawer } from "@/components/auth/login-drawer"
import { DeckFormDrawer } from "@/components/decks/deck-form-drawer"
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
import { TodoFormDrawer } from "@/components/todos/todo-form-drawer"
import { AppDrawer, TextInput } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/drawer")({
  component: LabDrawerPage,
})

/*
 * The cap the tall sheet asks for. A fraction of the viewport rather than a fixed length, so the
 * readout below is a proportion that has to hold on every screen instead of a number that happens
 * to be right on one.
 */
const TALL_CAP_DVH = 60
const TALL_ROWS = Array.from({ length: 40 }, (_, i) => i + 1)

/*
 * What the sheet ACTUALLY measures, read off the DOM rather than off the props.
 *
 * The cap is the whole point of the section, and the thing that can go wrong is that it lands
 * somewhere other than where it reads — on the panel (which is the sheet plus a hidden tail, so a
 * cap there is spent on the tail first), or, on a platform whose `dvh` moves with browser chrome,
 * against a viewport nobody re-measured. So take the number from the element, on every resize.
 */
function useSheetMeasurement(open: boolean) {
  const [box, setBox] = useState<{
    sheet: number
    viewport: number
  } | null>(null)
  useEffect(() => {
    if (!open) {
      setBox(null)
      return
    }
    let raf = 0
    const measure = () => {
      const panel = document.querySelector("[data-pwa-drawer]")
      const sheet = panel?.firstElementChild
      if (!sheet) {
        raf = requestAnimationFrame(measure)
        return
      }
      setBox({
        sheet: sheet.getBoundingClientRect().height,
        viewport: window.visualViewport?.height ?? window.innerHeight,
      })
    }
    raf = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    window.visualViewport?.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", measure)
      window.visualViewport?.removeEventListener("resize", measure)
    }
  }, [open])
  return box
}

const REAL_DECKS = [
  {
    id: "deck-inbox",
    name: "Inbox",
    emoji: "📥",
    position: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  {
    id: "deck-work",
    name: "Work",
    emoji: "💼",
    position: 1,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
]

type RealDrawer = "signin" | "deck" | "task" | null

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
  const [tall, setTall] = useState(false)
  const [promote, setPromote] = useState(true)
  const [realOpen, setRealOpen] = useState<RealDrawer>(null)
  const [draft, setDraft] = useState("")
  const [log, setLog] = useState<LabLogEntry[]>([])

  const measured = useSheetMeasurement(tall)
  const expected = measured
    ? (measured.viewport * TALL_CAP_DVH) / 100
    : null
  const drift =
    measured && expected !== null ? measured.sheet - expected : null

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
          "Open the tall drawer and read the verdict row underneath: the sheet has far more content than it is allowed, so the cap alone decides where the top edge lands. Rotate the device and re-open it — the proportion has to hold, not the pixel count.",
          "Open each of the app's own drawers. They must behave exactly like the lab ones; anything that only happens here is something a copy would have hidden.",
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
          <LabButton onClick={() => setBasic(true)}>
            Open basic drawer
          </LabButton>
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
          <LabButton onClick={() => setScrolling(true)}>
            Open scrolling drawer
          </LabButton>
          <LabButton onClick={() => setPromote((on) => !on)}>
            {promote ? "Drop the layer hint" : "Restore the layer hint"}
          </LabButton>
        </LabActions>
        <LabRow
          label="panel promotion"
          value={promote ? "will-change: transform" : "will-change: auto"}
        />
        <AppDrawer open={scrolling} onOpenChange={setScrolling}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            {/*`maxHeight`, not a `max-h-*` class. The panel is the sheet PLUS the hidden tail it
               over-travels into, so a height class here is spent on the tail first and the sheet
               ends up far shorter than it reads — those utilities are locked out for that reason.*/}
            <AppDrawer.Content
              maxHeight="70dvh"
              className={promote ? undefined : "will-change-auto"}
            >
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
          <LabButton onClick={() => setKeyboard(true)}>
            Open keyboard drawer
          </LabButton>
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
          <LabButton onClick={() => setNested(true)}>
            Open nested drawer
          </LabButton>
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
          <LabButton onClick={() => setNoDrag(true)}>
            Open locked drawer
          </LabButton>
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

      <LabSection
        title={`6 · The height cap (maxHeight="${TALL_CAP_DVH}dvh")`}
        description="Enough content that the sheet cannot fit it — so the cap is what decides where the top edge lands, not the content. The readout is measured off the sheet element, so it is a check and not a restatement of the prop."
      >
        <LabActions>
          <LabButton onClick={() => setTall(true)}>
            Open tall drawer
          </LabButton>
        </LabActions>
        <LabRow
          label="viewport"
          value={
            measured ? `${measured.viewport.toFixed(1)}px` : "— (open it)"
          }
        />
        <LabRow
          label={`expected (${TALL_CAP_DVH}% of it)`}
          value={expected !== null ? `${expected.toFixed(1)}px` : "—"}
        />
        <LabRow
          label="sheet measured"
          value={measured ? `${measured.sheet.toFixed(1)}px` : "—"}
        />
        <LabRow
          label="verdict"
          value={
            drift === null
              ? "—"
              : Math.abs(drift) <= 1
                ? "the cap holds"
                : `OFF by ${drift.toFixed(1)}px — the cap landed somewhere else`
          }
        />
        <AppDrawer open={tall} onOpenChange={setTall}>
          <AppDrawer.Portal>
            <AppDrawer.Overlay />
            <AppDrawer.Content maxHeight={`${TALL_CAP_DVH}dvh`}>
              <AppDrawer.Handle />
              <AppDrawer.Shell>
                <AppDrawer.Title>
                  Taller than it is allowed
                </AppDrawer.Title>
                <AppDrawer.Description>
                  Forty rows. The sheet must stop at the cap and scroll the
                  rest, not grow to fit.
                </AppDrawer.Description>
                {TALL_ROWS.map((row) => (
                  <p key={row} className="py-3 text-sm text-foreground">
                    Row {row} of {TALL_ROWS.length}
                  </p>
                ))}
              </AppDrawer.Shell>
            </AppDrawer.Content>
          </AppDrawer.Portal>
        </AppDrawer>
        <LabCaveat>
          adaptv&apos;s own ceiling still applies underneath: the viewport
          minus the top safe area when installed, 97dvh in a browser tab.
          This asks the sheet to stop lower, which is the only direction
          the cap travels — it can never be used to reach the screen edge.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="7 · The app's own drawers"
        description="Not copies — the actual sign-in, new-deck and task components the app ships, imported from where the app uses them. A copy stops being evidence the moment it drifts, and these carry what a lab sheet does not: a footer owning the safe-area inset, a Close inside the tree, an auto-growing field."
      >
        <LabActions>
          <LabButton onClick={() => setRealOpen("signin")}>
            Sign in (autofocus)
          </LabButton>
          <LabButton onClick={() => setRealOpen("deck")}>
            New deck (autofocus)
          </LabButton>
          <LabButton onClick={() => setRealOpen("task")}>Task</LabButton>
        </LabActions>
        <LoginDrawer
          open={realOpen === "signin"}
          onOpenChange={(next) => setRealOpen(next ? "signin" : null)}
        />
        <DeckFormDrawer
          open={realOpen === "deck"}
          onOpenChange={(next) => setRealOpen(next ? "deck" : null)}
          submitLabel="Create deck"
          onSubmit={() => setRealOpen(null)}
        />
        <TodoFormDrawer
          open={realOpen === "task"}
          onOpenChange={(next) => setRealOpen(next ? "task" : null)}
          submitLabel="Create task"
          decks={REAL_DECKS}
          defaultDeckId="deck-inbox"
          onSubmit={() => setRealOpen(null)}
        />
      </LabSection>

      <LabSection title="Log">
        <LabRow
          label="open drawers"
          value={
            [
              basic,
              scrolling,
              keyboard,
              nested,
              inner,
              noDrag,
              tall,
            ].filter(Boolean).length
          }
        />
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}
