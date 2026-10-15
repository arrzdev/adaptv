import { View } from "adaptv/components"
import type { ReactNode } from "react"
import { Reveal } from "@/components/reveal"
import { cn } from "@/utils/cn"

/**
 * A band of the landing: a centred head (the claim, then the one sentence that earns it)
 * over its cards. No eyebrow and no hairline: sections are separated by space alone
 * (landing-v4 §2).
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
    <section id={id} className="sheet">
      <View className={cn("px-4 pt-22 md:px-10 md:pt-28", className)}>
        <View className="mx-auto mb-8 max-w-[720px] items-center text-center md:mb-12">
          <Reveal variant="head">
            <h2 className="text-balance font-semibold text-[clamp(2rem,1.1rem+2.9vw,3rem)] leading-[1.08] tracking-[-0.035em]">
              {title}
            </h2>
          </Reveal>
          {lede ? (
            <Reveal variant="head" delay={0.12}>
              <p className="mt-4 max-w-[34rem] text-pretty text-[16px] text-subtle leading-[1.55] md:text-[17px]">
                {lede}
              </p>
            </Reveal>
          ) : null}
        </View>
        {children}
      </View>
    </section>
  )
}
