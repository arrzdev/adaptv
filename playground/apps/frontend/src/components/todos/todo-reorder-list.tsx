import type { SwipeableGroupHandle } from "@arrzdev/adaptv/components"
import type { DragEndEvent, DragStartEvent, Modifier } from "@dnd-kit/core"
import { closestCenter, DndContext, DragOverlay } from "@dnd-kit/core"
import { restrictToVerticalAxis } from "@dnd-kit/modifiers"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Transition } from "motion/react"
import { motion } from "motion/react"
import { useCallback, useRef, useState } from "react"
import { TodoCard } from "@/components/todos/todo-card"
import { AppSwipeable } from "@/components/ui"
import type { Todo } from "@/data/collections/todos/schema"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"
import { useSortableReorder } from "@/hooks/use-sortable-reorder"
import { cn } from "@/utils/cn"

//a click landing within this window after a drop is the drag's trailing click —
//swallow it so a reordered card doesn't also open
const CLICK_AFTER_DRAG_MS = 250

//framer's layout FLIP animates a checked task down into the completed run (same
//mechanism the grouped sorts use). zero bounce so it eases to a stop.
const LIST_TRANSITION: Transition = {
  type: "spring",
  bounce: 0,
  duration: 0.4,
}

type TodoReorderListProps = {
  /** Draggable tasks, in the user's custom order. */
  pending: Todo[]
  /** Checked tasks — pinned below the pending run, not draggable. */
  completed: Todo[]
  /** Persist a new order — pending ids top-to-bottom as rendered. */
  onReorder: (orderedIds: string[]) => void
  onToggleChecked: (id: string, checked: boolean) => void
  onOpenTodo: (todo: Todo) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * The custom-sort task list: one continuous dnd-kit list where the pending tasks
 * drag to reorder (long-press lifts a card into a {@link DragOverlay}) and the
 * checked tasks pin below, non-draggable. Because pending + completed share a
 * single {@link SortableContext}, a checked task keeps its DOM node as it moves
 * to the completed run, so dnd-kit FLIP-animates it there instead of snapping
 * (built on dnd-kit rather than framer's Reorder, which froze during auto-scroll).
 */
export function TodoReorderList({
  pending,
  completed,
  onReorder,
  onToggleChecked,
  onOpenTodo,
  onArchive,
  onUnarchive,
  onDelete,
}: TodoReorderListProps) {
  const reduceMotion = useAppReducedMotion()
  //drag reorders the pending run only; completed ids never reach onReorder
  const {
    activeId,
    setActiveId,
    items: pendingItems,
    disabled,
    sensors,
    onDragEnd,
  } = useSortableReorder(pending, onReorder)
  //timestamp of the last drop — guards the trailing click (see CLICK_AFTER_DRAG_MS)
  const lastDropAt = useRef(0)
  //spring every open swipe action shut the instant a drag begins (see onDragStart)
  const swipeGroupRef = useRef<SwipeableGroupHandle>(null)

  //pending (draggable) then completed (pinned) — one list, one sortable context
  const rows = [...pendingItems, ...completed]
  const ids = rows.map((todo) => todo.id)
  const activeTodo = activeId
    ? (rows.find((todo) => todo.id === activeId) ?? null)
    : null

  //the ul, so a drag can be clamped to just the unchecked region (see the
  //dragBounds modifier) — checked rows already can't be drop targets (disabled)
  const listRef = useRef<HTMLUListElement>(null)
  //pending region bounds (top of first pending row → bottom of last), captured on
  //drag start; the modifier clamps the lifted card to this range so it can't be
  //dragged down over the checked run
  const dragBounds = useRef<{ top: number; bottom: number } | null>(null)

  const clampToPending: Modifier = ({ transform, draggingNodeRect }) => {
    const bounds = dragBounds.current
    if (!bounds || !draggingNodeRect) return transform
    let { y } = transform
    if (draggingNodeRect.top + y < bounds.top) {
      y = bounds.top - draggingNodeRect.top
    }
    if (draggingNodeRect.bottom + y > bounds.bottom) {
      y = bounds.bottom - draggingNodeRect.bottom
    }
    return { ...transform, y }
  }

  function captureDragBounds() {
    const list = listRef.current
    if (!list) return
    const items = [...list.children].slice(0, pendingItems.length)
    const first = items[0]?.getBoundingClientRect()
    const last = items[items.length - 1]?.getBoundingClientRect()
    dragBounds.current =
      first && last ? { top: first.top, bottom: last.bottom } : null
  }

  function handleOpen(todo: Todo) {
    //swallow the drag's trailing click so a reorder doesn't also open the task
    if (Date.now() - lastDropAt.current < CLICK_AFTER_DRAG_MS) return
    onOpenTodo(todo)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      //vertical only, and clamped to the unchecked region so the lifted card
      //can't be dragged down over the checked run
      modifiers={[restrictToVerticalAxis, clampToPending]}
      onDragStart={(event: DragStartEvent) => {
        //starting a drag on any card springs every open swipe action shut, so the
        //lifted card (and the rest) animate closed instead of snapping
        swipeGroupRef.current?.closeAll()
        captureDragBounds()
        setActiveId(String(event.active.id))
      }}
      onDragEnd={(event: DragEndEvent) => {
        lastDropAt.current = Date.now()
        onDragEnd(event)
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <AppSwipeable.Group ref={swipeGroupRef}>
        <SortableContext
          items={ids}
          strategy={verticalListSortingStrategy}
        >
          <ul ref={listRef} className="relative flex w-full flex-col">
            {rows.map((todo) => (
              <TodoSortableRow
                key={todo.id}
                todo={todo}
                //completed tasks pin in place; a single pending task can't reorder
                dragDisabled={disabled || todo.checked}
                reduceMotion={reduceMotion}
                isActive={activeId === todo.id}
                isAnyDragging={activeId !== null}
                onToggleChecked={onToggleChecked}
                onOpen={handleOpen}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </AppSwipeable.Group>
      {/* the lifted card — same size as in the list (no scale, so the drop lands
          cleanly); it reads as lifted because the rest fade behind it */}
      <DragOverlay dropAnimation={reduceMotion ? null : undefined}>
        {activeTodo && (
          <div className="w-full">
            <TodoCard
              todo={activeTodo}
              dragMode
              onToggleChecked={() => {}}
              onOpen={() => {}}
              onArchive={() => {}}
              onUnarchive={() => {}}
              onDelete={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

type TodoSortableRowProps = {
  todo: Todo
  /** Drag is blocked (checked task, single pending task, or an open swipe). */
  dragDisabled: boolean
  reduceMotion: boolean
  /** This card is the one lifted into the overlay (its slot is the hole). */
  isActive: boolean
  /** Some card in the list is being dragged. */
  isAnyDragging: boolean
  onToggleChecked: (id: string, checked: boolean) => void
  onOpen: (todo: Todo) => void
  onArchive: (id: string) => void
  onUnarchive: (id: string) => void
  onDelete: (id: string) => void
}

function TodoSortableRow({
  todo,
  dragDisabled,
  reduceMotion,
  isActive,
  isAnyDragging,
  onToggleChecked,
  onOpen,
  onArchive,
  onUnarchive,
  onDelete,
}: TodoSortableRowProps) {
  //an open swipe action blocks this row's drag: the card is dismissed, not lifted
  //(dragging an open card snaps it shut under the overlay — see onSwipeOpenChange)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({
    id: todo.id,
    disabled: dragDisabled || swipeOpen,
  })
  //the row is its own keyboard activator. dnd-kit starts a keyboard drag on
  //Space/Enter from ANY descendant unless an activator is set, so Space on a
  //task's checkbox, or Enter on a deck's Edit button, also lifted the row into
  //a drag. With the li as the activator, only a key pressed on the focused row
  //itself picks it up
  const setRowRef = useCallback(
    (node: HTMLLIElement | null) => {
      setNodeRef(node)
      setActivatorNodeRef(node)
    },
    [setNodeRef, setActivatorNodeRef],
  )
  //drop dnd-kit's role="button": this li wraps real <button>s, and a
  //button-role node containing buttons is invalid nested interactive content.
  //drop its aria-disabled too — without the role it no longer describes the
  //drag handle, and every control inside inherits it, so a row that merely
  //can't be dragged read its checkbox and buttons as disabled to a screen
  //reader. the drag listeners are untouched, so drag still works
  const {
    role,
    "aria-disabled": cannotDrag,
    ...sortableAttributes
  } = attributes
  //a row that cannot be dragged is not a sortable item: no tab stop that Space
  //cannot pick up, no "sortable" role description, and no drag instructions
  const dragAttributes = cannotDrag ? {} : sortableAttributes

  return (
    <motion.li
      ref={setRowRef}
      //framer FLIPs the row to its new slot when the list reorders (a check),
      //the same way the grouped sorts animate. OFF during a drag: dnd-kit then
      //owns the transforms and its collision rects, and the two must not fight.
      layout={reduceMotion || isAnyDragging ? false : "position"}
      transition={LIST_TRANSITION}
      style={{
        //dnd-kit's transform/transition apply only while dragging (idle → none),
        //so they never collide with framer's layout FLIP
        transform: CSS.Transform.toString(transform),
        transition: reduceMotion ? undefined : transition,
        //pan-y keeps a vertical flick scrolling at rest; the long-press delay is
        //what promotes the gesture to a drag
        touchAction: "pan-y",
      }}
      className={cn(
        "relative w-full select-none rounded-md",
        //per-item spacing (a flex gap fights the sortable transforms)
        "[&:not(:last-child)]:mb-4",
        "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]",
        !reduceMotion && "transition-opacity duration-200 ease-out",
        //the lifted card lives in the overlay; the rest fade so it stands out —
        //and its own slot becomes an empty hole that the gap animates to
        isAnyDragging && !isActive && "opacity-40",
        isActive && "opacity-0",
      )}
      {...dragAttributes}
      {...listeners}
    >
      <TodoCard
        todo={todo}
        dragMode
        onToggleChecked={(checked) => onToggleChecked(todo.id, checked)}
        onOpen={() => onOpen(todo)}
        onArchive={() => onArchive(todo.id)}
        onUnarchive={() => onUnarchive(todo.id)}
        onDelete={() => onDelete(todo.id)}
        onSwipeOpenChange={setSwipeOpen}
      />
    </motion.li>
  )
}
