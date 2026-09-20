import { describe, expect, it } from "vitest"
import {
  NOTIFICATION_OPENED,
  openedMessage,
  readOpenedMessage,
} from "#adaptv/sw/sw.notification-protocol"

describe("readOpenedMessage — the page validates what the worker sent", () => {
  it("reads a tap back out of its own wire form", () => {
    const message = openedMessage({ id: 7, data: { route: "/inbox" } })
    expect(readOpenedMessage(message)).toEqual({
      id: 7,
      data: { route: "/inbox" },
    })
  })

  it("ignores anything that is not a tap", () => {
    for (const message of [
      null,
      undefined,
      "ADAPTV_NOTIFICATION_OPENED",
      { type: "push" },
      //the type is right and the id is a string: an app's own worker module
      //sending this by accident must not be delivered as a tap
      { type: NOTIFICATION_OPENED, id: "7" },
      { type: NOTIFICATION_OPENED, id: Number.NaN },
    ])
      expect(readOpenedMessage(message)).toBeNull()
  })

  it("keeps only the string values, and survives no data at all", () => {
    expect(
      readOpenedMessage({
        type: NOTIFICATION_OPENED,
        id: 1,
        data: { route: "/inbox", count: 3, nested: { a: 1 } },
      }),
    ).toEqual({ id: 1, data: { route: "/inbox" } })
    expect(
      readOpenedMessage({ type: NOTIFICATION_OPENED, id: 1 }),
    ).toEqual({ id: 1, data: {} })
  })
})
