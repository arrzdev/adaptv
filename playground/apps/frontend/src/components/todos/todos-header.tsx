import { useNavigate } from "@tanstack/react-router"
import { Plus, Settings } from "lucide-react"
import { TasksTitle } from "@/components/navigation/tasks-title"
import { SyncStatusBar } from "@/components/todos/sync-status-bar"
import type { TodoFilter } from "@/components/todos/todo-filter"
import { IconButton } from "@/components/ui"
import type { Deck } from "@/data/collections/decks/schema"
import { useAppVibrate } from "@/hooks/use-app-vibrate"
import { useAuth } from "@/providers/auth-provider"

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
  const { hapticPointerHandlers } = useAppVibrate()
  //the sync indicator is a signed-in concept only — guests are fully local
  const { isAuthenticated } = useAuth()
  const createHandlers = hapticPointerHandlers(onAdd, "ok")
  const settingsHandlers = hapticPointerHandlers(
    () => navigate({ to: "/settings" }),
    "ok",
  )
  const archivedHandlers = hapticPointerHandlers(
    () => onFilterChange("archived"),
    "ok",
  )
  const pendingHandlers = hapticPointerHandlers(
    () => onFilterChange("active"),
    "ok",
  )

  return (
    <header className="flex shrink-0 items-center justify-between gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-y-1">
        <TasksTitle
          as="h1"
          deck={activeDeck}
          className="truncate text-4xl font-semibold tracking-tight text-foreground"
        />
        <p
          className="min-h-lh pl-1 text-sm text-subtle"
          aria-busy={isLoading || undefined}
        >
          {isLoading && "Loading tasks…"}
          {!isLoading && filter === "active" && (
            <>
              {activeCount} pending
              <span aria-hidden> • </span>
              <button
                type="button"
                onClick={archivedHandlers.onClick}
                className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
              >
                {archivedCount} archived
              </button>
            </>
          )}
          {!isLoading && filter === "archived" && (
            <>
              <button
                type="button"
                onClick={pendingHandlers.onClick}
                className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
              >
                {activeCount} pending
              </button>
              <span aria-hidden> • </span>
              {archivedCount} archived
            </>
          )}
        </p>
      </div>
      {/* self-stretch + items-center keeps the button row vertically centered
          against the title/subtitle block; the sync indicator is absolutely
          positioned on the subtitle line, so mounting it on sign-in never
          nudges the buttons */}
      <div className="relative flex shrink-0 items-center self-stretch">
        <div className="flex items-center gap-2">
          <IconButton
            onClick={createHandlers.onClick}
            aria-label="Create task"
            className="bg-primary text-primary-foreground hover:bg-accent"
          >
            <Plus size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <IconButton
            onClick={settingsHandlers.onClick}
            aria-label="Settings"
            className="bg-surface"
          >
            <Settings size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        </div>
        {isAuthenticated && (
          <div className="absolute inset-x-0 bottom-0 flex translate-y-[3px]">
            <SyncStatusBar />
          </div>
        )}
      </div>
    </header>
  )
}
