import { View } from "@arrzdev/adaptv/components"
import type { ReactNode } from "react"
import { Reveal } from "@/components/reveal"
import { cn } from "@/utils/cn"

/**
 * A band of the ruled sheet. The head is two columns — the claim on the left, the one
 * sentence that earns it on the right — so a section never opens with a wall of text.
 */
export function Section({
  title,
  lede,
  children,
  className,
  id,
}: {
  title: ReactNode
  lede?: ReactNode
  children?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className="sheet ruled">
      <View className={cn("gap-14 px-6 py-20 md:px-10 md:py-28", className)}>
        <Reveal className="grid items-end gap-6 md:grid-cols-[1.25fr_1fr] md:gap-16">
          <h2 className="text-balance font-semibold text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.02] tracking-[-0.04em]">
            {title}
          </h2>
          {lede ? (
            <p className="text-pretty text-[16.5px] text-subtle leading-relaxed md:pb-1.5 md:text-[17.5px]">
              {lede}
            </p>
          ) : null}
        </Reveal>
        {children}
      </View>
    </section>
  )
}
