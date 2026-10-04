import { List, View } from "@arrzdev/adaptv/components"
import { useEffect, useRef, useState } from "react"

type Row = { id: string; index: number }

const ROWS: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `row-${index}`,
  index,
}))

export function ListDemo() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(0)

  //the claim in one number: how many row elements exist right now
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const count = () =>
      setMounted(host.querySelectorAll("[data-demo-row]").length)
    count()
    const observer = new MutationObserver(count)
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return (
    <View className="w-full max-w-sm gap-3">
      <div
        ref={hostRef}
        className="h-64 overflow-hidden rounded-xl border border-border bg-background"
      >
        <List
          data={ROWS}
          keyExtractor={(row) => row.id}
          estimateSize={44}
          fade
          className="h-full"
          renderItem={(row) => (
            <div
              data-demo-row
              className="flex h-11 items-center justify-between border-border border-b px-4 text-[14px] text-foreground"
            >
              <span>Row {row.index + 1}</span>
              <span className="font-mono text-[12px] text-muted">{row.id}</span>
            </div>
          )}
        />
      </div>
      <span className="font-mono text-[13px] text-muted">
        data: {ROWS.length.toLocaleString("en-US")} rows · in the DOM: {mounted}
      </span>
    </View>
  )
}
