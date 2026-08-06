import { Pressable, Text, View } from "@arrzdev/adaptv/components"
import { useAppState } from "@arrzdev/adaptv/hooks"
import { cn } from "@arrzdev/adaptv/utils"
import { Loader2 } from "lucide-react"
import type { Transition } from "motion/react"
import { motion } from "motion/react"
import type { ReactNode } from "react"
import { Activity, useEffect, useState } from "react"
import { ChillingMascot } from "@/components/illustrations/chilling-mascot"
import { SleepingMascot } from "@/components/illustrations/sleeping-mascot"
import { StressedMascot } from "@/components/illustrations/stressed-mascot"
import { ReservedSvgSpace } from "@/components/reserved-svg-space"
import { TodoCard } from "@/components/todos/todo-card"
import type { TodoFilter } from "@/components/todos/todo-filter"
import { TodoReorderList } from "@/components/todos/todo-reorder-list"
import { AppSwipeable, PrimaryButton } from "@/components/ui"
import type { Todo } from "@/data/collections/todos/schema"
import type { TodoSection } from "@/data/collections/todos/sort"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"
import { useHaptics } from "@/hooks/use-haptics"

type EmptyCreature = "sleeping" | "chilling" | "stressed"

function isPast8pmNow() {
  return new Date().getHours() >= 20
}

function useIsPast8pmLocal() {
  //seed from the real clock so the correct mascot paints on the first frame
  //(the old mount effect flashed the wrong one), then re-check when the app is
  //brought back to the foreground so a session left open crosses the 8pm boundary.
  //useAppState covers both web (visibilitychange/pageshow) and a native WebView
  //resume — the latter is not a browser focus event, so a raw listener misses it.
  const [isPast8pm, setIsPast8pm] = useState(isPast8pmNow)
  const appState = useAppState()

  useEffect(() => {
    if (appState === "active") setIsPast8pm(isPast8pmNow())
  }, [appState])

  return isPast8pm
}

const EMPTY_CREATURE_SPACE_CLASS = "w-[min(88vw,20rem,60dvh)]"

//fill the viewport below the page chrome so the empty-state mascot centers in the
//visible list area instead of pinning to the top of the list container. 20rem is a
//safe allowance for the header + deck tabs + safe-area padding above the list, so an
//empty page never grows tall enough to scroll.
const EMPTY_STATE_FILL_CLASS = "min-h-[calc(100dvh-20rem)]"

function resolveEmptyState(
  filter: TodoFilter,
  hasNoTodos: boolean,
  isPast8pm: boolean,
): { creature: EmptyCreature; message: string } {
  if (hasNoTodos) {
    return {
      creature: "sleeping",
      message: "Tap + Create to create your first task.",
    }
  }

  if (filter === "active") {
    if (isPast8pm) {
      return {
        creature: "sleeping",
        message: "Nothing left, you've earned the rest 😴",
      }
    }
    return {
      creature: "chilling",
      message: "All done — enjoy the break.",
    }
  }

  return {
    creature: "stressed",
    message: "You got things to do, go finish them!",
  }
}

type ArchivedListContextProps = {
  onShowPending: () => void
}

function ArchivedListContext({ onShowPending }: ArchivedListContextProps) {
  const haptic = useHaptics()

  return (
    <Text render={<p className="pl-1 text-sm text-subtle" />}>
      You are seeing your archived tasks,{" "}
      <Pressable
        render={
          <button
            type="button"
            className="underline underline-offset-2 decoration-current/50 hover:decoration-current"
          />
        }
        onPress={() => {
          haptic.impact("light")
          onShowPending()
        }}
      >
        go back
      </Pressable>
      .
    </Text>
  )
}

