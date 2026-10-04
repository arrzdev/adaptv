import { View } from "@arrzdev/adaptv/components"
import {
  useInsets,
  useMediaQuery,
  useOrientation,
  useReducedMotion,
} from "@arrzdev/adaptv/hooks"

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      row
      className="items-center justify-between gap-6 border-border border-b py-2 last:border-b-0"
    >
      <span className="font-mono text-[13px] text-muted">{label}</span>
      <span className="font-mono text-[13px] text-foreground">{value}</span>
    </View>
  )
}

export function HooksDeviceDemo() {
  const isWide = useMediaQuery("(min-width: 768px)")
  const hasHover = useMediaQuery("(hover: hover)")
  const reducedMotion = useReducedMotion()
  const { orientation } = useOrientation()
  const insets = useInsets()

  return (
    <View className="w-full max-w-sm rounded-xl border border-border bg-surface px-4 py-1">
      <Row label="(min-width: 768px)" value={String(isWide)} />
      <Row label="(hover: hover)" value={String(hasHover)} />
      <Row label="useReducedMotion()" value={String(reducedMotion)} />
      <Row label="orientation" value={orientation} />
      <Row
        label="insets"
        value={`${insets.top} ${insets.right} ${insets.bottom} ${insets.left}`}
      />
    </View>
  )
}
