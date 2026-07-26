import { describe, expect, it } from "vitest"
import { getCrons, nextFireDelayMs } from "#dev/src/setup-cronjobs-locally"

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const WEEK_MS = 7 * DAY_MS

describe("nextFireDelayMs", () => {
  //each case starts at an instant the cron itself matches, so the delay is
  //the real gap to the following occurrence — the thing the old
  //interval model got wrong.
  const cases: [string, string, number][] = [
    ["*/10 * * * *", "2026-01-01T00:00:00.000Z", 10 * MINUTE_MS],
    ["* * * * *", "2026-01-01T00:00:00.000Z", MINUTE_MS],
    ["30 2 * * *", "2026-01-01T02:30:00.000Z", DAY_MS],
    ["*/5 */2 * * *", "2026-01-01T00:00:00.000Z", 5 * MINUTE_MS],
    ["0 12 * * 1", "2026-01-05T12:00:00.000Z", WEEK_MS],
  ]

  for (const [cron, fromIso, expected] of cases) {
    it(`schedules "${cron}" ${expected}ms after ${fromIso}`, () => {
      expect(nextFireDelayMs(cron, new Date(fromIso))).toBe(expected)
    })
  }

  it("treats cron as UTC, not the host timezone", () => {
    //14:00Z is 14:00 UTC regardless of where the dev machine sits
    const delay = nextFireDelayMs(
      "0 14 * * *",
      new Date("2026-01-01T13:00:00.000Z"),
    )
    expect(delay).toBe(HOUR_MS)
  })

  it("returns the gap to the next slot from an unaligned instant", () => {
    const delay = nextFireDelayMs(
      "*/15 * * * *",
      new Date("2026-01-01T00:07:00.000Z"),
    )
    expect(delay).toBe(8 * MINUTE_MS)
  })

  it("returns null for a malformed expression", () => {
    expect(nextFireDelayMs("not a cron", new Date())).toBeNull()
    expect(nextFireDelayMs("99 99 99 99 99", new Date())).toBeNull()
    expect(nextFireDelayMs("", new Date())).toBeNull()
  })
})

describe("getCrons", () => {
  it("reads the top-level [triggers] table", () => {
    const toml = `
[triggers]
crons = ["*/10 * * * *", "*/15 * * * *"]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *", "*/15 * * * *"])
  })

  it("ignores a commented-out crons line", () => {
    const toml = `
[triggers]
#crons = ["0 0 * * *"]
crons = ["*/10 * * * *"]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *"])
  })

  it("ignores crons in a table that is entirely commented out", () => {
    const toml = `
#[triggers]
#crons = ["0 0 * * *"]
`
    expect(getCrons(toml)).toEqual([])
  })

  it("prefers top-level [triggers] over [env.staging.triggers]", () => {
    const toml = `
[triggers]
crons = ["*/10 * * * *"]

[env.staging]
name = "api-staging"

[env.staging.triggers]
crons = ["0 3 * * *"]

[env.prod.triggers]
crons = ["0 4 * * *"]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *"])
  })

  it("returns nothing when only a named env declares crons", () => {
    const toml = `
[env.staging.triggers]
crons = ["0 3 * * *"]
`
    expect(getCrons(toml)).toEqual([])
  })

  it("reads an array spanning multiple lines", () => {
    const toml = `
[triggers]
crons = [
  "*/10 * * * *",
  "*/15 * * * *",
]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *", "*/15 * * * *"])
  })

  it("supports single-quoted entries", () => {
    const toml = `
[triggers]
crons = ['*/10 * * * *', "*/15 * * * *"]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *", "*/15 * * * *"])
  })

  it("keeps a '#' that belongs to the cron expression", () => {
    const toml = `
[triggers]
crons = ["0 0 * * 5#3"] #third friday
`
    expect(getCrons(toml)).toEqual(["0 0 * * 5#3"])
  })

  it("is not fooled by quoted strings in other tables", () => {
    const toml = `
name = "veralens-api"

[[d1_databases]]
binding = "DATABASE"
database_name = "veralens-database"

[observability]
enabled = true

[triggers]
crons = ["*/10 * * * *"]
`
    expect(getCrons(toml)).toEqual(["*/10 * * * *"])
  })

  it("returns an empty list when no [triggers] table exists", () => {
    expect(getCrons(`name = "veralens-api"`)).toEqual([])
  })
})
