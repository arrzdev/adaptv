import type { Deck } from "@/data/collections/decks/schema"
import { store } from "@/data/store"

//decks are shared/synced (parents of todos); the sync controller is
//subscribed to this collection's onLocalChange, so every write here
//schedules a debounced sync automatically.

export async function createDeck(
  name: string,
  emoji?: string,
): Promise<Deck> {
  //append to the end; max+1 (not count) survives gaps left by deletes
  const existing = await store.decks.query({
    sortBy: "position",
    order: "desc",
  })
  const maxPosition = existing.reduce(
    (max, deck) => Math.max(max, deck.position),
    -1,
  )
  const now = Date.now()
  const created = await store.decks.insert({
    name,
    ...(emoji ? { emoji } : {}),
    position: maxPosition + 1,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id: created.$id,
    name: created.name,
    emoji: created.emoji,
    position: created.position,
    createdAt: new Date(created.createdAt),
    updatedAt: new Date(created.updatedAt),
  }
}

type UpdateDeckInput = {
  name: string
  emoji?: string
}

export async function updateDeck(
  id: string,
  input: UpdateDeckInput,
): Promise<void> {
  await store.decks.update(id, {
    name: input.name,
    emoji: input.emoji,
    updatedAt: Date.now(),
  })
}

export async function deleteDeck(id: string): Promise<void> {
  //delete the deck's todos too, then remove the deck — the delete drawer's copy
  //promises "the deck and its tasks", so a deck delete cascades to its tasks
  const deckTodos = await store.todos.query({ where: { deckId: id } })
  for (const todo of deckTodos) {
    await store.todos.delete(todo.$id)
  }
  await store.decks.delete(id)
}

//persist a new deck order; reassign contiguous positions matching orderedIds
export async function reorderDecks(orderedIds: string[]): Promise<void> {
  const now = Date.now()
  for (let index = 0; index < orderedIds.length; index++) {
    await store.decks.update(orderedIds[index], {
      position: index,
      updatedAt: now,
    })
  }
}
