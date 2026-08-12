import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LoginDrawer } from "@/components/auth/login-drawer"
import { DeckFormDrawer } from "@/components/decks/deck-form-drawer"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { TodoFormDrawer } from "@/components/todos/todo-form-drawer"
import {
  AppDrawer,
  DrawerActionFooter,
  drawerCancelClassName,
  PrimaryButton,
  TextArea,
} from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/drawers")({
  component: LabDrawersPage,
})

/*
 * The drawer, on a finger — the four situations where a sheet is hard:
 *
 *   1. a plain sheet          the arrival, i.e. how the slide ENDS
 *   2. a scrolling sheet      drag-vs-scroll arbitration at both ends of the scroller
 *   3. a form sheet           the keyboard: lift, room, and focus MOVING between two fields
 *   4. the app's own drawers  the real components, not copies of them
 *
 * Section 4 imports the actual sign-in / new-deck / task drawers rather than rebuilding them,
 * because a copy stops being evidence the moment it drifts. Everything a real sheet does that a
 * lab sheet does not — a footer owning the safe-area inset, a Close inside the tree, a back
 * gesture, an auto-growing field — only shows up in the real one.
 *
 * Section 1 is a phone-only judgement and stays one: nothing about how the slide ends reproduces
 * in a desktop browser at any CPU throttle (see the note on `@keyframes pwa-drawer-slide` in
 * styles/drawer.css). The other three are also covered headlessly, by drawer-motion.spec.ts and
 * drawer-real.spec.ts, which drive this page.
 */

const LINES = Array.from({ length: 24 }, (_, i) => i + 1)

function Body({ scroll }: { scroll: boolean }) {
  if (!scroll) {
    return (
      <>
        <p className="text-lg font-semibold text-foreground">Same sheet</p>
        <p className="mt-1 text-sm text-muted">
          Drag it. Fling it. Let it settle and watch the moment it arrives.
        </p>
        <div className="h-24" />
      </>
    )
  }
  return (
    <>
      <p className="text-lg font-semibold text-foreground">Same sheet</p>
      <p className="mt-1 text-sm text-muted">
        Scroll to the bottom, then keep pulling. Then scroll back to the
        top and pull again.
      </p>
      {LINES.map((line) => (
        <p key={line} className="py-3 text-sm text-foreground">
          Line {line}
        </p>
      ))}
    </>
  )
}

/*
 * The create-task sheet, reduced to the parts that fight the keyboard.
 *
 * Modelled on `todo-form-drawer.tsx` — the same auto-growing TextArea, the same footer that
 * follows the form down instead of being pinned. Two fields, so focus can MOVE between them with
 * the keyboard already up, which is the case that exposes a missing re-aim: iOS reports its
 * keyboard height in two steps, and the second one lands in the tail of a 380ms open.
 */
function FormBody({
  onCancel,
  autoFocus,
}: {
  onCancel: () => void
  autoFocus: boolean
}) {
  const [title, setTitle] = useState("")
  const [note, setNote] = useState("")
  return (
    <div className="flex flex-col gap-y-5 pt-2">
      <div className="flex flex-col gap-y-2">
        <p className="ps-1 text-sm font-medium text-subtle">Task</p>
        <TextArea
          value={title}
          onChange={setTitle}
          autoFocus={autoFocus}
          placeholder="What do you need to do?"
          aria-label="Task description"
          rows={2}
        />
      </div>
      <div className="flex flex-col gap-y-2">
        <p className="ps-1 text-sm font-medium text-subtle">Notes</p>
        <TextArea
          value={note}
          onChange={setNote}
          placeholder="Focus this one with the keyboard already up."
          aria-label="Notes"
          rows={4}
        />
      </div>
      <DrawerActionFooter
        action={
          <PrimaryButton
            className="w-full py-3.5 text-base font-semibold leading-none"
            hapticOnPress={false}
            disabled={!title.trim()}
            onClick={onCancel}
          >
            Create task
          </PrimaryButton>
        }
        cancel={
          <button
            type="button"
            className={drawerCancelClassName}
            onClick={onCancel}
          >
            Cancel
          </button>
        }
      />
    </div>
  )
}

/*
 * A sheet that reaches the top of the screen stops reading as a sheet, so this one stops short.
 *
 * Getting there needed a framework fix rather than a class. The panel box is `visible sheet + a
 * hidden tail` (`bottom: -0.55vh` plus a spacer of equal height), so a max-height on Content used
 * to cap the PAIR: at a 900px viewport `max-h-[85dvh]` left 269px of sheet on screen (~30dvh) and
 * pushed 605px of scroller below the fold. The height utilities are locked out of that part now
 * and `maxHeight` is the knob — it rides down as a variable to the box that decides the visible
 * height.
 */
const SHEET_MAX_HEIGHT = "85dvh"

