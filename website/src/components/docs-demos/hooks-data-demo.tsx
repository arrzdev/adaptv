import { Button, View } from "@arrzdev/adaptv/components"
import { useClipboard, useIsOffline } from "@arrzdev/adaptv/hooks"
import { cn } from "@arrzdev/adaptv/utils"

const SAMPLE = "npm create adaptv@latest"

export function HooksDataDemo() {
  const { copy, paste, canRead, readPermission, status, text } = useClipboard()
  const isOffline = useIsOffline()
  const canPaste = canRead && readPermission !== "unavailable"

  return (
    <View className="w-full max-w-sm gap-3">
      <View row className="items-center gap-2">
        <Button
          onClick={() => void copy(SAMPLE)}
          className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] text-foreground"
        >
          Copy
        </Button>
        {canPaste && (
          <Button
            onClick={() => void paste()}
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] text-foreground"
          >
            Paste
          </Button>
        )}
        <span className="font-mono text-[13px] text-muted">
          status: {status ?? "none"}
        </span>
      </View>
      <span className="truncate font-mono text-[13px] text-subtle">
        pasted: {text ?? "nothing yet"}
      </span>
      <View row className="items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            isOffline ? "bg-danger" : "bg-success",
          )}
        />
        <span className="font-mono text-[13px] text-foreground">
          {isOffline ? "offline" : "online"}
        </span>
      </View>
    </View>
  )
}
