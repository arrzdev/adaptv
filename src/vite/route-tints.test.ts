import { describe, expect, it } from "vitest"
import { routeTintsInSource } from "#adaptv/vite/route-tints.ts"

const FILE = "/app/src/routing/pages/settings.page.tsx"
const scan = (source: string) => routeTintsInSource(source, FILE)

describe("routeTintsInSource", () => {
  it("reads an inline literal off a route", () => {
    expect(
      scan(`export const Route = createFileRoute("/_p/settings")({
        chromeTint: "#0b6e4f",
        component: Settings,
      })`),
    ).toEqual([{ id: "/_p/settings", path: "/settings", tint: "#0b6e4f" }])
  })

  it("resolves a top-level const, which is how anyone who also DISPLAYS the colour writes it", () => {
    expect(
      scan(`const TINT = "#0b6e4f"
      export const Route = createFileRoute("/_p/settings")({
        chromeTint: TINT,
      })`),
    ).toEqual([{ id: "/_p/settings", path: "/settings", tint: "#0b6e4f" }])
  })

  it("parses TSX — a route file is a component file", () => {
    //the scan runs on the app's real source, JSX and type annotations included;
    //a parser told this is plain JS fails on the first `<div/>`
    expect(
      scan(`export const Route = createFileRoute("/_p/settings")({
        chromeTint: "#0b6e4f",
        component: function S(): React.ReactNode { return <div className="x" /> },
      })`),
    ).toHaveLength(1)
  })

  it("reads a lazy route the same way", () => {
    expect(
      scan(`export const Route = createLazyFileRoute("/_p/settings")({
        chromeTint: "#0b6e4f",
      })`),
    ).toHaveLength(1)
  })

  it("returns nothing for a route that declares no tint", () => {
    expect(
      scan(`export const Route = createFileRoute("/_p/settings")({
        component: Settings,
      })`),
    ).toEqual([])
  })

  it("ignores a chromeTint that is not a route option at all", () => {
    //the substring pre-filter is an optimisation, not the decision — the AST
    //walk only ever looks inside a `createFileRoute(...)(...)` options object
    expect(scan(`const theme = { chromeTint: "#0b6e4f" }`)).toEqual([])
  })

  it("REFUSES a computed tint, naming the file", () => {
    //the whole option exists to be right on the first frame, and a computed
    //value cannot be. Falling back to the theme colour here would ship exactly
    //the flash it removes — silently.
    expect(() =>
      scan(`export const Route = createFileRoute("/_p/settings")({
        chromeTint: pickColour(),
      })`),
    ).toThrow(/must be a literal colour string/)
    expect(() =>
      scan(`export const Route = createFileRoute("/_p/settings")({
        chromeTint: dark ? "#000" : "#fff",
      })`),
    ).toThrow(new RegExp(FILE))
  })

  it("REFUSES an identifier it cannot resolve in this file", () => {
    //an imported colour looks exactly like a local one at the call site, and is
    //not readable here. Better a build error than a route that silently flashes.
    expect(() =>
      scan(`import { TINT } from "@/theme"
      export const Route = createFileRoute("/_p/settings")({
        chromeTint: TINT,
      })`),
    ).toThrow(/top-level const in the same file/)
  })

  it("skips the parse entirely when the file cannot contain a tint", () => {
    //a route tree has hundreds of files and almost none declare a tint; the
    //cheap substring question is asked first. A file that would fail to parse
    //therefore costs nothing — which is also what keeps a scan of the whole
    //routes directory affordable on every dev start.
    expect(scan("this is not ( valid ] typescript at all")).toEqual([])
  })
})
