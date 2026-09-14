import { describe, expect, it } from "vitest"
import {
  armStale,
  initialStale,
  pollStale,
  RESTART_NOTICE,
  standingNotice,
} from "./watch-staleness.mjs"

const PLATFORMS = ["ios", "android"]
const NATIVE = { ios: "ios-1", android: "android-1" }

/** A run that launched both platforms: source `cli-1`, config `config-1`, native as built. */
const launched = () =>
  armStale(initialStale("cli-1"), { native: NATIVE, config: "config-1" })

/** Poll a sequence of readings, returning the last state and every notice raised. */
const pollAll = (state, readings) => {
  const notices = []
  for (const now of readings) {
    const result = pollStale(state, now, PLATFORMS)
    state = result.state
    notices.push(result.notice)
  }
  return { state, notices }
}

describe("the watch row after an edit it cannot hot-reload", () => {
  it("draws nothing while nothing moved", () => {
    const { notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-1", cli: "cli-1" },
    ])
    expect(notices).toEqual([null])
  })

  it("merges config and native into one row (R40)", () => {
    const { notices } = pollAll(launched(), [
      {
        native: { ios: "ios-2", android: "android-2" },
        config: "config-2",
        cli: "cli-1",
      },
    ])
    expect(notices).toEqual([
      {
        text: "config + native change · ios, android",
        restart: false,
      },
    ])
  })

  it("lets adaptv's own source win the row over a config edit in the same poll (R54)", () => {
    const { notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-2", cli: "cli-2" },
    ])
    expect(notices).toEqual([RESTART_NOTICE])
  })
})

describe("a restart, once needed, stays needed until the process restarts (R54)", () => {
  //The poll re-armed the source fingerprint with every change and kept no memory of what the
  //row had said. So an edit to adaptv's source, then a later poll that saw only a config edit,
  //demoted the row to `press b to rebuild`, a key that reruns the build with the OLD modules
  //still loaded while the source edit waits, unannounced, for a restart.
  it("keeps saying restart to apply when a later poll sees only a config edit", () => {
    const { notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-1", cli: "cli-2" },
      { native: NATIVE, config: "config-2", cli: "cli-2" },
    ])
    expect(notices).toEqual([RESTART_NOTICE, RESTART_NOTICE])
  })

  it("keeps saying it through a later native edit too", () => {
    const { notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-1", cli: "cli-2" },
      {
        native: { ...NATIVE, android: "android-2" },
        config: "config-1",
        cli: "cli-2",
      },
    ])
    expect(notices).toEqual([RESTART_NOTICE, RESTART_NOTICE])
  })

  //`b` opens a fresh watch block, and a fresh block starts empty. The rebuild re-arms config
  //and native, which it did apply, and never the source, which it cannot: so the restart row
  //came down with the config it had absorbed and nothing ever raised it again.
  it.each([
    ["a source edit alone", "config-1"],
    ["a source edit and a config edit", "config-2"],
  ])(
    "a b rebuild after %s clears the config, never the restart",
    (_, config) => {
      let { state } = pollAll(launched(), [
        { native: NATIVE, config, cli: "cli-2" },
      ])
      //what `b` does: rebuild from the files on disk, then mount a fresh block
      state = armStale(state, { native: NATIVE, config })
      expect(standingNotice(state)).toEqual(RESTART_NOTICE)
      //the config part is gone: polling the config the rebuild applied raises nothing,
      //so the row the fresh block opened with is the whole story
      expect(
        pollStale(
          state,
          { native: NATIVE, config, cli: "cli-2" },
          PLATFORMS,
        ).notice,
      ).toBeNull()
      //and a config edit after the rebuild still cannot demote it
      expect(
        pollStale(
          state,
          { native: NATIVE, config: "config-3", cli: "cli-2" },
          PLATFORMS,
        ).notice,
      ).toEqual(RESTART_NOTICE)
    },
  )

  it("opens a fresh block empty when nothing of adaptv's source changed", () => {
    let { state } = pollAll(launched(), [
      { native: NATIVE, config: "config-2", cli: "cli-1" },
    ])
    state = armStale(state, { native: NATIVE, config: "config-2" })
    expect(standingNotice(state)).toBeNull()
    expect(standingNotice(launched())).toBeNull()
  })
})
