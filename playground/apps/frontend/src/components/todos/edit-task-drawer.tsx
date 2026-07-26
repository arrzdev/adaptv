import type { TodoFormValue } from "@/components/todos/todo-form-drawer"
import { TodoFormDrawer } from "@/components/todos/todo-form-drawer"
import type { Deck } from "@/data/collections/decks/schema"
import { updateTodoDetails } from "@/data/collections/todos/mutations"
import type { Todo } from "@/data/collections/todos/schema"
import { useDataMutation } from "@/hooks/use-data-mutation"

type EditTaskDrawerProps = {
  /** The task being edited; `null` keeps the drawer closed (it stays mounted for the exit animation). */
  todo: Todo | null
  decks?: Deck[]
  onClose: () => void
}

//owns "edit a task": title/priority/due/deck, the mutation, its error, and
//closing on success. open is driven by `todo !== null`.
export function EditTaskDrawer({
  todo,
  decks,
  onClose,
}: EditTaskDrawerProps) {
  const { run, error, isPending, reset } = useDataMutation()

  async function handleSubmit(value: TodoFormValue) {
    if (!todo) return
    const saved = await run(
      () => updateTodoDetails(todo.id, value),
      "Could not save task.",
    )
    if (saved) onClose()
  }

  return (
    <TodoFormDrawer
      open={todo !== null}
      onOpenChange={(next) => {
        if (next) return
        onClose()
        reset()
      }}
      submitLabel="Save"
      initialValue={todo?.title ?? ""}
      initialPriority={todo?.priority}
      initialDueAt={todo?.dueAt}
      decks={decks}
      defaultDeckId={todo?.deckId ?? null}
      isSubmitting={isPending}
      errorMessage={error?.message}
      onSubmit={handleSubmit}
    />
  )
}
