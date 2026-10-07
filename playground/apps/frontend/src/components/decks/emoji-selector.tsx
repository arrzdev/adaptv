import { ScrollView, Text, View } from "@arrzdev/adaptv/components"
import { GhostButton } from "@/components/ui"
import {
  DECK_EMOJI_OPTIONS,
  DEFAULT_DECK_EMOJI,
} from "@/data/collections/decks/constants"
import { cn } from "@/utils/cn"

type EmojiSelectorProps = {
  value: string | null
  onChange: (emoji: string | null) => void
  options?: readonly string[]
}

export function EmojiSelector({
  value,
  onChange,
  options = DECK_EMOJI_OPTIONS,
}: EmojiSelectorProps) {
  const selectedEmoji = value ?? DEFAULT_DECK_EMOJI

  return (
    <View className="flex flex-col gap-y-2">
      <Text className="ps-1 text-sm font-medium text-subtle">Emoji</Text>
      {/* a chip row is its own scroller — the sheet around it only scrolls vertically */}
      <ScrollView horizontal className="-mx-6 gap-x-2 px-6 py-1">
        {options.map((emoji) => {
          const isSelected = selectedEmoji === emoji
          return (
            <GhostButton
              key={emoji}
              onClick={() => onChange(emoji)}
              className={cn(
                "size-11 shrink-0 px-0 text-xl leading-none",
                isSelected &&
                  "bg-secondary text-foreground hover:bg-secondary hover:text-foreground",
              )}
              aria-pressed={isSelected}
              aria-label={`Emoji ${emoji}`}
            >
              {emoji}
            </GhostButton>
          )
        })}
      </ScrollView>
    </View>
  )
}
