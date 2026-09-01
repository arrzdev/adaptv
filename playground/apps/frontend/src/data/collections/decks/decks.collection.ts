import type { CollectionConfig } from "@repo/synq/types"

//---- Decks collection ---------------------------------------------
//decks are the PARENTS of todos, and like todos they are local-only — no
//transport, so nothing leaves the device. stored with epoch-ms timestamps;
//the UI Deck (Date) is recovered in data/decks/queries.ts.

export type SyncDeck = {
  name: string
  emoji?: string
  position: number
  createdAt: number
  updatedAt: number
}

export const decksCollection: CollectionConfig<SyncDeck> = {
  name: "decks",
}
