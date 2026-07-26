import { z } from "zod"

export const todoSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  checked: z.boolean(),
  //archived is a separate state from checked (see todos.collection.ts)
  archived: z.boolean(),
  deckId: z.string().min(1).optional(),
  priority: z.number().int().min(1).max(4).optional(),
  dueAt: z.coerce.date().optional(),
  //custom-sort order; reassigned among the moved subset on drag-to-reorder
  position: z.number().int().nonnegative(),
  //orders the completed block (checkedAt) and the archive (archivedAt)
  checkedAt: z.coerce.date().optional(),
  archivedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type Todo = z.infer<typeof todoSchema>
