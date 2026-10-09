import { ExternalLink, Link } from "adaptv/components"
import type { ReactNode } from "react"

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g

/**
 * The three inline marks content may use: `code`, **bold**, [label](href). Bold may
 * hold the other two: **`render` is static** is bold code.
 */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split(INLINE).map((part, index) => {
    //a split string never reorders, so the index is a stable key
    const key = index
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded-md border border-border bg-sunken px-1.5 py-0.5 font-mono text-[0.86em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {/* bold holds no `**`, so this goes one level deep: code and links */}
          <Inline text={part.slice(2, -2)} />
        </strong>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      const className =
        "font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-brand"
      return href.startsWith("/") ? (
        <Link key={key} to={href} className={className}>
          {label}
        </Link>
      ) : (
        <ExternalLink key={key} href={href} className={className}>
          {label}
        </ExternalLink>
      )
    }
    return part
  })
}
