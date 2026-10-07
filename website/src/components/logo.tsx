import { cn } from "@/utils/cn"

/**
 * The adaptv mark: two opposite corners of a frame that is never drawn, and a disc
 * sitting inside it. Same geometry as `assets/adaptv-mark.svg`, minus the flat
 * background an app icon needs — here the tile is a rounded square of the brand colour.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="1024" height="1024" rx="232" fill="var(--brand)" />
      <circle cx="512" cy="512" r="164" fill="var(--brand-foreground)" />
      <g
        fill="none"
        stroke="var(--brand-foreground)"
        strokeWidth="100"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M256 400 V296 H360" />
        <path d="M768 624 V728 H664" />
      </g>
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 font-semibold text-[17px] text-foreground tracking-tight",
        className,
      )}
    >
      <Mark />
      adaptv
    </span>
  )
}
