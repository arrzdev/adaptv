import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { useMediaQuery, useTheme } from "@arrzdev/adaptv/hooks"
import { Link, useRouter } from "@tanstack/react-router"
import {
  ChevronRight,
  FlaskConical,
  Moon,
  Sparkles,
  Trash2,
  Vibrate,
} from "lucide-react"
import { useState } from "react"
import { CreateDeckDrawer } from "@/components/decks/create-deck-drawer"
import { EditDeckDrawer } from "@/components/decks/edit-deck-drawer"
import { PageWithSmoothEdges } from "@/components/page"
import { DeleteDataDrawer } from "@/components/settings/delete-data-drawer"
import { DeleteDeckDrawer } from "@/components/settings/delete-deck-drawer"
import { SettingsAccountCard } from "@/components/settings/settings-account-card"
import { SettingsDeckList } from "@/components/settings/settings-deck-list"
import { SettingsHeader } from "@/components/settings/settings-header"
import { SettingsRow } from "@/components/settings/settings-row"
import { reorderDecks } from "@/data/collections/decks/mutations"
import { useDecks } from "@/data/collections/decks/queries"
import type { Deck } from "@/data/collections/decks/schema"
import { useSettings } from "@/data/collections/preferences/settings"
import { useDataMutation } from "@/hooks/use-data-mutation"
import { useHaptics } from "@/hooks/use-haptics"
import { GlobalLoginDrawer } from "@/providers/auth-provider"

export const Route = createFileRoute({
  component: SettingsPage,
})

function SettingsPage() {
  const router = useRouter()
  //own the edge-swipe-back only when the OS gesture is neutralised (standalone)
  const isStandalone = useMediaQuery("(display-mode: standalone)")
  const { settings, setSettings } = useSettings()
  const haptic = useHaptics()
  const [resolvedTheme, toggleTheme] = useTheme()
  const { data: decks } = useDecks()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null)
  const [deletingDeck, setDeletingDeck] = useState<Deck | null>(null)
  const [deleteDataOpen, setDeleteDataOpen] = useState(false)
  //the only mutation the page still drives directly — create/edit/delete each
  //live in their own drawer now
  const reorder = useDataMutation()

  const canDeleteDeck = decks.length > 1

  //the Switch wrapper fires the selection haptic on toggle (gated by the haptics
  //preference), so these handlers only carry the state change
  function handleDarkModeChange() {
    toggleTheme()
  }

  function handleAnimationsChange(checked: boolean) {
    setSettings({ animations: checked })
  }

  function handleHapticsChange(checked: boolean) {
    setSettings({ haptics: checked })
  }

  function handleReorderDecks(orderedIds: string[]) {
    void reorder.run(
      () => reorderDecks(orderedIds),
      "Could not reorder decks.",
    )
  }

  return (
    <PageWithSmoothEdges>
      <EdgeSwipeGestures
        enabled={isStandalone}
        left={() => router.navigate({ to: "/" })}
      />
      <SettingsHeader />

      {/* Login drawer rendered here (page/outlet scope) — NOT in AuthProvider —
          so its autofocus can raise the iOS keyboard. See GlobalLoginDrawer. */}
      <GlobalLoginDrawer />

      <SettingsAccountCard />

      <section className="flex flex-col gap-y-2">
        <h2 className="ps-1 text-sm font-medium text-subtle">
          Preferences
        </h2>
        <ul className="flex flex-col overflow-hidden rounded-md bg-surface">
          <SettingsRow
            label="Dark mode"
            icon={Moon}
            checked={resolvedTheme === "dark"}
            onCheckedChange={handleDarkModeChange}
            showSeparator
          />
          <SettingsRow
            label="Animations"
            icon={Sparkles}
            checked={settings.animations}
            onCheckedChange={handleAnimationsChange}
            showSeparator
          />
          <SettingsRow
            label="Haptics"
            icon={Vibrate}
            checked={settings.haptics}
            onCheckedChange={handleHapticsChange}
          />
        </ul>
      </section>

      <section className="flex flex-col gap-y-2">
        <h2 className="ps-1 text-sm font-medium text-subtle">Framework</h2>
        <ul className="flex flex-col overflow-hidden rounded-md bg-surface">
          <li>
            {/* the manual-testing surface — one page per component, framework
                behaviour and capability, each stating the expected result on
                every target so a hand pass produces a verdict rather than
                "seemed fine". ONE entry point on purpose: a second row for the
                same route is how two names for one thing start. */}
            <Link
              to="/lab"
              className="clickable flex w-full items-center gap-x-3 px-4 py-4 text-start"
            >
              <FlaskConical
                size={20}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-subtle"
              />
              <span className="flex-1 text-base font-medium text-foreground">
                Testing
              </span>
              <ChevronRight
                size={18}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-subtle"
              />
            </Link>
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-y-2">
        <h2 className="ps-1 text-sm font-medium text-subtle">Decks</h2>
        {reorder.error && (
          <p className="whitespace-pre-line text-sm text-error">
            {reorder.error.message}
          </p>
        )}
        <SettingsDeckList
          decks={decks}
          canDelete={canDeleteDeck}
          onCreate={() => setCreateOpen(true)}
          onReorder={handleReorderDecks}
          onEdit={setEditingDeck}
          onDelete={setDeletingDeck}
        />
      </section>

      <button
        type="button"
        onClick={() => {
          haptic.impact("light")
          setDeleteDataOpen(true)
        }}
        className="clickable flex w-full items-center gap-x-3 rounded-md bg-surface px-4 py-4 text-start text-error"
      >
        <Trash2
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0"
        />
        <span className="text-base font-medium">Delete data</span>
      </button>

      <CreateDeckDrawer open={createOpen} onOpenChange={setCreateOpen} />
      <EditDeckDrawer
        deck={editingDeck}
        onClose={() => setEditingDeck(null)}
      />
      <DeleteDeckDrawer
        deck={deletingDeck}
        onClose={() => setDeletingDeck(null)}
      />
      <DeleteDataDrawer
        open={deleteDataOpen}
        onOpenChange={setDeleteDataOpen}
      />
    </PageWithSmoothEdges>
  )
}
