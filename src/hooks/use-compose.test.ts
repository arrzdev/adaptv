import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComposeSupport } from "#adaptv/capabilities/compose"
import {
  composeMail,
  composeSms,
  getComposeSupport,
} from "#adaptv/capabilities/compose"
import { useCompose } from "#adaptv/hooks/use-compose"

let answer: Record<"mail" | "sms", () => Promise<ComposeSupport>> = {
  mail: async () => "unknown",
  sms: async () => "unknown",
}

vi.mock("#adaptv/capabilities/compose", () => ({
  getComposeSupport: vi.fn((kind: "mail" | "sms") => answer[kind]()),
  composeMail: vi.fn(async () => "opened"),
  composeSms: vi.fn(async () => "no-handler"),
  mailUrl: vi.fn(() => "mailto:a@b.c?subject=Hi"),
  smsUrl: vi.fn(() => "sms:1?body=hi"),
}))

beforeEach(() => {
  answer = { mail: async () => "unknown", sms: async () => "unknown" }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useCompose", () => {
  it("reads null until the OS has answered, then the answer", async () => {
    let resolveMail: (s: ComposeSupport) => void = () => {}
    answer.mail = () =>
      new Promise<ComposeSupport>((r) => {
        resolveMail = r
      })
    answer.sms = async () => "no-handler"
    const { result } = renderHook(() => useCompose())
    expect(result.current.mail).toBeNull()
    await waitFor(() => expect(result.current.sms).toBe("no-handler"))
    expect(result.current.mail).toBeNull()
    await act(async () => resolveMail("available"))
    expect(result.current.mail).toBe("available")
    expect(getComposeSupport).toHaveBeenCalledTimes(2)
  })

  it("carries the outcome and the URL of the last compose", async () => {
    const { result } = renderHook(() => useCompose())
    expect(result.current.last).toBeNull()
    expect(result.current.lastUrl).toBeNull()
    await act(async () => {
      await result.current.composeMail({ to: ["a@b.c"], subject: "Hi" })
    })
    expect(composeMail).toHaveBeenCalledWith({
      to: ["a@b.c"],
      subject: "Hi",
    })
    expect(result.current.last).toBe("opened")
    expect(result.current.lastUrl).toBe("mailto:a@b.c?subject=Hi")
    await act(async () => {
      await result.current.composeSms({ to: ["1"], body: "hi" })
    })
    expect(composeSms).toHaveBeenCalledWith({ to: ["1"], body: "hi" })
    expect(result.current.last).toBe("no-handler")
    expect(result.current.lastUrl).toBe("sms:1?body=hi")
  })
})
