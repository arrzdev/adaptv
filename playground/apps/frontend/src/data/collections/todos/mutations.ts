import type { LocalDocument } from "@repo/synq/types"
import type { Todo } from "@/data/collections/todos/schema"
import type { SyncTodo } from "@/data/collections/todos/todos.collection"
import { store } from "@/data/store"

type TodoDoc = LocalDocument<SyncTodo>

//all todo writes go through synq: they land in the local outbox instantly
//(optimistic) and the sync controller — subscribed to this collection's
//onLocalChange — flushes them to the shared backend on a debounce. dates
//are stored as epoch ms in the sync layer.

export type CreateTodoInput = {
  title: string
  deckId?: string
  priority?: number
  dueAt?: Date
}

//creates run one after another. the position is a read (the current max) and
//then a write (max+1), and two creates in flight at once both read before either
//writes, so both land on the same slot and the custom order has two tasks in one
//place. queueing each create behind the one before it makes the read see the
//write. a create that fails does not hold the queue.
let createQueue: Promise<unknown> = Promise.resolve()

export function createTodo(input: CreateTodoInput): Promise<Todo> {
  const created = createQueue.then(() => insertTodo(input))
  createQueue = created.catch(() => undefined)
  return created
}

async function insertTodo(input: CreateTodoInput): Promise<Todo> {
  //append to the end of the custom order; max+1 survives gaps from deletes
  const existing = (await store.todos.query()) as TodoDoc[]
  const maxPosition = existing.reduce(
    (max, todo) => Math.max(max, todo.position),
    -1,
  )
  const now = Date.now()
  const created = await store.todos.insert({
    title: input.title,
    checked: false,
    archived: false,
    deckId: input.deckId,
    priority: input.priority,
    dueAt: input.dueAt ? input.dueAt.getTime() : undefined,
    position: maxPosition + 1,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id: created.$id,
    title: created.title,
    checked: created.checked,
    archived: created.archived,
    deckId: created.deckId,
    priority: created.priority,
    dueAt: created.dueAt != null ? new Date(created.dueAt) : undefined,
    position: created.position,
    checkedAt:
      created.checkedAt != null ? new Date(created.checkedAt) : undefined,
    archivedAt:
      created.archivedAt != null
        ? new Date(created.archivedAt)
        : undefined,
    createdAt: new Date(created.createdAt),
    updatedAt: new Date(created.updatedAt),
  }
}

export type UpdateTodoDetails = {
  title?: string
  deckId?: string
  priority?: number
  dueAt?: Date
}

//the edit form sends the full intended deck/priority/dueAt each time, so a
//missing value means "cleared" — passing undefined tombstones the field
export async function updateTodoDetails(
  id: string,
  patch: UpdateTodoDetails,
): Promise<void> {
  await store.todos.update(id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    deckId: patch.deckId,
    priority: patch.priority,
    dueAt: patch.dueAt ? patch.dueAt.getTime() : undefined,
    updatedAt: Date.now(),
  })
}

//checking pins the todo to the bottom of the active list; checkedAt orders that
//block. unchecking tombstones the stamp (undefined clears the field in synq)
export async function updateTodoChecked(
  id: string,
  checked: boolean,
): Promise<void> {
  const now = Date.now()
  await store.todos.update(id, {
    checked,
    checkedAt: checked ? now : undefined,
    updatedAt: now,
  })
}

//archiving forces checked true and stamps both timestamps; the todo leaves the
//active view for the archive (ordered by archivedAt)
export async function archiveTodo(id: string): Promise<void> {
  const now = Date.now()
  await store.todos.update(id, {
    archived: true,
    checked: true,
    archivedAt: now,
    checkedAt: now,
    updatedAt: now,
  })
}

//unarchiving returns the todo to the active view unchecked, clearing both stamps
export async function unarchiveTodo(id: string): Promise<void> {
  await store.todos.update(id, {
    archived: false,
    checked: false,
    archivedAt: undefined,
    checkedAt: undefined,
    updatedAt: Date.now(),
  })
}

export async function deleteTodo(id: string): Promise<void> {
  await store.todos.delete(id)
}

//persist a custom reorder of a filtered view: redistribute the position
//slots the moved todos already occupy into their new visual order, so
//todos hidden by the filter keep theirs and the one global order holds
export async function reorderTodos(orderedIds: string[]): Promise<void> {
  const all = (await store.todos.query()) as TodoDoc[]
  const byId = new Map(all.map((todo) => [todo.$id, todo]))
  const slots = orderedIds
    .map((id) => byId.get(id)?.position)
    .filter((position): position is number => position !== undefined)
    .sort((a, b) => a - b)
  //bail if an id vanished mid-drag rather than collapse onto fewer slots
  if (slots.length !== orderedIds.length) return
  const now = Date.now()
  for (let index = 0; index < orderedIds.length; index++) {
    await store.todos.update(orderedIds[index], {
      position: slots[index],
      updatedAt: now,
    })
  }
}
