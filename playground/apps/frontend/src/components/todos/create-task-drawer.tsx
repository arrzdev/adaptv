import type { TodoFormValue } from "@/components/todos/todo-form-drawer"
import { TodoFormDrawer } from "@/components/todos/todo-form-drawer"
import type { Deck } from "@/data/collections/decks/schema"
import { createTodo } from "@/data/collections/todos/mutations"
import { useDataMutation } from "@/hooks/use-data-mutation"

type CreateTaskDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  decks?: Deck[]
  defaultDeckId?: string | null
  /** Fires after a task is created — the page reacts (e.g. switch to the active view so it shows). */
  onCreated?: () => void
}

//owns "create a task": the mutation, its error, and closing on success — so the
//page just opens/closes it. the form itself stays the dumb TodoFormDrawer.
export function CreateTaskDrawer({
  open,
  onOpenChange,
  decks,
  defaultDeckId,
  onCreated,
}: CreateTaskDrawerProps) {
  const { run, error, isPending, reset } = useDataMutation()

  async function handleSubmit(value: TodoFormValue) {
    const created = await run(
      () => createTodo(value),
      "Could not save task.",
    )
    if (!created) return
    onCreated?.()
    onOpenChange(false)
  }

  return (
    <TodoFormDrawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
      submitLabel="Add task"
      decks={decks}
      defaultDeckId={defaultDeckId}
      isSubmitting={isPending}
      errorMessage={error?.message}
      onSubmit={handleSubmit}
    />
  )
}
