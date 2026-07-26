import { describe, expect, it } from "vitest"
import { createTxContext } from "#synq/core/tx-context"

describe("createTxContext", () => {
  it("records ack/retry/discard calls into the tracker", () => {
    const { ctx, tracker } = createTxContext()
    ctx.ack("a")
    ctx.retry("b", { message: "timeout", code: "503" })
    ctx.discard("c", { message: "forbidden", code: "403" })
    expect([...tracker.acked]).toEqual(["a"])
    expect(tracker.retried.get("b")).toEqual({
      message: "timeout",
      code: "503",
    })
    expect(tracker.discarded.get("c")).toEqual({
      message: "forbidden",
      code: "403",
    })
  })

  it("records a retry/discard without an error payload", () => {
    const { ctx, tracker } = createTxContext()
    ctx.retry("a")
    ctx.discard("b")
    expect(tracker.retried.has("a")).toBe(true)
    expect(tracker.retried.get("a")).toBeUndefined()
    expect(tracker.discarded.has("b")).toBe(true)
  })
})
