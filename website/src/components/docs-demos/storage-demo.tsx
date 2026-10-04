import { Button, View } from "@arrzdev/adaptv/components"
import { useKv } from "@arrzdev/adaptv/storage"

const BUTTON_CLASS =
  "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-[13px] text-foreground"

export function StorageDemo() {
  const [count, setCount] = useKv("docs-demo-count", 0)

  return (
    <View className="items-center gap-3">
      <View row className="items-center gap-3">
        <Button onClick={() => setCount(count - 1)} className={BUTTON_CLASS}>
          -1
        </Button>
        <span className="w-10 text-center font-mono text-[15px] text-foreground">
          {count}
        </span>
        <Button onClick={() => setCount(count + 1)} className={BUTTON_CLASS}>
          +1
        </Button>
      </View>
      <span className="text-[13px] text-subtle">
        Reload the page, or open it in a second tab.
      </span>
    </View>
  )
}
