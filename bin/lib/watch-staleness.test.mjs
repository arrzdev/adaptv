// @vitest-environment node
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
  armStale(initialStale("cli-1"), {
    native: NATIVE,
    config: "config-1",
    applied: PLATFORMS,
  })

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

  it("names a reused install the device proved to be another build as a native change", () => {
    //the fingerprint is unchanged (this checkout wrote nothing), but the binary on the
    //device is not this run's: `b` is the fix, and the row says so
    const result = pollStale(
      launched(),
      { native: NATIVE, config: "config-1", cli: "cli-1" },
      PLATFORMS,
      ["android"],
    )
    expect(result.notice).toEqual({
      text: "native change · android",
      restart: false,
    })
    //the run cache forgets the install (runLive), so nothing re-arms here: an install that
    //is still wrong on the next poll is named again
    expect(
      pollStale(
        result.state,
        { native: NATIVE, config: "config-1", cli: "cli-1" },
        PLATFORMS,
        ["android"],
      ).notice,
    ).toEqual({ text: "native change · android", restart: false })
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
      state = armStale(state, {
        native: NATIVE,
        config,
        applied: PLATFORMS,
      })
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
    state = armStale(state, {
      native: NATIVE,
      config: "config-2",
      applied: PLATFORMS,
    })
    expect(standingNotice(state)).toBeNull()
    expect(standingNotice(launched())).toBeNull()
  })
})

