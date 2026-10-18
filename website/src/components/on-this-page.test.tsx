import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { OnThisPage } from "./on-this-page"

vi.mock("adaptv/components", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

describe("OnThisPage", () => {
  //with only overflow-wrap:anywhere, the Quick start entry wrapped as
  //"src/routing/pages/home.page." and "tsx"
  it("offers a break after each slash of a file name", () => {
    const html = renderToStaticMarkup(
      <OnThisPage
        blocks={[
          { type: "h2", text: "A minimal app" },
          { type: "h3", text: "src/routing/pages/home.page.tsx" },
        ]}
      />,
    )
    expect(html).toContain(
      "src/<wbr/>routing/<wbr/>pages/<wbr/>home.page.tsx</button>",
    )
    expect(html).toContain(">A minimal app</button>")
  })
})
