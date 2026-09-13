import { describe, expect, it } from "vitest"
import { publicPath } from "#adaptv/utils/public-path"

describe("publicPath — a built file's URL under the deploy base", () => {
  it("is root-absolute at the origin root", () => {
    expect(publicPath("/", "assets/entry.js")).toBe("/assets/entry.js")
    expect(publicPath("/", "")).toBe("/")
  })

  it("lives under a subpath base", () => {
    expect(publicPath("/app/", "assets/entry.js")).toBe(
      "/app/assets/entry.js",
    )
    expect(publicPath("/app/", "")).toBe("/app/")
  })

  it("joins with one slash however the base and the file were written", () => {
    //Vite keeps `base: "/app"` without its slash, and an icon set's `urlBase`
    //is written root-absolute (`/favicons`)
    expect(publicPath("/app", "manifest.json")).toBe("/app/manifest.json")
    expect(publicPath("/app/", "/favicons/icon.png")).toBe(
      "/app/favicons/icon.png",
    )
  })
})
