import { describe, expect, it } from "vitest"
import {
  nativeShellVerdict,
  shellIdFromUserAgent,
} from "#adaptv/shell/native-shell"

/** What each native runtime actually makes of `appendUserAgent`. */
const IOS_UA = (mark: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 ${mark}`
const ANDROID_UA = (mark: string) =>
  `Mozilla/5.0 (Linux; Android 16; sdk_gphone64_arm64 Build/BP22.250325.006; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.7151.115 Mobile Safari/537.36 ${mark}`

describe("the shell id a WebView carries", () => {
  it("reads the id off both runtimes' user agents", () => {
    expect(shellIdFromUserAgent(IOS_UA("adaptv-shell/ios-3f9a1c2b"))).toBe(
      "ios-3f9a1c2b",
    )
    expect(
      shellIdFromUserAgent(ANDROID_UA("adaptv-shell/android-00ff00ff")),
    ).toBe("android-00ff00ff")
  })

  it("finds nothing on a user agent that carries no mark, or only something like one", () => {
    expect(shellIdFromUserAgent(IOS_UA(""))).toBeNull()
    expect(shellIdFromUserAgent(undefined)).toBeNull()
    expect(
      shellIdFromUserAgent("Foo xadaptv-shell/ios-3f9a1c2b"),
    ).toBeNull()
    expect(
      shellIdFromUserAgent("Foo adaptv-shell/ios-3f9a1c2bZ"),
    ).toBeNull()
  })
})

describe("the dev server's verdict", () => {
  const decided = { ios: "ios-aaaa1111", android: null }

  it("matches only the id this run decided on for that platform", () => {
    expect(nativeShellVerdict("ios-aaaa1111", decided)).toBe("match")
  })

  it("calls a different build on a decided platform stale — the old app waits for the new one", () => {
    expect(nativeShellVerdict("ios-bbbb2222", decided)).toBe("stale")
  })

  it("waits while the CLI has not decided a platform yet, however current the install may turn out", () => {
    expect(nativeShellVerdict("android-cccc3333", decided)).toBe("pending")
    //the moment the dev server comes up, before any platform is prepared
    expect(nativeShellVerdict("ios-aaaa1111", { ios: null })).toBe(
      "pending",
    )
    //nothing readable from the CLI yet
    expect(nativeShellVerdict("ios-aaaa1111", null)).toBe("pending")
  })

  it("tells an app this run is not serving its platform, instead of promising it will open", () => {
    //`dev ios` while an Android app from an earlier run polls the same port
    expect(nativeShellVerdict("android-cccc3333", { ios: "ios-1" })).toBe(
      "unserved",
    )
    //`dev all` whose iOS project could not be prepared
    expect(
      nativeShellVerdict("ios-aaaa1111", { ios: false, android: null }),
    ).toBe("unserved")
  })

  it("never matches a shell with no id: nothing unmarked can prove it is current", () => {
    expect(nativeShellVerdict(null, decided)).toBe("stale")
    expect(nativeShellVerdict("", { ios: null })).toBe("stale")
    expect(nativeShellVerdict("nodash", decided)).toBe("stale")
    expect(nativeShellVerdict("-aaaa1111", decided)).toBe("stale")
  })

  it("does not read a platform off the object's prototype", () => {
    expect(nativeShellVerdict("constructor-00", decided)).toBe("unserved")
  })
})
