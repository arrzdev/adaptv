import type { DeckFormInput } from "@/components/decks/deck-form-drawer"
import { DeckFormDrawer } from "@/components/decks/deck-form-drawer"
import { createDeck } from "@/data/collections/decks/mutations"
import { useDataMutation } from "@/hooks/use-data-mutation"

type CreateDeckDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

//owns "create a deck": the mutation, its error, and closing on success.
export function CreateDeckDrawer({
  open,
  onOpenChange,
}: CreateDeckDrawerProps) {
  const { run, error, isPending, reset } = useDataMutation()

  async function handleSubmit(input: DeckFormInput) {
    const created = await run(
      () => createDeck(input.name, input.emoji),
      "Could not save deck.",
    )
    if (created) onOpenChange(false)
  }

  return (
    <DeckFormDrawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      submitLabel="Create"
      isSubmitting={isPending}
      errorMessage={error?.message}
      onSubmit={handleSubmit}
    />
  )
}
