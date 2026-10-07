import { View } from "@arrzdev/adaptv/components"
import { useAppState, useOnPause, useOnResume } from "@arrzdev/adaptv/hooks"
import { useState } from "react"
import { cn } from "@/utils/cn"

export function HooksLifecycleDemo() {
  const state = useAppState()
  const [pauses, setPauses] = useState(0)
  const [resumes, setResumes] = useState(0)

  useOnPause(() => setPauses((n) => n + 1))
  useOnResume(() => setResumes((n) => n + 1))

  return (
    <View className="items-center gap-3">
      <View row className="items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            state === "active" ? "bg-success" : "bg-border-strong",
          )}
        />
        <span className="font-mono text-[13px] text-foreground">{state}</span>
      </View>
      <span className="font-mono text-[13px] text-muted">
        pauses: {pauses} · resumes: {resumes}
      </span>
      <span className="text-[13px] text-subtle">
        Switch to another tab and come back.
      </span>
    </View>
  )
}
