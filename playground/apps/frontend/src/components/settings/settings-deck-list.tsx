import { Text, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type {
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from "@dnd-kit/core"
import { closestCenter, DndContext } from "@dnd-kit/core"
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers"
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useRef } from "react"
import { SettingsAddRow } from "@/components/settings/settings-list-row"
import { IconButton } from "@/components/ui"
import { resolveDeckEmoji } from "@/data/collections/decks/constants"
import type { Deck } from "@/data/collections/decks/schema"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"
import { useHaptics } from "@/hooks/use-haptics"
import { useSortableReorder } from "@/hooks/use-sortable-reorder"

export type SettingsDeckListProps = {
  decks: Deck[]
  /** When false the delete action is hidden (last remaining deck). */
  canDelete: boolean
  onCreate: () => void
  /** Persist a new order — ids top-to-bottom as rendered. */
  onReorder: (orderedIds: string[]) => void
  onEdit: (deck: Deck) => void
  onDelete: (deck: Deck) => void
}

/**
 * Decks list for Settings with long-press drag-to-reorder, built on dnd-kit (the
 * same engine as the task list). Holding a row lifts it in place — the rest fade
 * to reveal the page behind them and the lifted row rounds its top corners once
 * it will land in the top slot (the one true card edge; the New deck button is
 * the group's real bottom). The order persists on release.
 */
export function SettingsDeckList({
  decks,
  canDelete,
  onCreate,
  onReorder,
  onEdit,
  onDelete,
}: SettingsDeckListProps) {
  const haptic = useHaptics()
  const reduceMotion = useAppReducedMotion()
  const { activeId, setActiveId, items, disabled, sensors, onDragEnd } =
    useSortableReorder(decks, onReorder)
  //live drop target — drives the per-slot haptic
  const overIdRef = useRef<string | null>(null)

  const ids = items.map((deck) => deck.id)

  function handleDragOver(event: DragOverEvent) {
    const next = event.over ? String(event.over.id) : null
    if (next === overIdRef.current) return
    overIdRef.current = next
    //tick on every slot the dragged deck crosses
    if (next) haptic.selection()
  }

  return (
    //no surface on the wrapper — each row + the add-row paint their own, so a
    //faded row reveals the page behind it during a drag (the task-list lift)
    <View className="overflow-hidden rounded-md">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        //vertical only, and capped to the deck rows so a deck can't be dragged
        //past the first slot or below the last (into the New deck button)
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragStart={(event: DragStartEvent) => {
          setActiveId(String(event.active.id))
          //seed the drop target to the lifted row so the first onDragOver (which
          //reports `over` === the row itself) is a no-op — otherwise it fires a
          //selection tick on top of this lift's medium impact (double buzz)
          overIdRef.current = String(event.active.id)
          haptic.impact("medium")
        }}
        onDragOver={handleDragOver}
        onDragEnd={(event: DragEndEvent) => {
          overIdRef.current = null
          onDragEnd(event)
        }}
        onDragCancel={() => {
          overIdRef.current = null
          setActiveId(null)
        }}
      >
        <SortableContext
          items={ids}
          strategy={verticalListSortingStrategy}
        >
          <ul className="flex flex-col">
            {items.map((deck) => (
              <SettingsDeckRow
                key={deck.id}
                deck={deck}
                canDelete={canDelete}
                disabled={disabled}
                reduceMotion={reduceMotion}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <View
        className={cn(
          "flex flex-col bg-surface",
          !reduceMotion && "transition-opacity duration-200 ease-out",
          //the add row can't be reordered, but fade it with the dimmed deck rows
          //during a drag so the lifted card stays the clear focus
          activeId !== null && "opacity-40",
        )}
      >
        <SettingsAddRow
          icon={Plus}
          label="New deck"
          onPress={() => {
            haptic.impact("light")
            onCreate()
          }}
        />
      </View>
    </View>
  )
}

type SettingsDeckRowProps = {
  deck: Deck
  canDelete: boolean
  disabled: boolean
  reduceMotion: boolean
  onEdit: (deck: Deck) => void
  onDelete: (deck: Deck) => void
}

function SettingsDeckRow({
  deck,
  canDelete,
  disabled,
  reduceMotion,
  onEdit,
  onDelete,
}: SettingsDeckRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
    newIndex,
  } = useSortable({ id: deck.id, disabled })

  //drop dnd-kit's role="button"/tabIndex: this li wraps real <button>s, and a
  //button-role node containing buttons is invalid nested interactive content.
  //the drag listeners are untouched, so drag still works
  const { role, ...dragAttributes } = attributes

  //the lifted row morphs its top corners once it will land in the top slot — the
  //one real card edge (the New deck button is the group's bottom)
  const roundTop = isDragging && newIndex === 0

  //combine dnd-kit's transform transition with the opacity + corner-radius fades
  //so the shift, the dimming and the morph all animate together
  const style = {
    transform: CSS.Transform.toString(transform),
    transition: reduceMotion
      ? undefined
      : [
          transition,
          "opacity 200ms ease-out",
          "border-radius 200ms ease-out",
        ]
          .filter(Boolean)
          .join(", "),
    //pan-y keeps a quick swipe scrolling the page; the long-press promotes it
    touchAction: "pan-y" as const,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        //the surface lives on the whole row so it covers the divider band edge-to-
        //edge — the rows stay glued with no see-through gaps at rest, and a faded
        //row reveals the page behind it during a drag
        "relative select-none bg-surface",
        "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none]",
        //others fade; the lifted row stays solid and rides above them
        isSorting && !isDragging && "opacity-40",
        isDragging && "z-10",
        roundTop && "rounded-t-md",
      )}
      {...dragAttributes}
      {...listeners}
    >
      <View
        row
        className="flex items-center justify-between gap-x-3 px-4 py-4"
      >
        <View row className="flex min-w-0 flex-1 items-center gap-x-3">
          <Text
            className="flex size-5 shrink-0 items-center justify-center text-base leading-none"
            aria-hidden
          >
            {resolveDeckEmoji(deck.emoji)}
          </Text>
          <Text className="truncate text-base font-medium text-foreground">
            {deck.name}
          </Text>
        </View>
        {/* stop pointer-down here so pressing a button never arms the drag */}
        <View
          row
          className="flex shrink-0 items-center gap-x-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconButton
            onClick={() => onEdit(deck)}
            aria-label={`Edit ${deck.name}`}
            className="size-9 bg-transparent hover:bg-secondary"
          >
            <Pencil size={18} strokeWidth={1.75} aria-hidden />
          </IconButton>
          {canDelete && (
            <IconButton
              onClick={() => onDelete(deck)}
              aria-label={`Delete ${deck.name}`}
              className="size-9 bg-transparent text-error hover:bg-secondary"
            >
              <Trash2 size={18} strokeWidth={1.75} aria-hidden />
            </IconButton>
          )}
        </View>
      </View>
      {/* divider in the gap: it dims during a drag, and the lifted row hides its
          own (a lifted card shouldn't carry a seam line) */}
      <View
        className={cn(
          "mx-4 border-b border-border-subtle",
          !reduceMotion && "transition-opacity duration-150",
          isSorting && !isDragging && "opacity-30",
          isDragging && "opacity-0",
        )}
        aria-hidden
      />
    </li>
  )
}
