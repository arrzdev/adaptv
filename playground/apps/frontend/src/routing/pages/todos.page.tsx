import { Text } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useEffect, useMemo, useState } from "react"
import { DeckTabs } from "@/components/decks/deck-tabs"
import { PageWithSmoothEdges } from "@/components/page"
import { CreateTaskDrawer } from "@/components/todos/create-task-drawer"
import { EditTaskDrawer } from "@/components/todos/edit-task-drawer"
import type { TodoFilter } from "@/components/todos/todo-filter"
import { TODO_FILTER_VALUES } from "@/components/todos/todo-filter"
import { TodoList } from "@/components/todos/todo-list"
import {
  TodoSortDrawer,
  TodoSortTrigger,
} from "@/components/todos/todo-sort-menu"
import { TodosHeader } from "@/components/todos/todos-header"
import { useDecks } from "@/data/collections/decks/queries"
import {
  archiveTodo,
  deleteTodo,
  reorderTodos,
  unarchiveTodo,
  updateTodoChecked,
} from "@/data/collections/todos/mutations"
import { useTodos } from "@/data/collections/todos/queries"
import type { Todo } from "@/data/collections/todos/schema"
import type { TodoSection, TodoSort } from "@/data/collections/todos/sort"
import {
  groupTodos,
  sortArchived,
  sortCompleted,
  TODO_SORT_VALUES,
} from "@/data/collections/todos/sort"
import { useConfetti } from "@/hooks/use-confetti"
import { useDataMutation } from "@/hooks/use-data-mutation"
import { useHaptics } from "@/hooks/use-haptics"
import { usePersistentState } from "@/hooks/use-persistent-state"
import { useAppDb } from "@/providers/app-db-provider"

export const Route = createFileRoute("/_providers/")({
  component: TodosPage,
})

//view preferences persisted to localStorage so a reload reopens the same view
const TODO_FILTER_KEY = "todos:filter"
const TODO_SORT_KEY = "todos:sort"
const TODO_DECK_KEY = "todos:deck"

function parseTodoFilter(raw: string): TodoFilter | null {
  return (TODO_FILTER_VALUES as readonly string[]).includes(raw)
    ? (raw as TodoFilter)
    : null
}

function parseTodoSort(raw: string): TodoSort | null {
  return (TODO_SORT_VALUES as readonly string[]).includes(raw)
    ? (raw as TodoSort)
    : null
}

function identity(value: string): string {
  return value
}

//a selected deck id, or null for the "all decks" view
type DeckId = string | null

function parseDeckId(raw: string): DeckId {
  return raw || null
}

function formatDeckId(value: DeckId): DeckId {
  return value
}

function matchesFilter(todo: Todo, filter: TodoFilter) {
  //archived is now its own state — a checked-but-not-archived todo stays in the
  //active view (pinned to the bottom), only archiving moves it to the archive
  if (filter === "active") return !todo.archived
  return todo.archived
}

function matchesDeck(todo: Todo, deckId: string | null) {
  if (!deckId) return true
  return todo.deckId === deckId
}

