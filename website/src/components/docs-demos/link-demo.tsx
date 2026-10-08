import { ExternalLink, Link, View } from "adaptv/components"

const ROW =
  "flex items-center justify-between rounded-xl border border-border bg-raised px-4 py-3 text-[14px] text-foreground active:bg-sunken"

export function LinkDemo() {
  return (
    <View className="w-full max-w-xs gap-2">
      <Link to="/docs/$slug" params={{ slug: "pressable" }} className={ROW}>
        <span>Pressable</span>
        <span className="font-mono text-[12px] text-muted">in-app route</span>
      </Link>
      <ExternalLink href="https://example.com" className={ROW}>
        <span>example.com</span>
        <span className="font-mono text-[12px] text-muted">leaves the app</span>
      </ExternalLink>
    </View>
  )
}
