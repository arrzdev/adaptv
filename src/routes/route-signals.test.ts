import { redirect } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import { isRedirect, notFound } from "#adaptv/routes/route-signals"

describe("isRedirect", () => {
  it("is true for what redirect() throws", () => {
    expect(isRedirect(redirect({ to: "/login" }))).toBe(true)
  })

  it("is false for a not-found signal, an error and plain values", () => {
    expect(isRedirect(notFound())).toBe(false)
    expect(isRedirect(new Error("boom"))).toBe(false)
    expect(isRedirect(undefined)).toBe(false)
    expect(isRedirect({ to: "/login" })).toBe(false)
  })
})

describe("notFound", () => {
  it("carries the data the not-found screen receives", () => {
    expect(notFound({ data: { id: 7 } }).data).toEqual({ id: 7 })
  })
})
