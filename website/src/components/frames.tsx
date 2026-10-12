import { View } from "adaptv/components"
import { Lock } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/utils/cn"

/*
 * Device frames drawn in CSS. Generic on purpose — a rounded slab and the camera cut-out —
 * so they depend on nobody's artwork. A phone's child is a whole screen as the phone shows
 * it, status bar included, sized by its own width and height. The cut-out is the frame's,
 * because a phone's screen never draws it.
 */
export function PhoneFrame({
  children,
  platform,
  className,
}: {
  children: ReactNode
  platform: "ios" | "android"
  className?: string
}) {
  const ios = platform === "ios"
  return (
    <View
      className={cn(
        "bg-gradient-to-b from-[#3a3a42] via-[#1b1b20] to-[#2c2c33] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]",
        ios ? "rounded-[46px] p-[7px]" : "rounded-[34px] p-[6px]",
        className,
      )}
    >
      <View
        className={cn(
          "relative overflow-hidden bg-black ring-1 ring-black",
          ios ? "rounded-[39px]" : "rounded-[28px]",
        )}
      >
        {children}
        {ios ? (
          //Dynamic Island: 126 × 37 pt, 11 pt down, on a 393 × 852 pt screen
          <span className="pointer-events-none absolute top-[1.3%] left-1/2 h-[4.3%] w-[32%] -translate-x-1/2 rounded-full bg-black" />
        ) : (
          //punch-hole camera, centred in the status bar
          <span className="pointer-events-none absolute top-[1.4%] left-1/2 aspect-square w-[3.4%] -translate-x-1/2 rounded-full bg-black" />
        )}
      </View>
    </View>
  )
}

/** A desktop browser window: traffic lights, an address bar, then the page. */
export function BrowserFrame({
  children,
  url,
  className,
}: {
  children: ReactNode
  url: string
  className?: string
}) {
  return (
    <View
      className={cn(
        "overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-[0_50px_100px_-30px_rgba(0,0,0,0.6)]",
        className,
      )}
    >
      {/* three fixed columns, the last one empty: a spacer element after the address bar
          could be parsed after a first paint, and the bar centred again when it arrived */}
      <View className="grid h-10 shrink-0 grid-cols-[42px_1fr_46px] items-center gap-3 border-border border-b bg-sunken px-4">
        <View row className="gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </View>
        <View
          row
          className="mx-auto h-6 w-full max-w-xs items-center gap-1.5 rounded-md px-2.5 bg-background font-mono text-[11px] text-muted"
        >
          <Lock className="size-2.5" />
          {url}
        </View>
      </View>
      <View className="relative min-h-0 flex-1 bg-background text-foreground">
        {children}
      </View>
    </View>
  )
}
