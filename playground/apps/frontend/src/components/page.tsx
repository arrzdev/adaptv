import { ScrollView, View } from "@arrzdev/adaptv/components"
import type { ReactNode } from "react"
import { cn } from "@/utils/cn"

export type PageProps = {
  children: ReactNode
  className?: string
}

const PAGE_CONTENT_CLASS =
  "mx-auto flex w-full max-w-2xl flex-col gap-y-5 px-6 web:py-4 app:py-safe-offset-2"

/*
 * A page's root IS the ScrollView. Nothing wraps it.
 *
 * These used to open with `<View fill className="w-full">`, which measured as the
 * exact same box as the shell's own screen frame — same `flex flex-col`, same
 * `flex-1`, same `min-h-0`, same 720px. It existed only because a flex child does not
 * grow on its own, so the page had to say `fill` to be full-height and someone added
 * a wrapper that said it too. The shell now stretches a page's only root element
 * (`adaptv/styles/screen.css`), so both the wrapper and the `fill` are gone — which
 * is also what makes a top-level `View` (a page that must never scroll) and a
 * top-level `ScrollView` freely interchangeable.
 */

/**
 * Scrollable page column with default horizontal padding and max width. Pass
 * `className` to override padding (`px-*`) and background (`bg-*`).
 */
export function Page({ children, className }: PageProps) {
  return (
    <ScrollView
      className={cn(
        "relative bg-background",
        PAGE_CONTENT_CLASS,
        className,
      )}
    >
      {children}
    </ScrollView>
  )
}

/**
 * Like {@link Page}, with the content dissolving at the top and bottom screen edges
 * instead of ending on a hard line. Each edge fades only while there is content that
 * way, so the first line is crisp while you are parked at the top.
 *
 * The scroll lives on this surface itself; children are a plain normal-flow column.
 * Nesting a second `flex-col` scroller inside lets tall content overflow instead of
 * scrolling, so keep it flat.
 */
export function PageWithSmoothEdges({ children, className }: PageProps) {
  return (
    <ScrollView fade className={cn("bg-background", className)}>
      <View className={PAGE_CONTENT_CLASS}>{children}</View>
    </ScrollView>
  )
}
