import type { ComponentPropsWithRef, MouseEvent } from "react"
import { openExternal } from "#nativ/capabilities/browser"
import { mergeStyles } from "#nativ/utils/styles"

const EXTERNAL_LINK_BASE_CLASS = "text-left no-underline"

export interface ExternalLinkProps extends ComponentPropsWithRef<"a"> {
  /** The external destination (http/https/mailto/tel/…). */
  href: string
}

/**
 * A link to an **external** destination — opens the in-app system browser on a
 * native build (`@capacitor/browser`) and a new tab on web. Renders a real
 * `<a href>` (SEO, keyboard, ⌘/middle-click open natively); only a plain
 * left-click is intercepted so native navigation is routed through
 * {@link openExternal} instead of loading inside the app WebView. For in-app
 * routes use `Link`.
 *
 * @example
 * ```tsx
 * <ExternalLink href="https://example.com">Docs</ExternalLink>
 * ```
 */
export function ExternalLink({
  href,
  onClick,
  className,
  children,
  ...props
}: ExternalLinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e)
    if (e.defaultPrevented) return
    //let modified / non-primary clicks do their native new-tab/background thing
    if (
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return
    }
    e.preventDefault()
    void openExternal(href)
  }

  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={mergeStyles({
        base: EXTERNAL_LINK_BASE_CLASS,
        className,
        locked: "clickable",
      })}
    >
      {children}
    </a>
  )
}

ExternalLink.displayName = "ExternalLink"
