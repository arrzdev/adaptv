import { Pressable, Text, View } from "adaptv/components"
import { useNavigate } from "adaptv/router"
import { Plus, Settings } from "lucide-react"
import { TasksTitle } from "@/components/navigation/tasks-title"
import type { TodoFilter } from "@/components/todos/todo-filter"
import { IconButton } from "@/components/ui"
import type { Deck } from "@/data/collections/decks/schema"
import { useHaptics } from "@/hooks/use-haptics"

type TodosHeaderProps = {
  activeCount: number
  archivedCount: number
  activeDeck?: Deck | null
  filter: TodoFilter
  isLoading?: boolean
  onAdd: () => void
  onFilterChange: (filter: TodoFilter) => void
}

export function TodosHeader({
  activeCount,
  archivedCount,
  activeDeck = null,
  filter,
  isLoading = false,
  onAdd,
  onFilterChange,
}: TodosHeaderProps) {
  const navigate = useNavigate()
  const haptic = useHaptics()

  //the archived/pending toggles are plain text buttons (not IconButtons), so they
  //fire the tap haptic themselves; the IconButtons below get it from the wrapper
  function showArchived() {
    haptic.impact("light")
    onFilterChange("archived")
  }

  function showPending() {
    haptic.impact("light")
    onFilterChange("active")
  }

  return (
    <View row className="flex shrink-0 items-center justify-between gap-4">
      <View className="flex min-w-0 flex-1 flex-col gap-y-1">
        <TasksTitle
          as="h1"
          deck={activeDeck}
          className="truncate text-4xl font-semibold tracking-tight text-foreground"
        />
        <Text
          render={
            <p
              className="min-h-lh pl-1 text-sm text-subtle"
              aria-busy={isLoading || undefined}
            />
          }
        >
          {isLoading && "Loading tasks…"}
          {!isLoading && filter === "active" && (
            <>
              {activeCount} pending
              <Text aria-hidden> • </Text>
              <Pressable
                render={
                  <button
                    type="button"
                    className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
                  />
                }
                onPress={showArchived}
              >
                {archivedCount} archived
              </Pressable>
            </>
          )}
          {!isLoading && filter === "archived" && (
            <>
              <Pressable
                render={
                  <button
                    type="button"
                    className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
                  />
                }
                onPress={showPending}
              >
                {activeCount} pending
              </Pressable>
              <Text aria-hidden> • </Text>
              {archivedCount} archived
            </>
          )}
        </Text>
      </View>
      {/* self-stretch + items-center keeps the button row vertically centered
          against the title/subtitle block */}
      <View
        row
        className="relative flex shrink-0 items-center self-stretch"
      >
        <View row className="flex items-center gap-2">
          <IconButton
            onClick={onAdd}
            aria-label="Create task"
            className="bg-primary text-primary-foreground hover:bg-accent"
          >
            <Plus size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton
            onClick={() => navigate({ to: "/settings" })}
            aria-label="Settings"
            className="bg-surface"
          >
            <Settings size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </View>
      </View>
    </View>
  )
}