type TodoListProps = {
  sections: TodoSection[]
  /**
   * Checked-but-active todos, pinned to the bottom of the active list (newest-
   * checked first). Empty in the archived view. Rendered as a trailing block
   * after the grouped/reorder sections — never draggable.
   */
  completedTodos: Todo[]
  filter: TodoFilter
  hasNoTodos?: boolean
  isLoading?: boolean
  isError: boolean
  errorMessage?: string
  /** Control rendered on the right of the first section's title row (e.g. sort menu). */
  headerAction?: ReactNode
  /** When set, the list is in custom sort: render a single drag-to-reorder section. */
  onReorder?: (orderedIds: string[]) => void
  onRetry: () => void
  onShowPending: () => void
  onToggleChecked: (id: string, checked: boolean) => void
  onOpenTodo: (todo: Todo) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}

//shared row handlers, bundled so the section/completed/archived lists render the
//same TodoCard without threading six props at every callsite
type TodoCardHandlers = {
  variant: "active" | "archived"
  onToggleChecked: (id: string, checked: boolean) => void
  onOpenTodo: (todo: Todo) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}

function renderTodoCard(todo: Todo, handlers: TodoCardHandlers) {
  return (
    <TodoCard
      todo={todo}
      variant={handlers.variant}
      onToggleChecked={(checked) =>
        handlers.onToggleChecked(todo.id, checked)
      }
      onOpen={() => handlers.onOpenTodo(todo)}
      onArchive={() => handlers.onArchive(todo.id)}
      onUnarchive={() => handlers.onUnarchive(todo.id)}
      onDelete={() => handlers.onDelete(todo.id)}
    />
  )
}

//apple-notes checkbox feel: checking a task glides it to the bottom as a pure
//positional slide (the `layout` FLIP) and the rest close the gap — no scale, no
//opacity, no pop. rows ONLY ever translate; a created/removed row just appears or
//vanishes while its neighbours slide. zero bounce so it eases to a stop.
const LIST_TRANSITION: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.4,
}

//the active view renders as ONE flat sequence — every section header, task and
//the completed block share a single layout scope. keying each task row by its id
//(stable whether it currently sits in a section or the completed block) lets
//`layout` FLIP a checked task the whole way down, past every section, to the
//bottom: the stack animates as a whole, not as separate lists. archiving/deleting
//exits a row (the rest slide up) and re-sorting reflows everything. the
//custom-sort drag list owns its own transforms (dnd-kit) and doesn't route here.

type FlatRow =
  | { type: "header"; key: string; title: string; action: ReactNode }
  | { type: "todo"; key: string; todo: Todo }

function buildFlatRows(
  sections: TodoSection[],
  completedTodos: Todo[],
  completedHeader: boolean,
  headerAction: ReactNode,
): FlatRow[] {
  const rows: FlatRow[] = []
  //the sort control rides the first header (aligned with its title), wherever
  //that first header lands — a pending section or, if all tasks are checked, the
  //"Completed" header. so it stays put and never disappears
  let pendingAction = headerAction

  for (const section of sections) {
    if (section.title) {
      rows.push({
        type: "header",
        key: `header:${section.key}`,
        title: section.title,
        action: pendingAction,
      })
      pendingAction = null
    }
    for (const todo of section.todos) {
      rows.push({ type: "todo", key: todo.id, todo })
    }
  }

  if (completedTodos.length > 0) {
    if (completedHeader) {
      rows.push({
        type: "header",
        key: "header:completed",
        title: "Completed",
        action: pendingAction,
      })
      pendingAction = null
    }
    for (const todo of completedTodos) {
      rows.push({ type: "todo", key: todo.id, todo })
    }
  }

  return rows
}

//spacing rides a flex `gap` (uniform 16px) plus extra top padding above a
//section header. it's padding, never margin: the layout FLIP measures the border
//box (getBoundingClientRect), which excludes margin — a margin-based gap makes
//the slide snap instead of animate.
function rowClass(rows: FlatRow[], index: number): string {
  const isHeader = rows[index].type === "header"
  return cn("relative w-full", isHeader && index > 0 && "pt-3")
}

