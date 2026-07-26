import { ScrollView, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ReactNode } from "react"

export type PageProps = {
  children: ReactNode
  className?: string
}

const PAGE_CONTENT_CLASS =
  "mx-auto flex w-full max-w-2xl flex-col gap-y-5 px-6 web:py-4 app:py-safe-offset-2"

/**
 * Scrollable page column with default horizontal padding and max width. Sits on
 * a {@link View} route surface (fills the shell) with a {@link ScrollView} for
 * the content. Pass `className` to override padding (`px-*`) and background
 * (`bg-*`).
 */
export function Page({ children, className }: PageProps) {
  return (
    <View fill className="w-full">
      <ScrollView
        className={cn(
          "relative bg-background",
          PAGE_CONTENT_CLASS,
          className,
        )}
      >
        {children}
      </ScrollView>
    </View>
  )
}

/**
 * Like {@link Page}, with soft fades at the top and bottom screen edges.
 * Edge overlays use the same `bg-*` utilities from `className` when provided.
 *
 * The scroll lives on the edge-fades surface itself; children are a plain
 * normal-flow column that just renders. Nesting a second `flex-col` scroller
 * inside lets tall content overflow instead of scrolling, so keep it flat.
 */
export function PageWithSmoothEdges({ children, className }: PageProps) {
  return (
    <View fill className="w-full">
      <ScrollView
        edgeFades
        className={cn("bg-background", className)}
        edgeClassName={cn("bg-background", className)}
      >
        <div className={PAGE_CONTENT_CLASS}>{children}</div>
      </ScrollView>
    </View>
  )
}
