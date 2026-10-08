import { Pressable, Text, View } from "adaptv/components"
import { Archive, ArchiveRestore, Clock, Flag, Trash2 } from "lucide-react"
import { AppSwipeable, Checkbox, IconButton } from "@/components/ui"
import { dueRelativeLabel, dueTone } from "@/data/collections/todos/dates"
import {
  priorityLabel,
  priorityTextClassName,
} from "@/data/collections/todos/priority"
import type { Todo } from "@/data/collections/todos/schema"
import { cn } from "@/utils/cn"

//keeps a press on the checkbox to itself, so it never reaches the row's drag
function stopPropagation(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

type TodoCardProps = {
  todo: Todo
  /**
   * `active` (default) shows the interactive checkbox with Archive + Delete swipe
   * actions. `archived` locks the checkbox checked, hides the due/priority meta,
   * and swaps the leading swipe action for Unarchive.
   */
  variant?: "active" | "archived"
  onToggleChecked: (checked: boolean) => void
  onOpen: () => void
  onArchive: () => void
  onUnarchive: () => void
  onDelete: () => void
  /**
   * Reorder mode. The row's dnd-kit long-press owns drag-to-reorder, so tap-to-
   * open rides a plain `onClick` (the row suppresses the post-drag click) and the
   * checkbox stops pointer, mouse and touch propagation so it can't arm a drag.
   * Swipe-to-delete stays available — a horizontal swipe beats the drag's
   * hold-delay. @default false
   */
  dragMode?: boolean
  /**
   * Fires when the swipe action opens (`true`) or closes (`false`). In drag mode
   * the row uses this to disable its drag while open, so an open card is dismissed
   * (not lifted) — avoiding a half-open card snapping shut under the drag overlay.
   */
  onSwipeOpenChange?: (open: boolean) => void
}

export function TodoCard({
  todo,
  variant = "active",
  onToggleChecked,
  onOpen,
  onArchive,
  onUnarchive,
  onDelete,
  dragMode = false,
  onSwipeOpenChange,
}: TodoCardProps) {
  const isArchived = variant === "archived"

  const dueAt = todo.dueAt
  const hasPriority = todo.priority !== undefined
  //archived todos drop their due date — a deadline on a done-and-filed task reads
  //as noise — but keep priority. no meta + single line stays the common case:
  //center the row on the checkbox; with meta the checkbox nudges down to the title
  const showDue = !isArchived && dueAt !== undefined
  const showPriority = hasPriority
  const showMeta = showDue || showPriority
  //completed todos carry no urgency — keep them neutral
  const tone = dueAt && !todo.checked ? dueTone(dueAt) : "default"
  //narrow once here so the JSX can gate on the `hasDue` predicate below
  const dueLabel = dueAt !== undefined ? dueRelativeLabel(dueAt) : ""

  const bodyClassName = "flex min-w-0 flex-1 flex-col gap-y-1.5 text-left"
  const body = (
    <>
      <Text
        render={
          <p
            className={cn(
              "line-clamp-2 [overflow-wrap:anywhere] text-base font-medium leading-snug text-foreground",
              todo.checked && "text-muted line-through",
            )}
          />
        }
      >
        {todo.title}
      </Text>
      {/* meta: due leads, then priority — archived tasks show priority only */}
      {showMeta && (
        <View
          row
          className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
        >
          {showDue && (
            <Text
              className={cn(
                "inline-flex items-center gap-x-1",
                tone === "default" && "text-muted",
                tone === "soon" && "text-warning",
                tone === "overdue" && "text-error",
              )}
            >
              <Clock aria-hidden className="size-3" />
              {dueLabel}
            </Text>
          )}
          {showDue && showPriority && (
            <Text aria-hidden className="text-muted">
              ·
            </Text>
          )}
          {showPriority && (
            <Text
              className={cn(
                "inline-flex items-center gap-x-1 font-medium",
                priorityTextClassName(todo.priority),
              )}
            >
              <Flag aria-hidden className="size-3" />
              {priorityLabel(todo.priority)}
            </Text>
          )}
        </View>
      )}
    </>
  )

  const card = (
    <View
      row
      className={cn(
        "flex min-h-full w-full gap-x-3 bg-surface px-4 py-3.5",
        showMeta ? "items-start" : "items-center",
        todo.checked && "opacity-80",
      )}
    >
      {/* in drag mode, keep a checkbox press from arming the row's reorder
          gesture so the box still toggles without starting a drag. dnd-kit's
          Mouse and Touch sensors arm on the row's mousedown and touchstart, not
          on pointerdown, so all three stop here: stopping pointerdown alone let
          a press on the box, carried onto another card, reorder the list */}
      <View
        className={cn(showMeta && "pt-0.5")}
        onPointerDown={dragMode ? stopPropagation : undefined}
        onMouseDown={dragMode ? stopPropagation : undefined}
        onTouchStart={dragMode ? stopPropagation : undefined}
      >
        {/* archived todos lock the box checked — it reads as done but can't be
            toggled; unarchive (swipe) is the way back */}
        <Checkbox
          checked={todo.checked}
          disabled={isArchived}
          onCheckedChange={onToggleChecked}
          aria-label={
            isArchived
              ? "Archived task"
              : todo.checked
                ? "Mark incomplete"
                : "Mark complete"
          }
        />
      </View>
      {/* archived todos are read-only — the body is inert, no tap-to-open */}
      {isArchived && <View className={bodyClassName}>{body}</View>}
      {/* drag mode: a real button so tap-to-open stays keyboard-accessible while
          the dnd-kit drag listeners on the row own the long-press. onPress (not a
          raw onClick) — the row's time-based click guard still swallows the
          trailing tap after a drop */}
      {!isArchived && dragMode && (
        <Pressable
          render={
            <button
              type="button"
              className={cn("clickable", bodyClassName)}
            />
          }
          onPress={onOpen}
        >
          {body}
        </Pressable>
      )}
      {/* tap-to-open through the press engine, not a raw onClick — so a press that
          drags off the card (a scroll or stray move) won't open it on release, and
          the tap still works via keyboard. a horizontal swipe never opens the card:
          the parent Swipeable claims the pointer on lock and vetoes this tap via
          lostpointercapture. */}
      {!isArchived && !dragMode && (
        <Pressable
          render={
            <button
              type="button"
              className={cn("clickable", bodyClassName)}
            />
          }
          onPress={onOpen}
        >
          {body}
        </Pressable>
      )}
    </View>
  )

  // both sort views render the swipe engine for delete. in drag mode the row's
  // dnd-kit long-press (250ms hold) owns reorder, while a horizontal swipe still
  // reveals delete — the two never collide because a swipe moves past the hold's
  // tolerance before the drag arms, and a vertical drag locks the swipe to "v".
  return (
    <AppSwipeable
      className="bg-surface"
      onOpen={() => onSwipeOpenChange?.(true)}
      onClose={() => onSwipeOpenChange?.(false)}
    >
      <AppSwipeable.Content>{card}</AppSwipeable.Content>
      {/* full-bleed swipe actions: a press-scale would gap the flush panels and
          read as broken — the swipe gesture + haptic already confirm the press.
          active → Archive + Delete; archived → Unarchive + Delete */}
      <AppSwipeable.RightActions>
        {!isArchived && (
          <IconButton
            onClick={onArchive}
            aria-label={`Archive ${todo.title}`}
            className="h-full min-w-20 rounded-none bg-success text-primary-foreground hover:bg-success active:scale-100"
          >
            <Archive size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
        {isArchived && (
          <IconButton
            onClick={onUnarchive}
            aria-label={`Unarchive ${todo.title}`}
            className="h-full min-w-20 rounded-none bg-success text-primary-foreground hover:bg-success active:scale-100"
          >
            <ArchiveRestore size={20} strokeWidth={1.75} aria-hidden />
          </IconButton>
        )}
        <IconButton
          onClick={onDelete}
          aria-label={`Delete ${todo.title}`}
          className="h-full min-w-20 rounded-none bg-error text-primary-foreground hover:bg-error active:scale-100"
        >
          <Trash2 size={20} strokeWidth={1.75} aria-hidden />
        </IconButton>
      </AppSwipeable.RightActions>
    </AppSwipeable>
  )
}
