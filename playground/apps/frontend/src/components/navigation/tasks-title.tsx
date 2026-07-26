import { cn } from "@arrzdev/adaptv/utils"
import type { Deck } from "@/data/collections/decks/schema"

type TasksTitleProps = {
  as: "h1" | "span"
  className?: string
  /** When set, shows the deck name instead of "Your tasks". */
  deck?: Deck | null
}

export function TasksTitle({ as, className, deck }: TasksTitleProps) {
  const Tag = as
  const isAll = !deck

  return (
    <Tag className={cn(className)}>
      {isAll && "Your tasks"}
      {!isAll && deck.name}
    </Tag>
  )
}
