import { ScrollView, View } from "adaptv/components"

const ROWS = Array.from({ length: 14 }, (_, i) => `Row ${i + 1}`)
const CHIPS = [
  "All",
  "Unread",
  "Flagged",
  "Drafts",
  "Sent",
  "Archive",
  "Spam",
  "Trash",
  "Receipts",
  "Travel",
]

export function ScrollViewDemo() {
  return (
    <View className="w-full max-w-sm gap-4">
      <ScrollView
        fade
        fadeSize="2.5rem"
        className="h-44 gap-2 rounded-xl border border-border bg-raised p-3"
      >
        {ROWS.map((row) => (
          <span
            key={row}
            className="shrink-0 rounded-lg bg-sunken px-3 py-2 font-mono text-[13px] text-foreground"
          >
            {row}
          </span>
        ))}
      </ScrollView>
      <ScrollView horizontal fade="end" className="gap-2">
        {CHIPS.map((chip) => (
          <span
            key={chip}
            className="shrink-0 rounded-full border border-border bg-raised px-3 py-1 text-[13px] text-subtle"
          >
            {chip}
          </span>
        ))}
      </ScrollView>
    </View>
  )
}
