import { ScrollView } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { GhostButton } from "@/components/ui"
import { formatDeckLabel } from "@/data/collections/decks/constants"
import type { Deck } from "@/data/collections/decks/schema"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

type DeckPickerProps = {
  decks: Deck[]
  value: string | null
  onChange: (deckId: string | null) => void
}

export function DeckPicker({ decks, value, onChange }: DeckPickerProps) {
  const { hapticPointerHandlers } = useAppVibrate()

  if (decks.length === 0) return null

  return (
    <div className="flex flex-col gap-y-2">
      <span className="ps-1 text-sm font-medium text-subtle">Deck</span>
      <ScrollView horizontal className="-mx-6 gap-x-2 px-6">
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
                  "bg-secondary text-foreground hover:bg-secondary hover:text-foreground",
              )}
              aria-pressed={isSelected}
            >
              {formatDeckLabel(deck)}
            </GhostButton>
          )
        })}
      </ScrollView>
    </div>
  )
}
