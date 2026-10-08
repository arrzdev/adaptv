import { ScrollView } from "adaptv/components"
import { GhostButton } from "@/components/ui"
import { formatDeckLabel } from "@/data/collections/decks/constants"
import type { Deck } from "@/data/collections/decks/schema"
import { cn } from "@/utils/cn"

type DeckTabsProps = {
  decks: Deck[]
  value: string | null
  onChange: (deckId: string | null) => void
}

export function DeckTabs({ decks, value, onChange }: DeckTabsProps) {
  const isAllSelected = value === null

  return (
    <ScrollView horizontal className="-mx-6 gap-x-2 px-6">
      <GhostButton
        onClick={() => onChange(null)}
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
        return (
          <GhostButton
            key={deck.id}
            onClick={() => onChange(deck.id)}
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
    </ScrollView>
  )
}