function TodosPage() {
  const { error: initError, retry: retryInit } = useAppDb()
  //todos are offline-first + synced across a user's devices via synq;
  //decks stay device-local in synq's local store
  const { data: todos, isLoading: todosLoading } = useTodos()
  const { data: decks, isLoading: decksLoading } = useDecks()
  const [filter, setFilter] = usePersistentState<TodoFilter>(
    TODO_FILTER_KEY,
    "active",
    parseTodoFilter,
    identity,
  )
  const [sort, setSort] = usePersistentState<TodoSort>(
    TODO_SORT_KEY,
    "created",
    parseTodoSort,
    identity,
  )
  const [storedDeckId, setStoredDeckId] = usePersistentState<DeckId>(
    TODO_DECK_KEY,
    null,
    parseDeckId,
    formatDeckId,
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [sortOpen, setSortOpen] = useState(false)
  const { fire: fireConfetti, cancel: cancelConfetti } = useConfetti()
  const haptic = useHaptics()
  //one shared slot for the fire-and-forget list actions (toggle/delete/reorder);
  //the create/edit drawers own their own mutation state
  const mutation = useDataMutation()
  const activeDeckId = useMemo(() => {
    if (!storedDeckId) return null
    const exists = decks.some((deck) => deck.id === storedDeckId)
    return exists ? storedDeckId : null
  }, [decks, storedDeckId])

  //a stored deck can outlive the deck it points to (deleted on another load).
  //once decks have loaded, drop the stale id: the view already falls back to
  //"all", and clearing the persisted value stops it resurrecting on next reload
  useEffect(() => {
    if (storedDeckId === null || decksLoading) return
    const exists = decks.some((deck) => deck.id === storedDeckId)
    if (!exists) setStoredDeckId(null)
  }, [decks, decksLoading, storedDeckId, setStoredDeckId])

  const activeDeck = useMemo(() => {
    if (!activeDeckId) return null
    return decks.find((deck) => deck.id === activeDeckId) ?? null
  }, [decks, activeDeckId])

  const createDefaultDeckId = useMemo(() => {
    if (activeDeckId) return activeDeckId
    return decks[0]?.id ?? null
  }, [activeDeckId, decks])

  const filteredTodos = useMemo(
    () =>
      todos.filter(
        (todo) =>
          matchesFilter(todo, filter) && matchesDeck(todo, activeDeckId),
      ),
    [todos, filter, activeDeckId],
  )
  //active view: pending todos group by the chosen sort, checked ones pin to the
  //bottom as a flat completed block. archived view: a single flat list ordered
  //by most-recently-archived, no grouping.
  const { sections, completedTodos } = useMemo<{
    sections: TodoSection[]
    completedTodos: Todo[]
  }>(() => {
    if (filter === "archived") {
      const archived = sortArchived(filteredTodos)
      return {
        sections:
          archived.length > 0
            ? [{ key: "archived", title: "", todos: archived }]
            : [],
        completedTodos: [],
      }
    }
    const pending = filteredTodos.filter((todo) => !todo.checked)
    const completed = filteredTodos.filter((todo) => todo.checked)
    return {
      sections: groupTodos(pending, sort),
      completedTodos: sortCompleted(completed),
    }
  }, [filteredTodos, filter, sort])
  //"pending" excludes both checked and archived; the archived count drives the
  //header's archived link
  const activeCount = useMemo(
    () =>
      todos.filter(
        (todo) =>
          !todo.checked &&
          !todo.archived &&
          matchesDeck(todo, activeDeckId),
      ).length,
    [todos, activeDeckId],
  )
  const archivedCount = useMemo(
    () =>
      todos.filter(
        (todo) => todo.archived && matchesDeck(todo, activeDeckId),
      ).length,
    [todos, activeDeckId],
  )

  const isLoading = initError === null && todosLoading
  const listError = initError

  function handleFilterChange(next: TodoFilter) {
    cancelConfetti()
    setFilter(next)
    mutation.reset()
  }

  function handleDeckChange(nextDeckId: string | null) {
    if (nextDeckId === activeDeckId) return
    cancelConfetti()
    setStoredDeckId(nextDeckId)
    setFilter("active")
    mutation.reset()
  }

  function handleOpenTodo(todo: Todo) {
    //light tick when the edit drawer opens from a task tap
    haptic.impact("light")
    setEditingTodo(todo)
  }

  async function handleToggleChecked(id: string, checked: boolean) {
    //completing the last active task celebrates — but only once the write lands,
    //so a failed toggle (which stays unchecked) doesn't fire confetti
    const completesLast = checked && activeCount === 1
    const ok = await mutation.run(
      () => updateTodoChecked(id, checked),
      "Could not update task.",
    )
    if (ok && completesLast) fireConfetti()
  }

  function handleArchive(id: string) {
    void mutation.run(() => archiveTodo(id), "Could not archive task.")
  }

  function handleUnarchive(id: string) {
    void mutation.run(() => unarchiveTodo(id), "Could not unarchive task.")
  }

  function handleDelete(id: string) {
    void mutation.run(() => deleteTodo(id), "Could not delete task.")
  }

  function handleReorder(orderedIds: string[]) {
    void mutation.run(
      () => reorderTodos(orderedIds),
      "Could not reorder tasks.",
    )
  }

  function handleRetry() {
    if (!initError) return
    retryInit()
  }

  return (
    <PageWithSmoothEdges>
      <TodosHeader
        activeCount={activeCount}
        archivedCount={archivedCount}
        activeDeck={activeDeck}
        filter={filter}
        isLoading={isLoading}
        onAdd={() => setCreateOpen(true)}
        onFilterChange={handleFilterChange}
      />
      {decks.length > 0 && (
        <DeckTabs
          decks={decks}
          value={activeDeckId}
          onChange={handleDeckChange}
        />
      )}
      {mutation.error && (
        <Text
          render={<p className="whitespace-pre-line text-sm text-error" />}
        >
          {mutation.error.message}
        </Text>
      )}
      <TodoList
        sections={sections}
        completedTodos={completedTodos}
        filter={filter}
        hasNoTodos={!todosLoading && todos.length === 0}
        isLoading={isLoading}
        isError={listError !== null}
        errorMessage={listError?.message}
        onRetry={handleRetry}
        onShowPending={() => handleFilterChange("active")}
        onToggleChecked={handleToggleChecked}
        onOpenTodo={handleOpenTodo}
        onArchive={handleArchive}
        onUnarchive={handleUnarchive}
        onDelete={handleDelete}
        // no reorder or sort control in the archived view — it's a fixed
        // most-recently-archived list
        onReorder={
          sort === "custom" && filter !== "archived"
            ? handleReorder
            : undefined
        }
        headerAction={
          filter === "archived" ? undefined : (
            <TodoSortTrigger
              open={sortOpen}
              onOpen={() => setSortOpen(true)}
            />
          )
        }
      />

      <CreateTaskDrawer
        open={createOpen}
        onOpenChange={setCreateOpen}
        decks={decks}
        defaultDeckId={createDefaultDeckId}
        onCreated={() => setFilter("active")}
      />

      <EditTaskDrawer
        todo={editingTodo}
        decks={decks}
        onClose={() => setEditingTodo(null)}
      />

      <TodoSortDrawer
        open={sortOpen}
        onOpenChange={setSortOpen}
        value={sort}
        onChange={(next) => setSort(next)}
      />
    </PageWithSmoothEdges>
  )
}
