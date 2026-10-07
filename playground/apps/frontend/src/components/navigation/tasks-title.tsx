import { Text } from "@arrzdev/adaptv/components"
import type { Deck } from "@/data/collections/decks/schema"
import { cn } from "@/utils/cn"

type TasksTitleProps = {
  as: "h1" | "span"
  className?: string
  /** When set, shows the deck name instead of "Your tasks". */
  deck?: Deck | null
}

export function TasksTitle({ as, className, deck }: TasksTitleProps) {
  const isAll = !deck

  return (
    <Text
      // biome-ignore lint/a11y/useHeadingContent: when `as` is "h1" the heading text flows through Text's render prop into the h1 at runtime (cloneElement), which the static check can't see
      render={as === "h1" ? <h1 /> : <span />}
      className={cn(className)}
    >
      {isAll && "Your tasks"}
      {!isAll && deck.name}
    </Text>
  )
}
