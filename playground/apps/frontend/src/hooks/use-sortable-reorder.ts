import type { DragEndEvent } from "@dnd-kit/core"
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable"
import { useEffect, useRef, useState } from "react"

//hold-to-lift before a touch drag starts; a quick swipe still scrolls the page
const LONG_PRESS_MS = 250
//movement (px) tolerated during the hold before it's read as a scroll, not a drag
const LONG_PRESS_TOLERANCE = 8
//how far the mouse travels before a drag begins (a click stays under this)
const MOUSE_DRAG_DISTANCE = 8

type Identified = { id: string }

/**
 * Shared state + sensors for a long-press dnd-kit sortable list. Holds a local
 * order while dragging and until the persisted `source` catches up — so the
 * dropped order never flickers back mid-commit — and commits the reordered ids
 * once on drop. The Touch sensor (not Pointer) lets dnd-kit block the page scroll
 * once the long-press is recognised, so a vertical swipe still scrolls at rest;
 * the mouse drags on a small move.
 *
 * Callers own the rendering (overlay vs in-place) and any haptics; wrap the
 * returned handlers to add `onDragStart`/`onDragOver` side effects.
 */
export function useSortableReorder<T extends Identified>(
  source: T[],
  onReorder: (orderedIds: string[]) => void,
) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [override, setOverride] = useState<T[] | null>(null)

  const items = override ?? source
  const itemsRef = useRef(items)
  itemsRef.current = items
  const disabled = source.length < 2

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: MOUSE_DRAG_DISTANCE },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: LONG_PRESS_MS,
        tolerance: LONG_PRESS_TOLERANCE,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  //drop the snapshot once the live source matches it (external store sync)
  useEffect(() => {
    if (!override || activeId) return
    const live = source.map((item) => item.id).join(" ")
    const held = override.map((item) => item.id).join(" ")
    if (live === held) setOverride(null)
  }, [source, override, activeId])

  //commit once, on drop, from the final active/over pair — never mutate the order
  //mid-drag (that loops with the sort strategy and makes the list thrash)
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return
    const base = itemsRef.current
    const from = base.findIndex((item) => item.id === active.id)
    const to = base.findIndex((item) => item.id === over.id)
    if (from === -1 || to === -1) return
    const next = arrayMove(base, from, to)
    setOverride(next)
    onReorder(next.map((item) => item.id))
  }

  return { activeId, setActiveId, items, disabled, sensors, onDragEnd }
}
