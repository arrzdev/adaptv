import { ScrollView, Text, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { GhostButton } from "@/components/ui"
import { formatDeckLabel } from "@/data/collections/decks/constants"
import type { Deck } from "@/data/collections/decks/schema"

type DeckPickerProps = {
  decks: Deck[]
  value: string | null
  onChange: (deckId: string | null) => void
}

export function DeckPicker({ decks, value, onChange }: DeckPickerProps) {
  if (decks.length === 0) return null

  return (
    <View className="flex flex-col gap-y-2">
      <Text className="ps-1 text-sm font-medium text-subtle">Deck</Text>
      {/* a chip row is its own scroller — the sheet around it only scrolls vertically */}
      <ScrollView horizontal className="-mx-6 gap-x-2 px-6">
        {decks.map((deck) => {
          const isSelected = value === deck.id
          return (
            <GhostButton
              key={deck.id}
              onClick={() => onChange(deck.id)}
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
    </View>
  )
}
