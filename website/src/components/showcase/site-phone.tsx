import { View } from "adaptv/components"
import { BatteryFull, Signal, Wifi } from "lucide-react"
import { PhoneFrame } from "@/components/frames"
import { LoopVideo } from "@/components/loop-video"

/**
 * This site on an iPhone: a 6 s screen recording of the landing's own components (the
 * components grid, then the hard parts) under an iOS status bar, in points of a 393 × 852
 * screen. The recording is the site in its light theme, so the status bar is light in both.
 * The screen's box is an aspect ratio, so the video arriving moves nothing.
 */
export function SitePhone({ className }: { className?: string }) {
  return (
    <div data-testid="site-phone" className={className}>
      <PhoneFrame platform="ios">
        <div className="@container aspect-[393/852] min-h-0 w-full bg-white text-black">
          <div className="mock flex h-full flex-col [--mock-w:393]">
            <View
              row
              className="h-[calc(54*var(--u))] shrink-0 items-center justify-between px-[calc(38*var(--u))] pt-[calc(6*var(--u))] font-semibold text-[length:calc(17*var(--u))]"
            >
              <span>9:41</span>
              <View row className="w-[calc(72*var(--u))] items-center gap-1.5">
                <Signal
                  className="size-[calc(18*var(--u))]"
                  strokeWidth={2.5}
                />
                <Wifi className="size-[calc(18*var(--u))]" strokeWidth={2.5} />
                <BatteryFull
                  className="size-[calc(24*var(--u))]"
                  strokeWidth={2}
                />
              </View>
            </View>
            <div className="min-h-0 flex-1">
              <LoopVideo name="site-phone" className="object-top" />
            </div>
          </div>
        </div>
      </PhoneFrame>
    </div>
  )
}
