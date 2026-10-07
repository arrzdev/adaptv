import type { ComponentPropsWithRef, MouseEvent } from "react"
import { openExternal } from "#adaptv/capabilities/browser"
import { PRESS_TARGET_LOCKED_STYLE } from "#adaptv/components/press-core"
import { isNativePlatform } from "#adaptv/utils/platform"
import { composeStyles } from "#adaptv/utils/styles"

//The look — left-aligned, no underline, a pointer cursor — is a default rule in
//styles/link.css; the press-core touch longhand is locked, inline
//(docs/decisions/styling.md §2.0).

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
  style,
  children,
  ...props
}: ExternalLinkProps) {
  const merged = composeStyles({
    className,
    style,
    lockedStyle: PRESS_TARGET_LOCKED_STYLE,
  })

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
      //both ahead of the spread: `Link` renders this anchor under its own scope
      //(`data-adaptv="link"`), and a wrapper's `data-part` reaches the element
      data-adaptv="external-link"
      data-part="root"
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </a>
  )
}

ExternalLink.displayName = "ExternalLink"
