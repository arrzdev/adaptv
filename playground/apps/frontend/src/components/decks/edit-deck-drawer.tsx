import type { DeckFormInput } from "@/components/decks/deck-form-drawer"
import { DeckFormDrawer } from "@/components/decks/deck-form-drawer"
import { updateDeck } from "@/data/collections/decks/mutations"
import type { Deck } from "@/data/collections/decks/schema"
import { useDataMutation } from "@/hooks/use-data-mutation"

type EditDeckDrawerProps = {
  /** The deck being edited; `null` keeps the drawer closed (it stays mounted for the exit animation). */
  deck: Deck | null
  onClose: () => void
}

//owns "edit a deck": the mutation, its error, and closing on success. open is
//driven by `deck !== null`.
export function EditDeckDrawer({ deck, onClose }: EditDeckDrawerProps) {
  const { run, error, isPending, reset } = useDataMutation()

  async function handleSubmit(input: DeckFormInput) {
    if (!deck) return
    const saved = await run(
      () => updateDeck(deck.id, input),
      "Could not save deck.",
    )
    if (saved) onClose()
  }

  return (
    <DeckFormDrawer
      open={deck !== null}
      onOpenChange={(next) => {
        if (next) return
        onClose()
        reset()
      }}
      submitLabel="Save"
      initialValue={deck?.name ?? ""}
      initialEmoji={deck?.emoji}
      isSubmitting={isPending}
      errorMessage={error?.message}
      onSubmit={handleSubmit}
    />
  )
}
