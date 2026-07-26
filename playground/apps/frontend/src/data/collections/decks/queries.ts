import { useCollection } from "@repo/synq/react"
import type { LocalDocument } from "@repo/synq/types"
import { useMemo } from "react"
import type { SyncDeck } from "@/data/collections/decks/decks.collection"
import type { Deck } from "@/data/collections/decks/schema"
import { store } from "@/data/store"

//map a stored deck (epoch ms) to the UI Deck (Date)
export function toDeck(doc: LocalDocument<SyncDeck>): Deck {
  return {
    id: doc.$id,
    name: doc.name,
    emoji: doc.emoji,
    position: doc.position,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  }
}

//reactive, offline-first list of local decks, ordered by position
export function useDecks(): { data: Deck[]; isLoading: boolean } {
  const { data, isLoading } = useCollection(store.decks, {
    sortBy: "position",
    order: "asc",
  })
  const decks = useMemo(() => data.map(toDeck), [data])
  return { data: decks, isLoading }
}
