import { View } from "adaptv/components"
import { useState } from "react"
import {
  AppDrawer,
  DrawerActionFooter,
  drawerCancelClassName,
  HoldToConfirmButton,
} from "@/components/ui"
import { formatCount } from "@/components/ui/format-count"
import { deleteDeck } from "@/data/collections/decks/mutations"
import type { Deck } from "@/data/collections/decks/schema"
import { useTodos } from "@/data/collections/todos/queries"
import { useDataMutation } from "@/hooks/use-data-mutation"
import { useHaptics } from "@/hooks/use-haptics"

type DeleteDeckDrawerProps = {
  /** The deck to delete; `null` keeps the drawer closed (stays mounted for the exit animation). */
  deck: Deck | null
  onClose: () => void
}

//owns "delete a deck": counts the deck's tasks, runs the delete, surfaces its
//error, and closes on success. deleting a deck cascades to its tasks (see the
//mutation), matching the "the deck and its tasks" copy below.
export function DeleteDeckDrawer({
  deck,
  onClose,
}: DeleteDeckDrawerProps) {
  const haptic = useHaptics()
  const { data: todos } = useTodos()
  const { run, error, isPending, reset } = useDataMutation()
  //lock the sheet's drag while the destructive button is held so finger drift can't move it
  const [isHolding, setIsHolding] = useState(false)

  const deckTodos = deck
    ? todos.filter((todo) => todo.deckId === deck.id)
    : []
  //split by the archived state (mirrors the two views) so every deck todo is
  //counted once — a checked-but-active task still counts as pending here
  const pendingCount = deckTodos.filter((todo) => !todo.archived).length
  const archivedCount = deckTodos.filter((todo) => todo.archived).length
  //an empty deck would read "its 0 pending tasks and 0 archived tasks" — drop the
  //count clause entirely so it reads "the deck and its tasks"
  const isEmpty = pendingCount === 0 && archivedCount === 0

  async function handleConfirm() {
    if (!deck || isPending) return
    const deleted = await run(
      () => deleteDeck(deck.id),
      "Could not delete deck.",
    )
    if (deleted) onClose()
  }

  return (
    <AppDrawer
      open={deck !== null}
      onOpenChange={(next) => {
        if (next) return
        onClose()
        reset()
      }}
      disableDrag={isHolding}
    >
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="flex flex-col gap-y-5 pt-4">
            <View className="flex flex-col gap-y-2">
              <AppDrawer.Title>Delete {deck?.name ?? ""}?</AppDrawer.Title>
              <AppDrawer.Description>
                {isEmpty &&
                  "This permanently removes the deck and its tasks."}
                {!isEmpty && (
                  <>
                    This permanently removes the deck and its{" "}
                    {formatCount(
                      pendingCount,
                      "pending task",
                      "pending tasks",
                    )}{" "}
                    and{" "}
                    {formatCount(
                      archivedCount,
                      "archived task",
                      "archived tasks",
                    )}
                    .
                  </>
                )}
              </AppDrawer.Description>
            </View>

            <DrawerActionFooter
              errorMessage={error?.message}
              action={
                <HoldToConfirmButton
                  holdDurationMs={5000}
                  disabled={isPending}
                  busy={isPending}
                  onConfirm={() => void handleConfirm()}
                  onHoldActiveChange={setIsHolding}
                >
                  Hold 5s to delete deck
                </HoldToConfirmButton>
              }
              cancel={
                <AppDrawer.Close
                  type="button"
                  onClick={() => haptic.impact("light")}
                  disabled={isPending}
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
