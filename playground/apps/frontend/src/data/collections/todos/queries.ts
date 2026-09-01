import { useCollection } from "@repo/synq/react"
import type { LocalDocument } from "@repo/synq/types"
import { useMemo } from "react"
import type { Todo } from "@/data/collections/todos/schema"
import type { SyncTodo } from "@/data/collections/todos/todos.collection"
import { store } from "@/data/store"

//map a synced todo document (epoch ms timestamps) to the UI Todo (Date)
export function toTodo(doc: LocalDocument<SyncTodo>): Todo {
  return {
    id: doc.$id,
    title: doc.title,
    checked: doc.checked,
    //legacy todos predate the archived split — default them to active
    archived: doc.archived ?? false,
    deckId: doc.deckId,
    priority: doc.priority,
    dueAt: doc.dueAt != null ? new Date(doc.dueAt) : undefined,
    position: doc.position,
    checkedAt: doc.checkedAt != null ? new Date(doc.checkedAt) : undefined,
    archivedAt:
      doc.archivedAt != null ? new Date(doc.archivedAt) : undefined,
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  }
}

//reactive, offline-first read of the todos. data is served from the warm
//in-memory cache instantly and kept live by the local storage stream.
export function useTodos(): { data: Todo[]; isLoading: boolean } {
  const { data, isLoading } = useCollection(store.todos)
  const todos = useMemo(() => data.map(toTodo), [data])
  return { data: todos, isLoading }
}
