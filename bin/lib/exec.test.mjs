import { describe, expect, it } from "vitest"
import { capture } from "./exec.mjs"

describe("capture's timeout", () => {
  /*
   * R59. The case this exists for is a platform daemon that has stopped answering — macOS's
   * `simdiskimaged` wedged, so every `simctl` sat forever inside one synchronous XPC call.
   * Without a ceiling the CLI waits exactly as long as the dev is willing to, with no row and
   * no reason, which is what `adaptv dev ios` did.
   */
  it("kills a child that outlives its ceiling and says so", async () => {
    const started = Date.now()
    const r = await capture("sleep", ["30"], { timeoutMs: 250 })
    expect(r.timedOut).toBe(true)
    //the point is that it came back at all, and quickly
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("leaves a child that finishes in time completely alone", async () => {
    const r = await capture("printf", ["hello"], { timeoutMs: 5000 })
    expect(r.timedOut).toBe(false)
    expect(r.code).toBe(0)
    expect(r.stdout).toBe("hello")
  })

  it("has no ceiling at all unless one is asked for", async () => {
    const r = await capture("printf", ["hi"])
    expect(r.timedOut).toBe(false)
    expect(r.stdout).toBe("hi")
  })
})
