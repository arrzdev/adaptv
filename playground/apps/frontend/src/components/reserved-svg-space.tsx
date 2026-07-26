import { cn } from "@arrzdev/adaptv/utils"
import type { CSSProperties, ReactNode } from "react"

export type ReservedSvgSpaceProps = {
  /** Width:height ratio used to reserve layout before the SVG loads (default 1). */
  aspectRatio?: number
  /** Sizing classes on the reserving wrapper (e.g. `w-[min(88vw,22rem,72dvh)]`). */
  className?: string
  children: ReactNode
}

/**
 * Reserves layout space for an SVG (file `<img>` or inline `<svg>`) so slow loads
 * do not shift surrounding content.
 */
export function ReservedSvgSpace({
  aspectRatio = 1,
  className,
  children,
}: ReservedSvgSpaceProps) {
  const reserveStyle: CSSProperties = { aspectRatio }

  return (
    <div className={cn("shrink-0", className)} style={reserveStyle}>
      <div className="size-full [&_img]:size-full [&_img]:object-contain [&_svg]:size-full">
        {children}
      </div>
    </div>
  )
}
