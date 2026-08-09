// @vitest-environment node
import { describe, expect, it } from "vitest"
import { isAppSource, namesPlumbing } from "./opacity.mjs"
import { prettyLine } from "./render.mjs"

/**
 * adaptv's consumers never learn that TanStack Router, TanStack Start or Capacitor are
 * underneath (CLI-UX R8, DECISIONS L20 / O2). Every fixture here is a real line from a real
 * tool, because the leak that prompted this module was a real line from a real tool that
 * nobody thought to invent.
 */

describe("namesPlumbing — the engines, in the spellings errors actually use", () => {
  it.each([
    "Error: Cannot find module 'tanstack-start-injected-head-scripts:v'",
    "imported from '/a/node_modules/@tanstack/start-server-core/dist/esm/router-manifest.js'",
    "/a/node_modules/.pnpm/@tanstack+start-server-core@1.167.7/node_modules/x",
    "Compiling CapacitorSplashScreen.swift",
    "> Task :capacitor-android:compileDebugJavaWithJavac",
    "ProcessInfoPlistFile ResourceBundle-CapacitorCordova-Info.plist",
    "[capacitor] error: something",
    "installing @capacitor/ios",
  ])("catches %s", (line) => {
    expect(namesPlumbing(line)).toBe(true)
  })

  it.each([
    //The platform toolchain is NOT hidden: the contract names it out loud (R24's phase
    //vocabulary has `gradle · assembleDebug`, and the busy-port fix tells the dev to pass
    //`-- --port <n>`). Hiding these would cost diagnosis and buy no opacity.
    "vite dev exited (code 1) before it was ready",
    "port 41730 is already in use",
    "gradle · assembleDebug",
    "compiling",
    "linking plugins · device",
    "/a/src/routes/cart.tsx:12:3: error: unexpected token",
  ])("leaves %s alone", (line) => {
    expect(namesPlumbing(line)).toBe(false)
  })
})

describe("the live row cannot narrate the plumbing either", () => {
  it("drops an unrecognised tool line that names an engine", () => {
    //One lowercase pass away from being the phase on screen, before the gate existed.
    expect(prettyLine("Compiling CapacitorSplashScreen.swift")).toBe("")
    expect(prettyLine("Touching Capacitor.framework")).toBe("")
  })

  it("still passes adaptv's OWN vocabulary through untouched", () => {
    //Including a plugin the dev registered, whatever it is called — that one is THEIRS (R8),
    //and it reaches the row above the gate via OWN_PHASES.
    expect(prettyLine("linking plugins · device")).toBe(
      "linking plugins · device",
    )
    expect(prettyLine("packaging")).toBe("packaging")
  })
})

describe("isAppSource — only the dev's own code may be named", () => {
  it.each([
    ["/app/src/routes/cart.tsx", "/app", true],
    ["src/routes/cart.tsx", "/app", true],
    ["/app/node_modules/@tanstack/x/i.js", "/app", false],
    ["/app/.adaptv/builds/app.apk", "/app", false],
    ["/elsewhere/src/x.ts", "/app", false],
    ["", "/app", false],
  ])("%s under %s → %s", (file, root, want) => {
    expect(isAppSource(file, root)).toBe(want)
  })
})
