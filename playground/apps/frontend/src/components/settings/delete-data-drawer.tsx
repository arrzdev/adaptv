import { useState } from "react"
import {
  AppDrawer,
  DrawerActionFooter,
  drawerCancelClassName,
  HoldToConfirmButton,
} from "@/components/ui"
import { formatCount } from "@/components/ui/format-count"
import { useDecks } from "@/data/collections/decks/queries"
import { useTodos } from "@/data/collections/todos/queries"
import { deleteAllData } from "@/data/delete-data.mutations"
import { useDataMutation } from "@/hooks/use-data-mutation"
import { useHaptics } from "@/hooks/use-haptics"

type DeleteDataDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

//owns "delete all local data": counts what will go, runs the wipe, surfaces its
//error, and closes on success. preferences are intentionally kept.
export function DeleteDataDrawer({
  open,
  onOpenChange,
}: DeleteDataDrawerProps) {
  const haptic = useHaptics()
  const { data: decks } = useDecks()
  const { data: todos } = useTodos()
  const { run, error, isPending, reset } = useDataMutation()
  //lock the sheet's drag while the destructive button is held so finger drift can't move it
  const [isHolding, setIsHolding] = useState(false)

  async function handleConfirm() {
    if (isPending) return
    const deleted = await run(
      () => deleteAllData(),
      "Could not delete data.",
    )
    if (deleted) onOpenChange(false)
  }

  return (
    <AppDrawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      disableDrag={isHolding}
    >
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="flex flex-col gap-y-5 pt-4">
            <div className="flex flex-col gap-y-2">
              <AppDrawer.Title>Delete all data?</AppDrawer.Title>
              <AppDrawer.Description>
                This permanently removes{" "}
                {formatCount(decks.length, "deck", "decks")} and{" "}
                {formatCount(todos.length, "task", "tasks")} from this
                device. Your preferences are kept.
              </AppDrawer.Description>
            </div>

            <DrawerActionFooter
              errorMessage={error?.message}
              action={
                <HoldToConfirmButton
                  holdDurationMs={10000}
                  disabled={isPending}
                  busy={isPending}
                  onConfirm={() => void handleConfirm()}
                  onHoldActiveChange={setIsHolding}
                >
                  Hold 10s to delete all data
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
