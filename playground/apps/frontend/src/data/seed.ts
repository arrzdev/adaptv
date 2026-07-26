import { store } from "@/data/store"

//a deterministic id so concurrent first-run seeds across devices converge on
//ONE tutorial deck (CRDT merge) instead of duplicating it
const TUTORIAL_DECK_ID = "deck-tutorial"
const TUTORIAL_DECK_NAME = "Tutorial"
const TUTORIAL_DECK_EMOJI = "🪜"

//decks + todos are both shared/synced. todos are never seeded (the backend is
//their source of truth); the tutorial deck is seeded with a fixed id so every
//fresh client lands on the same one.
export async function seedInitialDataIfEmpty(): Promise<void> {
  const decks = await store.decks.query()
  if (decks.length > 0) return

  const now = Date.now()
  await store.decks.insert({
    $id: TUTORIAL_DECK_ID,
    name: TUTORIAL_DECK_NAME,
    emoji: TUTORIAL_DECK_EMOJI,
    position: 0,
    createdAt: now,
    updatedAt: now,
  })
}
