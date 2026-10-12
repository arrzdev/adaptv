import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Hero } from "@/components/sections/hero"

//the real links need a router; a plain anchor is enough for the copy
vi.mock("adaptv/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("adaptv/components")>()),
  Link: ({ to, children }: { to: string; children: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  ExternalLink: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))
vi.mock("@/components/sections/device-stage", () => ({
  DeviceStage: () => null,
}))

afterEach(cleanup)

describe("hero", () => {
  // the sub-line claims only what the framework does everywhere: the tap
  // highlight reset covers links only (src/styles/patches.css), so no tap
  // flash claim (TUD-757)
  it("sub-line names the fixes adaptv makes on every element", () => {
    render(<Hero />)
    const sub = screen.getByText(/^One React codebase/)
    expect(sub.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "One React codebase for the browser, the home screen, the App Store and Google Play. adaptv stops scroll chaining and input zoom, and handles safe areas, the keyboard and offline.",
    )
  })
})
