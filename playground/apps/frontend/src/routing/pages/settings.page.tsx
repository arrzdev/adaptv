import {
  Button,
  EdgeSwipeGestures,
  Link,
  Pressable,
  Text,
  View,
} from "@arrzdev/adaptv/components"
import type { UiThemePreference } from "@arrzdev/adaptv/hooks"
import { useTheme } from "@arrzdev/adaptv/hooks"
import { createFileRoute, useRouter } from "@arrzdev/adaptv/router"
import {
  ChevronRight,
  FlaskConical,
  Moon,
  Sparkles,
  Trash2,
  Vibrate,
} from "lucide-react"
import { useState } from "react"
import { LoginDrawer } from "@/components/auth/login-drawer"
import { CreateDeckDrawer } from "@/components/decks/create-deck-drawer"
import { EditDeckDrawer } from "@/components/decks/edit-deck-drawer"
import { PageWithSmoothEdges } from "@/components/page"
import { DeleteDataDrawer } from "@/components/settings/delete-data-drawer"
import { DeleteDeckDrawer } from "@/components/settings/delete-deck-drawer"
import { SettingsAccountCard } from "@/components/settings/settings-account-card"
import { SettingsDeckList } from "@/components/settings/settings-deck-list"
import { SettingsHeader } from "@/components/settings/settings-header"
import { SettingsListRow } from "@/components/settings/settings-list-row"
import { SettingsRow } from "@/components/settings/settings-row"
import { reorderDecks } from "@/data/collections/decks/mutations"
import { useDecks } from "@/data/collections/decks/queries"
import type { Deck } from "@/data/collections/decks/schema"
import { useSettings } from "@/data/collections/preferences/settings"
import { useDataMutation } from "@/hooks/use-data-mutation"
import { useHaptics } from "@/hooks/use-haptics"
import { useIsInstalledApp } from "@/hooks/use-installed-app"

export const Route = createFileRoute("/_providers/settings")({
  component: SettingsPage,
})

const THEMES: { preference: UiThemePreference; label: string }[] = [
  { preference: "light", label: "Light" },
  { preference: "dark", label: "Dark" },
  { preference: "system", label: "System" },
]

function SettingsPage() {
  const router = useRouter()
  //Own the edge-swipe-back wherever this app is INSTALLED. This app runs on memory
  //history once installed (`memoryHistoryInStandalone` in adaptv.config.ts), so
  //there is no history entry behind us and the shell's own back-forward swipe is
  //inert — leaving the header chevron as the only way out. In a browser tab it
  //stays off on purpose: the browser's edge swipe already IS back there, and a
  //second recogniser on the same edge pops two entries. See useIsInstalledApp for
  //why this is not `(display-mode: standalone)`.
  const isInstalled = useIsInstalledApp()
  const { settings, setSettings } = useSettings()
  const haptic = useHaptics()
  const theme = useTheme()
  const { data: decks } = useDecks()
  const [createOpen, setCreateOpen] = useState(false)
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null)
  const [deletingDeck, setDeletingDeck] = useState<Deck | null>(null)
  const [deleteDataOpen, setDeleteDataOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  //the only mutation the page still drives directly — create/edit/delete each
  //live in their own drawer now
  const reorder = useDataMutation()

  const canDeleteDeck = decks.length > 1

  function handleThemeChange(preference: UiThemePreference) {
    haptic.selection()
    theme.setPreference(preference)
  }

  //the Switch wrapper fires the selection haptic on toggle (gated by the haptics
  //preference), so these handlers only carry the state change
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
        enabled={isInstalled}
        left={() => router.navigate({ to: "/" })}
      />
      <SettingsHeader />

      {/* Login drawer rendered here, in page/outlet scope, NOT up at provider
          level: iOS only raises the keyboard for an autofocus that happens
          inside the router's outlet scope — a drawer mounted outside it focuses
          the field but never opens the keyboard. */}
      <LoginDrawer open={loginOpen} onOpenChange={setLoginOpen} />

      <SettingsAccountCard onSignIn={() => setLoginOpen(true)} />

      <View className="flex flex-col gap-y-2">
        <Text
          // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h2 at runtime (cloneElement), which the static check can't see
          render={<h2 />}
          className="ps-1 text-sm font-medium text-subtle"
        >
          Preferences
        </Text>
        <View className="flex flex-col overflow-hidden rounded-md bg-surface">
          <SettingsListRow
            label="Theme"
            icon={Moon}
            showSeparator
            trailing={
              <View
                row
                role="group"
                aria-label="Theme"
                className="shrink-0 gap-x-0.5 rounded-md bg-secondary p-0.5"
              >
                {THEMES.map(({ preference, label }) => (
                  <Button
                    key={preference}
                    aria-pressed={theme.preference === preference}
                    onClick={() => handleThemeChange(preference)}
                    className="rounded-sm bg-transparent px-2.5 py-1 text-sm font-medium text-subtle aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm"
                  >
                    <Button.Text>{label}</Button.Text>
                  </Button>
                ))}
              </View>
            }
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
        </View>
      </View>

      <View className="flex flex-col gap-y-2">
        <Text
          // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h2 at runtime (cloneElement), which the static check can't see
          render={<h2 />}
          className="ps-1 text-sm font-medium text-subtle"
        >
          Framework
        </Text>
        <View className="flex flex-col overflow-hidden rounded-md bg-surface">
          <View>
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
              <Text className="flex-1 text-base font-medium text-foreground">
                Testing
              </Text>
              <ChevronRight
                size={18}
                strokeWidth={1.75}
                aria-hidden
                className="shrink-0 text-subtle"
              />
            </Link>
          </View>
        </View>
      </View>

      <View className="flex flex-col gap-y-2">
        <Text
          // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h2 at runtime (cloneElement), which the static check can't see
          render={<h2 />}
          className="ps-1 text-sm font-medium text-subtle"
        >
          Decks
        </Text>
        {reorder.error && (
          <Text
            render={<p />}
            className="whitespace-pre-line text-sm text-error"
          >
            {reorder.error.message}
          </Text>
        )}
        <SettingsDeckList
          decks={decks}
          canDelete={canDeleteDeck}
          onCreate={() => setCreateOpen(true)}
          onReorder={handleReorderDecks}
          onEdit={setEditingDeck}
          onDelete={setDeletingDeck}
        />
      </View>

      <Pressable
        render={<button type="button" />}
        onPress={() => {
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
        <Text className="text-base font-medium">Delete data</Text>
      </Pressable>

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
