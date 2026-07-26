import {
  createTodo,
  deleteTodo,
  updateTodoChecked,
  updateTodoDetails,
} from "@/data/collections/todos/mutations"
import { store } from "@/data/store"
import { runSync } from "@/data/sync/controller"

//---- Debug / e2e hook ---------------------------------------------
//exposes the real offline-first data layer on window so devtools (or an
//automated browser) can drive the exact code paths the UI buttons use and
//force a sync deterministically. browser-only; no-op during prerender.

declare global {
  interface Window {
    synqDebug?: {
      createTodo: typeof createTodo
      updateTodoChecked: typeof updateTodoChecked
      updateTodoDetails: typeof updateTodoDetails
      deleteTodo: typeof deleteTodo
      runSync: typeof runSync
      list: () => ReturnType<typeof store.todos.query>
    }
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  window.synqDebug = {
    createTodo,
    updateTodoChecked,
    updateTodoDetails,
    deleteTodo,
    runSync,
    list: () => store.todos.query(),
  }
}
