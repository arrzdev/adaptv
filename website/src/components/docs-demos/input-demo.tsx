import { Input, TextArea, View } from "adaptv/components"
import { Search, X } from "lucide-react"
import { useState } from "react"

const FIELD_CLASS =
  "w-full rounded-lg bg-surface px-3 py-2 text-[14px] text-foreground outline outline-1 outline-border-strong focus-within:outline-2 focus-within:outline-brand placeholder:text-muted"

export function InputDemo() {
  const [query, setQuery] = useState("")
  const [notes, setNotes] = useState("")
  const [submitted, setSubmitted] = useState<string | null>(null)

  return (
    <View className="w-full max-w-sm gap-3">
      <Input
        type="search"
        enterKeyHint="search"
        aria-label="Search"
        placeholder="Search, then press Enter"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onSubmitKey={() => setSubmitted(query)}
        className={FIELD_CLASS}
      >
        <Input.Leading className="pe-2 text-muted">
          <Search size={16} aria-hidden />
        </Input.Leading>
        {query.length > 0 && (
          <Input.Trailing className="ps-2">
            <button
              type="button"
              aria-label="Clear"
              onClick={() => setQuery("")}
              className="cursor-pointer text-muted"
            >
              <X size={16} aria-hidden />
            </button>
          </Input.Trailing>
        )}
      </Input>

      <TextArea
        rows={2}
        maxRows={5}
        aria-label="Notes"
        placeholder="Type a few lines. It stops growing at five."
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        className={FIELD_CLASS}
      />

      <span className="font-mono text-[13px] text-muted">
        onSubmitKey: {submitted === null ? "not fired" : `"${submitted}"`}
      </span>
    </View>
  )
}
