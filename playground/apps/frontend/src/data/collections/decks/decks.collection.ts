import type { CollectionConfig } from "@repo/synq/types"
import { backendTransport } from "@/data/sync/transport"

//---- Decks collection ---------------------------------------------
//decks are the PARENTS of todos, so they sync to the same shared backend —
//otherwise a synced todo's deckId would point at a deck that doesn't exist on
//another device. shared by every user (no accounts), like todos. stored with
//epoch-ms timestamps; the UI Deck (Date) is recovered in data/decks/queries.ts.

export type SyncDeck = {
  name: string
  emoji?: string
  position: number
  createdAt: number
  updatedAt: number
}

export const decksCollection: CollectionConfig<SyncDeck> = {
  name: "decks",
  ...backendTransport<SyncDeck>("decks"),
}
