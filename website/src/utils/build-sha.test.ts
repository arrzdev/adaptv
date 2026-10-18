// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildSha, versionFile } from "@/utils/build-sha"

const head = () => "head000"

describe("buildSha", () => {
  it("prefers BUILD_SHA", () => {
    expect(buildSha({ BUILD_SHA: "build1", GITHUB_SHA: "gh1" }, head)).toBe(
      "build1",
    )
  })

  it("falls back to GITHUB_SHA, then the checkout's HEAD", () => {
    expect(buildSha({ GITHUB_SHA: "gh1" }, head)).toBe("gh1")
    expect(buildSha({ BUILD_SHA: "", GITHUB_SHA: "" }, head)).toBe("head000")
  })
})

describe("versionFile", () => {
  it("is {sha} as JSON with a trailing newline", () => {
    expect(versionFile("abc123")).toBe('{"sha":"abc123"}\n')
    expect(JSON.parse(versionFile("abc123"))).toEqual({ sha: "abc123" })
  })
})
