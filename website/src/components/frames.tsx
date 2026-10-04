import { View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { BatteryFull, Lock, Signal, Wifi } from "lucide-react"
import type { ReactNode } from "react"

/*
 * Device frames drawn in CSS. Generic on purpose — a rounded slab, a sensor pill, a home
 * indicator — so they depend on nobody's artwork, and they take CHILDREN rather than an
 * image, because the point of this site is that what sits inside them is running.
 */
export function PhoneFrame({
  children,
  label,
  tone = "neutral",
  className,
}: {
  children: ReactNode
  /** Caption under the device. */
  label?: string
  tone?: "neutral" | "bad" | "good"
  className?: string
}) {
  return (
    <View className={cn("items-center gap-4", className)}>
      <View className="relative aspect-[393/830] w-full rounded-[44px] bg-gradient-to-b from-[#3a3a42] via-[#1b1b20] to-[#2c2c33] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]">
        {/* absolutely placed, so tall content can never stretch the device's aspect ratio */}
        <View className="absolute inset-[7px] overflow-hidden rounded-[37px] bg-background text-foreground ring-1 ring-black">
          {/* status bar */}
          <View
            row
            className="pointer-events-none relative z-20 h-9 shrink-0 items-end justify-between px-[8%] pb-0.5 font-semibold text-[11px]"
          >
            <span>9:41</span>
            <View row className="items-center gap-1">
              <Signal className="size-3" strokeWidth={2.5} />
              <Wifi className="size-3" strokeWidth={2.5} />
              <BatteryFull className="size-3.5" strokeWidth={2} />
            </View>
          </View>
          <View className="relative min-h-0 flex-1">{children}</View>
          {/* home indicator */}
          <span className="pointer-events-none absolute bottom-1.5 left-1/2 z-20 h-1 w-[36%] -translate-x-1/2 rounded-full bg-foreground/80" />
        </View>
        {/* sensor island */}
        <span className="pointer-events-none absolute top-[15px] left-1/2 z-30 h-[19px] w-[30%] -translate-x-1/2 rounded-full bg-black" />
      </View>
      {label ? (
        <View
          row
          className={cn(
            "items-center gap-2 font-mono text-[11.5px] uppercase tracking-[0.14em]",
            tone === "bad" && "text-danger",
            tone === "good" && "text-success",
            tone === "neutral" && "text-muted",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {label}
        </View>
      ) : null}
    </View>
  )
}

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
      <View
        row
        className="h-10 shrink-0 items-center gap-3 border-border border-b bg-sunken px-4"
      >
        <View row className="gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </View>
        <View
          row
          className="mx-auto h-6 w-full max-w-xs items-center justify-center gap-1.5 rounded-md bg-background font-mono text-[11px] text-muted"
        >
          <Lock className="size-2.5" />
          {url}
        </View>
        <span className="w-[46px]" />
      </View>
      <View className="relative min-h-0 flex-1 bg-background text-foreground">
        {children}
      </View>
    </View>
  )
}
