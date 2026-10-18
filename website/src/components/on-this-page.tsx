import { View } from "adaptv/components"
import { Fragment } from "react"
import { headingIds } from "@/components/prose"
import type { Block } from "@/content/blocks"
import { cn } from "@/utils/cn"

/** The headings of a page as jump links: the right-hand column of a doc and a post. */
export function OnThisPage({ blocks }: { blocks: Block[] }) {
  const ids = headingIds(blocks)
  const headings = blocks.flatMap((block, index) => {
    const id = ids[index]
    if (!id) return []
    if (block.type === "h2")
      return [{ id, text: block.text.replace(/`/g, ""), depth: 0, mono: false }]
    if (block.type === "h3")
      return [{ id, text: block.text.replace(/`/g, ""), depth: 1, mono: false }]
    if (block.type === "api")
      return [{ id, text: block.name, depth: 1, mono: true }]
    return []
  })
  if (headings.length < 2) return null
  return (
    <View className="gap-2.5">
      <span className="pb-1 font-mono text-[12px] text-muted uppercase tracking-[0.08em]">
        On this page
      </span>
      {headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          // The document never scrolls in an adaptv app, so a #hash link has nothing to
          // move. scrollIntoView walks up to the page's own scroller instead.
          onClick={() =>
            document
              .getElementById(heading.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={cn(
            // a file path is one long word: break it rather than overrun the column
            "cursor-pointer text-left text-[13.5px] text-subtle leading-snug [overflow-wrap:anywhere] hover:text-foreground",
            heading.depth === 1 && "pl-3 text-[13px] text-muted",
            heading.mono && "font-mono text-[12px]",
          )}
        >
          <PathBreaks text={heading.text} />
        </button>
      ))}
    </View>
  )
}

/**
 * Offers a line break after each `/`, so `src/routing/pages/home.page.tsx` wraps at a
 * folder and `overflow-wrap: anywhere` only cuts a segment too long for a line.
 */
function PathBreaks({ text }: { text: string }) {
  return text.split(/(?<=\/)/).map((part, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ))
}
