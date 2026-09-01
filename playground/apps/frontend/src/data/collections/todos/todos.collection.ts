import type { CollectionConfig } from "@repo/synq/types"

//---- Todos collection ---------------------------------------------
//local-only todos. this file owns the collection's row shape; data/store.ts
//registers it and synq persists it to IndexedDB. no transport: this app is
//frontend-only, so a row never leaves the device. timestamps are epoch ms
//(JSON-safe); the UI converts to Date at the edge (see data/todos/queries.ts).

export type SyncTodo = {
  title: string
  checked: boolean
  //archived is decoupled from checked: archiving forces checked true, but a
  //checked todo stays active (pinned to the bottom) until it's archived
  archived: boolean
  deckId?: string
  priority?: number
  dueAt?: number
  position: number
  //when the todo was last checked / archived (epoch ms); cleared on the reverse
  //action. checkedAt orders the completed block; archivedAt orders the archive
  checkedAt?: number
  archivedAt?: number
  createdAt: number
  updatedAt: number
}

export const todosCollection: CollectionConfig<SyncTodo> = {
  name: "todos",
}
