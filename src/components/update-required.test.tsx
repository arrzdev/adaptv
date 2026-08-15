import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UpdateRequired } from "#adaptv/components/update-required"
import type { UpdateRequiredProps } from "#adaptv/config/types"
import {
  noteStoreReleaseRequired,
  resetStoreReleaseForTests,
} from "#adaptv/ota/store-release"

const DAY = 86_400_000
const NOW = 1_800_000_000_000

/** Put the device `days` days into being unreachable by OTA. */
function strandedFor(days: number) {
  vi.spyOn(Date, "now").mockReturnValue(NOW - days * DAY)
  noteStoreReleaseRequired("abc123")
  vi.spyOn(Date, "now").mockReturnValue(NOW)
}

beforeEach(() => {
  resetStoreReleaseForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("when it stays out of the way", () => {
  it("renders nothing when no threshold was configured", () => {
    //🔴 The default, and the important one. An install in this state is WORKING —
    //newest bundle that matched its binary, still checking, still covered by the
    //rollback watchdog. A framework that took the screen without being asked
    //would lock people out of an app that runs.
    strandedFor(9_000)
    const { container } = render(<UpdateRequired />)
    expect(container.innerHTML).toBe("")
  })

  it("renders nothing while the install can still take what is published", () => {
    const { container } = render(<UpdateRequired afterDays={0} />)
    expect(container.innerHTML).toBe("")
  })

  it("renders nothing before the threshold is reached", () => {
    strandedFor(3)
    const { container } = render(<UpdateRequired afterDays={14} />)
    expect(container.innerHTML).toBe("")
  })
})

describe("when it takes the screen", () => {
  it("takes it on the day the threshold is met, not the day after", () => {
    strandedFor(14)
    render(<UpdateRequired afterDays={14} />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("honours `0` — block as soon as the channel moves past this install", () => {
    //A truthiness check on the threshold would silently turn the strictest
    //setting into no setting at all.
    strandedFor(0)
    render(<UpdateRequired afterDays={0} />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("states the age rather than promising the update is downloadable", () => {
    //The channel moves when a release is BUILT, which is generally before review
    //lets anyone install it. "Go and get it now" could send someone to a store
    //page with nothing newer on it.
    strandedFor(9)
    render(<UpdateRequired afterDays={7} />)
    expect(screen.getByRole("alert").textContent).toContain("9 days")
  })

  it("says `day` for one, because a screen shown to users is not a log line", () => {
    strandedFor(1)
    render(<UpdateRequired afterDays={1} />)
    const text = screen.getByRole("alert").textContent ?? ""
    expect(text).toContain("1 day")
    expect(text).not.toContain("1 days")
  })
})

describe("the app's own screen", () => {
  it("is used instead of adaptv's, with the age already in whole days", () => {
    strandedFor(21.6)
    const Custom = vi.fn((_: UpdateRequiredProps) => <p>custom</p>)
    render(<UpdateRequired afterDays={14} component={Custom} />)
    expect(screen.getByText("custom")).toBeTruthy()
    //21, not 21.6 — a screen shown to a user does not say "21.6 days behind"
    expect(Custom.mock.calls[0]?.[0]).toMatchObject({
      days: 21,
      buildTag: "abc123",
    })
  })

  it("is not rendered when the threshold is not met either", () => {
    //The threshold is what opts an app in — a component alone must not block.
    strandedFor(2)
    const Custom = vi.fn(() => <p>custom</p>)
    render(<UpdateRequired afterDays={30} component={Custom} />)
    expect(Custom).not.toHaveBeenCalled()
  })
})
