import { View } from "adaptv/components"
import type { ReactNode } from "react"
import { cn } from "@/utils/cn"

/*
 * Phone frames drawn in CSS. Generic on purpose — a rounded slab and the camera cut-out —
 * so they depend on nobody's artwork. The child is a whole screen as the phone shows it,
 * status bar included: a screenshot or a recording, sized by its own width and height.
 * The cut-out is the frame's, because a phone's screenshot never shows it.
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