function FlatHeader({
  title,
  action,
}: {
  title: string
  action?: ReactNode
}) {
  return (
    <View row className="flex min-h-7 items-center gap-2">
      <Text
        // biome-ignore lint/a11y/useHeadingContent: the title flows through Text's render prop into the h2 at runtime (cloneElement), which the static check can't see
        render={<h2 className="pl-1 text-sm font-medium text-subtle" />}
      >
        {title}
      </Text>
      {action && <View className="ml-auto">{action}</View>}
    </View>
  )
}

type TodoFlatListProps = {
  sections: TodoSection[]
  completedTodos: Todo[]
  /** Show a "Completed" header above the checked block. */
  completedHeader: boolean
  headerAction?: ReactNode
  /** Enable the layout slide. Off until the first user mutation so the initial
   *  data load (and background sync) settles in place instead of animating. */
  animate: boolean
  handlers: TodoCardHandlers
}

function TodoFlatList({
  sections,
  completedTodos,
  completedHeader,
  headerAction,
  animate,
  handlers,
}: TodoFlatListProps) {
  const reducedMotion = useAppReducedMotion()
  const rows = buildFlatRows(
    sections,
    completedTodos,
    completedHeader,
    headerAction ?? null,
  )

  if (reducedMotion) {
    return (
      <View className="relative flex w-full flex-col gap-y-4">
        {rows.map((row, index) => (
          <View key={row.key} className={rowClass(rows, index)}>
            {row.type === "header" && (
              <FlatHeader title={row.title} action={row.action} />
            )}
            {row.type === "todo" && renderTodoCard(row.todo, handlers)}
          </View>
        ))}
      </View>
    )
  }

  return (
    <View className="relative flex w-full flex-col gap-y-4">
      {/* section headers snap straight to their slot (plain Views — no layout).
          only task rows translate: layout="position" FLIPs a checked task to the
          completed block while the rest close the gap. no opacity/scale, so a
          created/removed row just appears or vanishes. gated on `animate` so
          nothing moves on the initial data load or a background sync. */}
      {rows.map((row, index) => {
        if (row.type === "header") {
          return (
            <View key={row.key} className={rowClass(rows, index)}>
              <FlatHeader title={row.title} action={row.action} />
            </View>
          )
        }
        return (
          <motion.div
            key={row.key}
            layout={animate ? "position" : false}
            transition={LIST_TRANSITION}
            className={rowClass(rows, index)}
          >
            {renderTodoCard(row.todo, handlers)}
          </motion.div>
        )
      })}
    </View>
  )
}

