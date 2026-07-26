import { z } from "zod"

export const deckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  emoji: z.string().min(1).optional(),
  //home + settings render decks ordered by this; reassigned contiguously on reorder
  position: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type Deck = z.infer<typeof deckSchema>
