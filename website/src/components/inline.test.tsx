import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { Inline } from "./inline"

//the real links need a router; a plain anchor is enough to see where a link lands
vi.mock("adaptv/components", () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  ExternalLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

/** The markup without class names, so the assertions read as structure. */
function render(text: string) {
  return renderToStaticMarkup(<Inline text={text} />).replace(
    / class="[^"]*"/g,
    "",
  )
}

describe("Inline", () => {
  it("renders code, bold and a link side by side", () => {
    expect(
      render("Set `render`, **once**, see [Rendering](/docs/rendering)."),
    ).toBe(
      'Set <code>render</code>, <strong>once</strong>, see <a href="/docs/rendering">Rendering</a>.',
    )
  })

  it("renders code inside bold as bold code, not backticks", () => {
    expect(render('**`render: "spa"` does not change the native app.**')).toBe(
      "<strong><code>render: &quot;spa&quot;</code> does not change the native app.</strong>",
    )
  })

  it("renders a link inside bold as a link", () => {
    expect(render("**Read [storage](/docs/storage) first.**")).toBe(
      '<strong>Read <a href="/docs/storage">storage</a> first.</strong>',
    )
  })

  it("leaves a lone backtick as text", () => {
    expect(render("a ` b")).toBe("a ` b")
  })
})