describe("a pending config or native row stays until a b applies it (R40, R41)", () => {
  //Each poll re-armed the fingerprints and named only what THAT poll saw, so the row was
  //whatever changed last: a config edit, then a native edit a poll later, read `native change`
  //while the config edit still waited for the `b` it no longer asked for.
  it("names a config edit and a later native edit together", () => {
    const { notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-2", cli: "cli-1" },
      {
        native: { ...NATIVE, ios: "ios-2" },
        config: "config-2",
        cli: "cli-1",
      },
    ])
    expect(notices).toEqual([
      { text: "config change", restart: false },
      { text: "config + native change · ios", restart: false },
    ])
  })

  it("names a native edit and a later config edit together", () => {
    const edited = { ...NATIVE, android: "android-2" }
    const { notices } = pollAll(launched(), [
      { native: edited, config: "config-1", cli: "cli-1" },
      { native: edited, config: "config-2", cli: "cli-1" },
    ])
    expect(notices).toEqual([
      { text: "native change · android", restart: false },
      { text: "config + native change · android", restart: false },
    ])
  })

  it("accumulates the platforms, in the order a single poll names them", () => {
    const { notices } = pollAll(launched(), [
      {
        native: { ...NATIVE, android: "android-2" },
        config: "config-1",
        cli: "cli-1",
      },
      {
        native: { ios: "ios-2", android: "android-2" },
        config: "config-1",
        cli: "cli-1",
      },
    ])
    expect(notices).toEqual([
      { text: "native change · android", restart: false },
      { text: "native change · ios, android", restart: false },
    ])
  })

  //`r` relaunches the installed app and applies nothing, but it mounts a fresh block, and a
  //fresh block opened empty: the row asking for `b` came down with the one key that could
  //apply it still unpressed.
  it("keeps the row through an r reload", () => {
    const { state } = pollAll(launched(), [
      {
        native: { ...NATIVE, ios: "ios-2" },
        config: "config-2",
        cli: "cli-1",
      },
    ])
    //what `r` does: relaunch, then mount a fresh block, re-arming nothing
    expect(standingNotice(state)).toEqual({
      text: "config + native change · ios",
      restart: false,
    })
  })

  //A `b` whose web bundle fails mounts a fresh block too, having installed nothing.
  it("keeps the row through a b rebuild whose web bundle failed", () => {
    const { state } = pollAll(launched(), [
      { native: NATIVE, config: "config-2", cli: "cli-1" },
    ])
    //what a failed `b` does: report the failure, then mount a fresh block, re-arming nothing
    expect(standingNotice(state)).toEqual({
      text: "config change",
      restart: false,
    })
  })

  it("clears the config and native a b rebuild applied, never the restart", () => {
    const edited = {
      native: { ...NATIVE, ios: "ios-2" },
      config: "config-2",
    }
    let { state } = pollAll(launched(), [{ ...edited, cli: "cli-1" }])
    state = armStale(state, { ...edited, applied: PLATFORMS })
    expect(standingNotice(state)).toBeNull()
    //the next edit names only itself: nothing of what `b` applied is carried into it
    expect(
      pollStale(
        state,
        {
          native: { ...edited.native, android: "android-2" },
          config: "config-2",
          cli: "cli-1",
        },
        PLATFORMS,
      ).notice,
    ).toEqual({ text: "native change · android", restart: false })

    let restarted = pollAll(launched(), [
      { ...edited, cli: "cli-1" },
      { ...edited, cli: "cli-2" },
    ]).state
    restarted = armStale(restarted, { ...edited, applied: PLATFORMS })
    expect(standingNotice(restarted)).toEqual(RESTART_NOTICE)
  })

  it("lets a restart win the row over a pending config edit, fresh block included (R54)", () => {
    const { state, notices } = pollAll(launched(), [
      { native: NATIVE, config: "config-2", cli: "cli-1" },
      { native: NATIVE, config: "config-2", cli: "cli-2" },
    ])
    expect(notices).toEqual([
      { text: "config change", restart: false },
      RESTART_NOTICE,
    ])
    expect(standingNotice(state)).toEqual(RESTART_NOTICE)
  })

  //A `b` whose bundle builds but whose platform lane fails still reached `armStaleness`, which
  //re-armed everything: the row came down for a platform the rebuild never installed, while
  //its own lane said it had failed.
  it("keeps a platform's row when its lane fails, with the config it carries", () => {
    const ios = ["ios"]
    let state = armStale(initialStale("cli-1"), {
      native: { ios: "ios-1" },
      config: "config-1",
      applied: ios,
    })
    state = pollStale(
      state,
      { native: { ios: "ios-2" }, config: "config-2", cli: "cli-1" },
      ios,
    ).state
    //what `b` does when the web bundle builds and the ios lane fails: the prepare it ran
    //moved the native tree, so the fingerprint re-arms, but nothing reached the device
    const rebuilt = { native: { ios: "ios-3" }, config: "config-2" }
    state = armStale(state, { ...rebuilt, applied: [] })
    expect(standingNotice(state)).toEqual({
      text: "config + native change · ios",
      restart: false,
    })
    //and the row holds without raising itself again while nothing moves
    const idle = pollStale(state, { ...rebuilt, cli: "cli-1" }, ios)
    expect(idle.notice).toBeNull()
    expect(standingNotice(idle.state)).toEqual(standingNotice(state))
  })

  it("clears the platform whose lane succeeded and keeps the one that failed", () => {
    const edited = {
      native: { ios: "ios-2", android: "android-2" },
      config: "config-1",
    }
    let { state } = pollAll(launched(), [{ ...edited, cli: "cli-1" }])
    state = armStale(state, { ...edited, applied: ["android"] })
    expect(standingNotice(state)).toEqual({
      text: "native change · ios",
      restart: false,
    })
    //with a config edit pending, the config stays too: ios never got it
    state = pollAll(launched(), [
      { ...edited, config: "config-2", cli: "cli-1" },
    ]).state
    state = armStale(state, {
      ...edited,
      config: "config-2",
      applied: ["android"],
    })
    expect(standingNotice(state)).toEqual({
      text: "config + native change · ios",
      restart: false,
    })
  })

  //The dev saves a native file or the config and presses `b` inside the poll's 3 s, and that
  //platform's lane fails. No poll had recorded the edit, and arming re-armed the fingerprint
  //past it, so no row ever came up for an edit the device still lacks.
  it("keeps an edit no poll saw when b's lane for it fails", () => {
    const edited = {
      native: { ...NATIVE, ios: "ios-2" },
      config: "config-2",
      cli: "cli-1",
    }
    //what `b` does: read the tree before it writes anything, run the lanes, then arm
    const state = armStale(launched(), {
      before: edited,
      native: { ios: "ios-3", android: "android-3" },
      config: "config-2",
      applied: ["android"],
    })
    expect(standingNotice(state)).toEqual({
      text: "config + native change · ios",
      restart: false,
    })
    //the reading raised no notice of its own, and the next idle poll raises none either
    expect(
      pollStale(
        state,
        {
          native: { ios: "ios-3", android: "android-3" },
          config: "config-2",
          cli: "cli-1",
        },
        PLATFORMS,
      ).notice,
    ).toBeNull()
  })

  it("clears an edit no poll saw when b applies it", () => {
    const state = armStale(launched(), {
      before: {
        native: { ...NATIVE, ios: "ios-2" },
        config: "config-2",
        cli: "cli-1",
      },
      native: { ios: "ios-3", android: "android-3" },
      config: "config-2",
      applied: PLATFORMS,
    })
    expect(standingNotice(state)).toBeNull()
  })
})