function LabSheet({
  open,
  onOpenChange,
  scroll,
  form = false,
  autoFocus = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scroll: boolean
  form?: boolean
  autoFocus?: boolean
}) {
  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content maxHeight={SHEET_MAX_HEIGHT}>
          <AppDrawer.Handle />
          <AppDrawer.Shell>
            {form ? (
              <FormBody
                autoFocus={autoFocus}
                onCancel={() => onOpenChange(false)}
              />
            ) : (
              <Body scroll={scroll} />
            )}
          </AppDrawer.Shell>
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
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

function RealDrawers({
  open,
  setOpen,
}: {
  open: RealDrawer
  setOpen: (next: RealDrawer) => void
}) {
  return (
    <>
      <LoginDrawer
        open={open === "signin"}
        onOpenChange={(next) => setOpen(next ? "signin" : null)}
      />
      <DeckFormDrawer
        open={open === "deck"}
        onOpenChange={(next) => setOpen(next ? "deck" : null)}
        submitLabel="Create deck"
        onSubmit={() => setOpen(null)}
      />
      <TodoFormDrawer
        open={open === "task"}
        onOpenChange={(next) => setOpen(next ? "task" : null)}
        submitLabel="Create task"
        decks={REAL_DECKS}
        defaultDeckId="deck-inbox"
        onSubmit={() => setOpen(null)}
      />
    </>
  )
}

function LabDrawersPage() {
  const [plain, setPlain] = useState(false)
  const [scroll, setScroll] = useState(false)
  const [form, setForm] = useState(false)
  const [autoFocus, setAutoFocus] = useState(false)
  const [realOpen, setRealOpen] = useState<RealDrawer>(null)

  return (
    <LabPage
      title="Drawer"
      subtitle="The sheet in the four situations that are hard: arriving, scrolling, holding a keyboard, and being the app's own component rather than a copy of it."
    >
      <LabBrief
        what="Whether the sheet arrives, scrolls, survives a keyboard, and behaves the same when it is the app's real drawer."
        steps={[
          "Open the plain sheet and watch only the last moment of the slide, as it stops.",
          "Drag it halfway down and let go. Then fling it past halfway.",
          "In the scrolling sheet, pull down from the TOP of the scroller (the sheet should follow) and from the middle (it should scroll).",
          "In the form sheet, focus the second field with the keyboard already up — the sheet has to re-aim, not jump.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "No software keyboard, so section 3 only proves the sheet still lays out. The arrival and the drag are honest here.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab, plus a real keyboard if the device has one.",
          },
          ios: {
            verdict: "works",
            note: "The surface everything here was found on. The keyboard arrives in two steps, the second ~250ms after focus.",
          },
          android: {
            verdict: "works",
            note: "Worth running for contrast — the keyboard resizes the viewport instead of overlaying it.",
          },
        }}
        wrong="The sheet snaps or locks into place at the end of the slide instead of easing to a halt; a pull near the scroller's top scrolls instead of dragging the sheet; focusing a second field jumps the sheet rather than easing it."
      />

      <LabSection
        title="1 · The arrival"
        description="A plain sheet, nothing in it. The moment to watch is the last one — the sheet should ease to a halt, not snap into place. Judge it on a phone; no desktop browser shows the difference."
      >
        <LabActions>
          <LabButton onClick={() => setPlain(true)}>Open drawer</LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="2 · Scrolling inside it"
        description="Native scrolling, arbitrated against the drag rather than reconstructed in JS. Pull from the top of the scroller and the sheet follows; pull from the middle and the content scrolls."
      >
        <LabActions>
          <LabButton onClick={() => setScroll(true)}>
            Open scrolling drawer
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="3 · Holding a keyboard"
        description="Two fields, so focus can move between them with the keyboard already up. That is the case a missing re-aim shows up in: iOS reports its height in two steps and the second lands in the tail of the open."
      >
        <LabActions>
          <LabButton
            onClick={() => {
              setAutoFocus(false)
              setForm(true)
            }}
          >
            Open form drawer
          </LabButton>
          <LabButton
            onClick={() => {
              setAutoFocus(true)
              setForm(true)
            }}
          >
            Open form drawer (autofocus)
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="4 · The app's real drawers"
        description="Not copies — the actual sign-in, new-deck and task components the app ships. A copy stops being evidence the moment it drifts, and these carry things a lab sheet does not: a footer owning the safe-area inset, a Close inside the tree, a back gesture."
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
      </LabSection>

      <LabSheet open={plain} onOpenChange={setPlain} scroll={false} />
      <LabSheet open={scroll} onOpenChange={setScroll} scroll />
      <LabSheet
        open={form}
        onOpenChange={setForm}
        scroll={false}
        form
        autoFocus={autoFocus}
      />
      <RealDrawers open={realOpen} setOpen={setRealOpen} />
    </LabPage>
  )
}
