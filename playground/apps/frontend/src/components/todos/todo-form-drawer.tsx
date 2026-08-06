import { useEffect, useMemo, useRef, useState } from "react"
import { DeckPicker } from "@/components/decks/deck-picker"
import { DueDateField } from "@/components/todos/due-date-field"
import { PriorityPicker } from "@/components/todos/priority-picker"
import {
  AppDrawer,
  DrawerActionFooter,
  drawerCancelClassName,
  PrimaryButton,
  TextArea,
} from "@/components/ui"
import type { Deck } from "@/data/collections/decks/schema"
import { normalizePriority } from "@/data/collections/todos/priority"
import { useHaptics } from "@/hooks/use-haptics"

export type TodoFormValue = {
  title: string
  deckId?: string
  priority?: number
  dueAt?: Date
}

type TodoFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitLabel: string
  initialValue?: string
  initialPriority?: number
  initialDueAt?: Date
  decks?: Deck[]
  defaultDeckId?: string | null
  isSubmitting?: boolean
  errorMessage?: string
  onSubmit: (value: TodoFormValue) => void
}

export function TodoFormDrawer({
  open,
  onOpenChange,
  submitLabel,
  initialValue = "",
  initialPriority,
  initialDueAt,
  decks,
  defaultDeckId = null,
  isSubmitting = false,
  errorMessage,
  onSubmit,
}: TodoFormDrawerProps) {
  const haptic = useHaptics()
  const [value, setValue] = useState(initialValue)
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(
    defaultDeckId,
  )
  const [priority, setPriority] = useState<number | null>(
    normalizePriority(initialPriority) ?? null,
  )
  const [dueAt, setDueAt] = useState<Date | null>(initialDueAt ?? null)

  const orderedDecks = useMemo(() => {
    if (!decks || !defaultDeckId) return decks ?? []
    const defaultDeck = decks.find((deck) => deck.id === defaultDeckId)
    if (!defaultDeck) return decks
    return [
      defaultDeck,
      ...decks.filter((deck) => deck.id !== defaultDeckId),
    ]
  }, [decks, defaultDeckId])

  //seed the form only on the closed→open transition. keying off `open` alone
  //re-ran on ANY dep change while open, so a live prop (e.g. defaultDeckId from a
  //sync pull) wiped what the user was typing. the ref gates it to the open edge.
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setValue(initialValue)
      setSelectedDeckId(defaultDeckId)
      setPriority(normalizePriority(initialPriority) ?? null)
      setDueAt(initialDueAt ?? null)
    }
    wasOpenRef.current = open
  }, [open, initialValue, defaultDeckId, initialPriority, initialDueAt])

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return
    haptic.notify("success")
    onSubmit({
      title: trimmed,
      deckId: selectedDeckId ?? undefined,
      priority: priority ?? undefined,
      dueAt: dueAt ?? undefined,
    })
  }

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="flex flex-col gap-y-5 pt-4">
            <div className="flex flex-col gap-y-2">
              <span className="ps-1 text-sm font-medium text-subtle">
                Task
              </span>
              <TextArea
                value={value}
                onChange={setValue}
                onSubmitKey={handleSubmit}
                placeholder="What do you need to do?"
                aria-label="Task description"
                disabled={isSubmitting}
                rows={2}
              />
            </div>
            {decks && decks.length > 0 && (
              <DeckPicker
                decks={orderedDecks}
                value={selectedDeckId}
                onChange={setSelectedDeckId}
              />
            )}
            <PriorityPicker value={priority} onChange={setPriority} />
            <DueDateField value={dueAt} onChange={setDueAt} />

            {/* last in the scroll flow, not pinned — the actions follow the form down */}
            <DrawerActionFooter
              errorMessage={errorMessage}
              action={
                <PrimaryButton
                  className="w-full py-3.5 text-base font-semibold leading-none"
                  onClick={handleSubmit}
                  hapticOnPress={false}
                  loading={isSubmitting}
                  disabled={!value.trim()}
                >
                  {submitLabel}
                </PrimaryButton>
              }
              cancel={
                <AppDrawer.Close
                  type="button"
                  onClick={() => haptic.impact("light")}
                  className={drawerCancelClassName}
                >
                  Cancel
                </AppDrawer.Close>
              }
            />
          </AppDrawer.Shell>
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
}
