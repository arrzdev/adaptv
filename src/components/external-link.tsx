import type { ComponentPropsWithRef, MouseEvent } from "react"
import { openExternal } from "#adaptv/capabilities/browser"
import {
  PRESS_TARGET_CURSOR_CLASS,
  PRESS_TARGET_LOCKED_CLASS,
} from "#adaptv/components/press-core"
import { isNativePlatform } from "#adaptv/utils/platform"
import { mergeStyles } from "#adaptv/utils/styles"

const EXTERNAL_LINK_BASE_CLASS = "text-left no-underline"

export interface ExternalLinkProps extends ComponentPropsWithRef<"a"> {
  /** The external destination (http/https/mailto/tel/…). */
  href: string
}

/**
 * A link to an **external** destination — opens the in-app system browser on a
 * native build (`@capacitor/browser`) and a new tab on web. Renders a real
 * `<a href>` (SEO, keyboard, ⌘/middle-click open natively). On native a plain
 * left-click is intercepted and routed through {@link openExternal}, so the URL
 * never loads inside the app WebView. On web nothing is intercepted: the anchor
 * opens its own tab, and its `rel="noopener noreferrer"` sends no Referer and
 * leaves no opener without a script having to get either right. There is no
 * outcome to report from a component, so the accessor would add nothing there.
 * For in-app routes use `Link`.
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
    //on web the anchor itself is the safer opener — see the doc comment
    if (!isNativePlatform()) return
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
      data-adaptv="external-link"
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={mergeStyles({
        base: [EXTERNAL_LINK_BASE_CLASS, PRESS_TARGET_CURSOR_CLASS],
        className,
        locked: PRESS_TARGET_LOCKED_CLASS,
      })}
    >
      {children}
    </a>
  )
}

ExternalLink.displayName = "ExternalLink"