export function TodoList({
  sections,
  completedTodos,
  filter,
  headerAction,
  onReorder,
  hasNoTodos = false,
  isLoading = false,
  isError,
  errorMessage,
  onRetry,
  onShowPending,
  onToggleChecked,
  onOpenTodo,
  onArchive,
  onUnarchive,
  onDelete,
}: TodoListProps) {
  const reducedMotion = useAppReducedMotion()
  const isPast8pm = useIsPast8pmLocal()
  //enable the slide only after the first commit, so the initial data load settles
  //in place instead of animating. flipped once on mount (a useEffect, so it fires
  //regardless of tab visibility — rAF would stall on a backgrounded load), and
  //independent of any mutation — so `layout` has a stable baseline by the time the
  //user acts, and the first check still animates. (gating on "has interacted"
  //instead collapses into the same render as the reorder and snaps the first one.)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(true)
  }, [])

  const isArchived = filter === "archived"

  const handlers: TodoCardHandlers = {
    variant: isArchived ? "archived" : "active",
    onToggleChecked,
    onOpenTodo,
    onArchive,
    onUnarchive,
    onDelete,
  }

  const hasContent = sections.length > 0 || completedTodos.length > 0

  let content: ReactNode

  if (isLoading) {
    content = (
      <output
        className="flex min-h-48 flex-col items-center justify-center"
        aria-label="Loading tasks"
      >
        <Loader2
          size={32}
          strokeWidth={2}
          aria-hidden
          className={cn("text-muted", !reducedMotion && "animate-spin")}
        />
      </output>
    )
  } else if (isError) {
    content = (
      <View className="flex min-h-32 flex-col items-center gap-y-4 text-center">
        <ReservedSvgSpace className={EMPTY_CREATURE_SPACE_CLASS}>
          <StressedMascot />
        </ReservedSvgSpace>
        <Text
          render={<p className="whitespace-pre-line text-sm text-error" />}
        >
          {errorMessage || "Could not load tasks."}
        </Text>
        <PrimaryButton onClick={onRetry} className="w-fit">
          Retry
        </PrimaryButton>
      </View>
    )
  } else if (onReorder && hasContent) {
    //custom sort: a persistent "Custom" header over one continuous reorder list —
    //pending tasks drag, checked tasks pin below. one component (one sortable
    //context) so a checked task animates down into the completed run instead of
    //snapping across a boundary, and there's no empty-list gap when all are checked
    const pendingTodos = sections[0]?.todos ?? []
    content = (
      <View className="flex flex-col gap-y-4">
        <FlatHeader title="Custom" action={headerAction} />
        <TodoReorderList
          pending={pendingTodos}
          completed={completedTodos}
          onReorder={onReorder}
          onToggleChecked={onToggleChecked}
          onOpenTodo={onOpenTodo}
          onArchive={onArchive}
          onUnarchive={onUnarchive}
          onDelete={onDelete}
        />
      </View>
    )
  } else if (isArchived && hasContent) {
    //the "you're seeing archived tasks" line takes the same header-row slot the
    //active view uses for its section title + sort button, so switching views
    //doesn't shift the list down
    content = (
      <View className="flex flex-col gap-y-4">
        <View row className="flex min-h-7 items-center">
          <ArchivedListContext onShowPending={onShowPending} />
        </View>
        <AppSwipeable.Group>
          <TodoFlatList
            sections={sections}
            completedTodos={[]}
            completedHeader={false}
            animate={ready}
            handlers={handlers}
          />
        </AppSwipeable.Group>
      </View>
    )
  } else if (hasContent) {
    //grouped active view: one flat, shared-layout list so a checked task animates
    //the whole way down to the completed block (see TodoFlatList). the sort
    //control rides the first header, aligned with its title
    content = (
      <AppSwipeable.Group>
        <TodoFlatList
          sections={sections}
          completedTodos={completedTodos}
          completedHeader={!isArchived}
          headerAction={headerAction}
          animate={ready}
          handlers={handlers}
        />
      </AppSwipeable.Group>
    )
  } else {
    const { creature, message } = resolveEmptyState(
      filter,
      hasNoTodos,
      isPast8pm,
    )

    content = (
      <View
        className={cn(
          "relative flex flex-col items-center justify-center gap-y-2 text-center",
          EMPTY_STATE_FILL_CLASS,
        )}
      >
        {filter === "archived" && (
          //overlay the archived context so it doesn't push the mascot down —
          //the mascot centers in the same region whether or not this line shows,
          //so toggling active↔archived never shifts it vertically
          <View className="absolute inset-x-0 top-0 text-left">
            <ArchivedListContext onShowPending={onShowPending} />
          </View>
        )}
        <Activity mode={creature === "sleeping" ? "visible" : "hidden"}>
          <ReservedSvgSpace className={EMPTY_CREATURE_SPACE_CLASS}>
            <SleepingMascot />
          </ReservedSvgSpace>
        </Activity>
        <Activity mode={creature === "chilling" ? "visible" : "hidden"}>
          <ReservedSvgSpace className={EMPTY_CREATURE_SPACE_CLASS}>
            <ChillingMascot />
          </ReservedSvgSpace>
        </Activity>
        <Activity mode={creature === "stressed" ? "visible" : "hidden"}>
          <ReservedSvgSpace className={EMPTY_CREATURE_SPACE_CLASS}>
            <StressedMascot />
          </ReservedSvgSpace>
        </Activity>
        <Text render={<p className="max-w-xs text-sm text-muted" />}>
          {message}
        </Text>
      </View>
    )
  }

  return <View className="flex flex-col gap-y-4">{content}</View>
}
