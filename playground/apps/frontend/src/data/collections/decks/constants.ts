export const DEFAULT_DECK_EMOJI = "📋"

export const DECK_EMOJI_OPTIONS = [
  "📋",
  "🏠",
  "💼",
  "🎯",
  "✨",
  "🛒",
  "🎓",
  "💪",
  "🌱",
  "✈️",
  "🎨",
  "💡",
  "📚",
  "🍳",
  "🎮",
  "❤️",
] as const

export function resolveDeckEmoji(emoji?: string) {
  if (emoji) return emoji
  return DEFAULT_DECK_EMOJI
}

export function formatDeckLabel(deck: { name: string; emoji?: string }) {
  return `${resolveDeckEmoji(deck.emoji)} ${deck.name}`
}
