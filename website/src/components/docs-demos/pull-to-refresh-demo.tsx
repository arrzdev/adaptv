import { PullToRefresh, ScrollView, View } from "adaptv/components"
import { useRef, useState } from "react"

const ROWS = Array.from({ length: 12 }, (_, i) => `Message ${i + 1}`)

export function PullToRefreshDemo() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [refreshes, setRefreshes] = useState(0)

  async function refresh() {
    await new Promise((resolve) => setTimeout(resolve, 1200))
    setRefreshes((count) => count + 1)
  }

  return (
    <View className="w-full max-w-sm gap-3">
      <PullToRefresh
        onRefresh={refresh}
        scrollContainerRef={scrollRef}
        className="overflow-hidden rounded-xl border border-border bg-sunken [&_svg]:text-foreground"
      >
        <ScrollView ref={scrollRef} className="h-64 gap-2 bg-raised p-3">
          {ROWS.map((row) => (
            <span
              key={row}
              className="shrink-0 rounded-lg bg-sunken px-3 py-2 text-[13px] text-foreground"
            >
              {row}
            </span>
          ))}
        </ScrollView>
      </PullToRefresh>
      <span className="text-center font-mono text-[13px] text-muted">
        drag the list down from the top · refreshed {refreshes}×
      </span>
    </View>
  )
}
