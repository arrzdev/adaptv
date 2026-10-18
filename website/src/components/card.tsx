import type { ReactNode } from "react"
import { Reveal } from "@/components/reveal"
import { cn } from "@/utils/cn"

/**
 * The landing's card (landing-v4 §2): a flat surface one shade off the page, no border, no
 * shadow, its content centred. Top to bottom: the `visual` (a demo or a diagram, in a box
 * whose size is fixed before it reveals), the title, the body and an optional link. On a
 * pointer the border shows on hover; nothing lifts or scales.
 */
export function Card({
  visual,
  visualClassName,
  title,
  body,
  link,
  small = false,
  className,
}: {
  visual?: ReactNode
  /** The visual slot's box: a fixed height or aspect ratio, so a reveal never resizes it. */
  visualClassName?: string
  title?: ReactNode
  body?: ReactNode
  link?: ReactNode
  /** A card in a grid of two: a smaller title. */
  small?: boolean
  className?: string
}) {
  return (
    <div
      data-card
      className={cn(
        "flex flex-col items-center overflow-hidden rounded-[var(--radius-card-sm)] border border-transparent bg-card px-6 py-8 text-center transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] md:rounded-[var(--radius-card)] md:px-14 md:pt-14 md:pb-13 [@media(hover:hover)]:hover:border-border-strong",
        className,
      )}
    >
      {visual ? (
        <Reveal
          variant="visual"
          className={cn(
            "grid w-full grid-cols-[minmax(0,1fr)] place-items-center",
            title && "mb-7",
            visualClassName,
          )}
        >
          {visual}
        </Reveal>
      ) : null}
      {title ? (
        <Reveal className="flex flex-col items-center">
          <h3
            className={cn(
              "max-w-[16ch] text-balance font-semibold leading-[1.15] tracking-[-0.025em]",
              small
                ? "text-[20px] md:text-[24px]"
                : "text-[24px] md:text-[30px]",
            )}
          >
            {title}
          </h3>
          {body ? (
            <p className="mt-3 max-w-[30rem] text-pretty text-[16px] text-subtle leading-normal">
              {body}
            </p>
          ) : null}
          {link ? <div className="mt-4.5">{link}</div> : null}
        </Reveal>
      ) : null}
    </div>
  )
}
