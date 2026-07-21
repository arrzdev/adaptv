import { describe, expect, it } from "vitest"
import {
  resolveUpdateMode,
  shouldApplyUpdateNow,
} from "#nativ/shell/sw-update-mode"

describe("resolveUpdateMode — the default is the decision", () => {
  //B3: `autoUpdate` was the only mode and applied skipWaiting + reload
  //mid-session. That drops unsaved state AND prunes the precache under open
  //tabs, which is what makes the next lazy import 404. Auto-applying CAUSES the
  //stale-chunk failure it looks like it fixes.
  it("defaults to prompt, not autoUpdate", () => {
    expect(resolveUpdateMode(undefined)).toBe("prompt")
    expect(resolveUpdateMode(true)).toBe("prompt")
  })

  it("passes an explicit mode through", () => {
    expect(resolveUpdateMode("autoUpdate")).toBe("autoUpdate")
    expect(resolveUpdateMode("manual")).toBe("manual")
    expect(resolveUpdateMode("prompt")).toBe("prompt")
  })

  it("treats false as no registration at all", () => {
    expect(resolveUpdateMode(false)).toBeNull()
  })
})

describe("shouldApplyUpdateNow — autoUpdate only at a safe moment", () => {
  it("never applies while the tab is visible — that is mid-interaction", () => {
    //the user may be typing into a form. A reload here is data loss.
    expect(shouldApplyUpdateNow("autoUpdate", "visible")).toBe(false)
  })

  it("applies when the tab is hidden — nothing is in flight", () => {
    expect(shouldApplyUpdateNow("autoUpdate", "hidden")).toBe(true)
  })

  it("never applies in prompt mode, whatever the visibility", () => {
    expect(shouldApplyUpdateNow("prompt", "hidden")).toBe(false)
    expect(shouldApplyUpdateNow("prompt", "visible")).toBe(false)
  })

  it("never applies in manual mode — the app owns it", () => {
    expect(shouldApplyUpdateNow("manual", "hidden")).toBe(false)
  })
})
