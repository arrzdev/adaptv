import { describe, expect, it } from "vitest"
import {
  documentPathToArtifact,
  resolvePrecacheDocuments,
} from "#nativ/config/precache-documents"

describe("documentPathToArtifact", () => {
  it("maps the root to index.html", () => {
    expect(documentPathToArtifact("/")).toBe("index.html")
  })

  it("maps a route to its directory index", () => {
    //static hosts serve /pricing from pricing/index.html
    expect(documentPathToArtifact("/pricing")).toBe("pricing/index.html")
    expect(documentPathToArtifact("/pricing/")).toBe("pricing/index.html")
  })

  it("handles nested routes", () => {
    expect(documentPathToArtifact("/blog/hello")).toBe(
      "blog/hello/index.html",
    )
  })
})

describe("resolvePrecacheDocuments — safe by construction", () => {
  it("precaches nothing by default", () => {
    //The default MUST be empty. Precaching a personalized document puts one
    //user's server-rendered HTML in a URL-keyed, origin-wide cache where the
    //next user on the device gets served it. Naming a route has to be a
    //deliberate act. → RENDERING.md §3.2
    expect(resolvePrecacheDocuments(undefined)).toEqual([])
    expect(resolvePrecacheDocuments([])).toEqual([])
  })

  it("maps an allowlist to build artifacts", () => {
    expect(resolvePrecacheDocuments(["/", "/pricing"])).toEqual([
      "index.html",
      "pricing/index.html",
    ])
  })

  it("rejects a path that is not app-absolute", () => {
    //a relative or cross-origin entry cannot be resolved to an artifact, and
    //silently skipping it would look like it worked
    expect(() => resolvePrecacheDocuments(["pricing"])).toThrow(
      /must start with/,
    )
    expect(() =>
      resolvePrecacheDocuments(["https://example.com/x"]),
    ).toThrow(/must start with/)
  })

  it("rejects a path with a query or hash — those are not documents", () => {
    expect(() => resolvePrecacheDocuments(["/x?a=1"])).toThrow()
    expect(() => resolvePrecacheDocuments(["/x#y"])).toThrow()
  })

  it("rejects a dynamic route — a param cannot be user-agnostic", () => {
    //`/product/$id` has no single artifact, and the shape strongly implies
    //per-item (often per-user) content. Refuse rather than guess.
    expect(() => resolvePrecacheDocuments(["/product/$id"])).toThrow(
      /dynamic/i,
    )
    expect(() => resolvePrecacheDocuments(["/product/:id"])).toThrow(
      /dynamic/i,
    )
  })

  it("deduplicates so a repeated entry cannot fail the install", () => {
    //Workbox precache is all-or-nothing; a duplicate URL with a different
    //revision throws at install and the whole SW fails to activate
    expect(resolvePrecacheDocuments(["/", "/"])).toEqual(["index.html"])
  })
})
