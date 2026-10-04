import { Offline, View } from "@arrzdev/adaptv/components"
import { useState } from "react"

export function OfflineBoundaryDemo() {
  const [retries, setRetries] = useState(0)
  return (
    <View className="w-full max-w-sm gap-3">
      <View className="h-64 overflow-hidden rounded-xl border border-border bg-white">
        <Offline onRetry={() => setRetries((count) => count + 1)} />
      </View>
      <span className="text-center font-mono text-[13px] text-muted">
        onRetry calls: {retries}
      </span>
    </View>
  )
}
