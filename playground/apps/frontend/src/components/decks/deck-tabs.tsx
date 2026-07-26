import { cn } from "@arrzdev/adaptv/utils"
import { GhostButton } from "@/components/ui"
import { formatDeckLabel } from "@/data/collections/decks/constants"
import type { Deck } from "@/data/collections/decks/schema"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

type DeckTabsProps = {
  decks: Deck[]
  value: string | null
  onChange: (deckId: string | null) => void
}

export function DeckTabs({ decks, value, onChange }: DeckTabsProps) {
  const { hapticPointerHandlers } = useAppVibrate()
  const isAllSelected = value === null
  const allHandlers = hapticPointerHandlers(() => onChange(null), "ok")

  return (
    <div className="scrollable-x -mx-6 flex gap-x-2 px-6">
      <GhostButton
        onClick={allHandlers.onClick}
        className={cn(
          "shrink-0",
          isAllSelected &&
            "bg-surface text-foreground hover:bg-surface hover:text-foreground",
        )}
        aria-pressed={isAllSelected}
      >
        All
      </GhostButton>
      {decks.map((deck) => {
        const isSelected = value === deck.id
        const deckHandlers = hapticPointerHandlers(
          () => onChange(deck.id),
          "ok",
        )
        return (
          <GhostButton
            key={deck.id}
            onClick={deckHandlers.onClick}
            className={cn(
              "shrink-0",
              isSelected &&
                "bg-surface text-foreground hover:bg-surface hover:text-foreground",
            )}
            aria-pressed={isSelected}
          >
            {formatDeckLabel(deck)}
          </GhostButton>
        )
      })}
    </div>
  )
}
