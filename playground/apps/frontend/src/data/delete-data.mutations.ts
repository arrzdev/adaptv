import { seedInitialDataIfEmpty } from "@/data/seed"
import { store } from "@/data/store"
import { runSync } from "@/data/sync/controller"

//"delete all data" is the explicit nuke: it deletes the shared decks and todos
//(both propagate to every device on the next sync), then re-seeds first-run data.
export async function deleteAllData(): Promise<void> {
  const decks = await store.decks.query()
  for (const deck of decks) await store.decks.delete(deck.$id)

  const todos = await store.todos.query()
  for (const todo of todos) await store.todos.delete(todo.$id)

  await seedInitialDataIfEmpty()
  await runSync()
}
