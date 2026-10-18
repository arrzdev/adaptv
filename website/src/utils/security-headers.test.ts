//node, not happy-dom: happy-dom drops Set-Cookie from a Response, as a browser does
// @vitest-environment node
import { describe, expect, it } from "vitest"
import {
  CACHE_PRIVATE,
  CACHE_PUBLIC_HTML,
  SECURITY_HEADERS,
  staticHeaderRules,
  withSecurityHeaders,
} from "@/utils/security-headers"

function serve(
  init: { contentType?: string; headers?: Record<string, string> } = {},
) {
  const response = new Response("<html></html>", {
    status: 200,
    headers: {
      "Content-Type": init.contentType ?? "text/html; charset=utf-8",
      ...init.headers,
    },
  })
  return withSecurityHeaders(response).headers
}

//the `_headers` rules by path pattern: { "/*": { header: value } }
function parseRules(text: string) {
  const rules: Record<string, Record<string, string>> = {}
  let current: Record<string, string> | undefined
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue
    if (!/^\s/.test(line)) {
      current = {}
      rules[line.trim()] = current
      continue
    }
    const [name, ...value] = line.trim().split(":")
    if (current) current[name.trim()] = value.join(":").trim()
  }
  return rules
}

describe("withSecurityHeaders", () => {
  it("sends the security headers on every Worker response", () => {
    for (const headers of [
      serve(),
      serve({ contentType: "application/json" }),
    ]) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(headers.get(name)).toBe(value)
      }
    }
  })

  it("pins the header policy", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=31536000",
    )
    expect(SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff")
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    )
    const csp = SECURITY_HEADERS["Content-Security-Policy-Report-Only"]
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
  })

  it("lets a page be cached briefly by a shared cache", () => {
    expect(serve().get("Cache-Control")).toBe(CACHE_PUBLIC_HTML)
    expect(CACHE_PUBLIC_HTML).toBe(
      "public, max-age=0, s-maxage=60, must-revalidate",
    )
  })

  it("never lets a shared cache keep a cookie", () => {
    expect(
      serve({
        headers: { "Set-Cookie": "a=b", "Cache-Control": "public" },
      }).get("Cache-Control"),
    ).toBe(CACHE_PRIVATE)
    expect(CACHE_PRIVATE).toBe("private, no-store")
  })

  it("leaves the cache policy of other responses alone", () => {
    expect(
      serve({
        contentType: "application/xml",
        headers: { "Cache-Control": "public, max-age=3600" },
      }).get("Cache-Control"),
    ).toBe("public, max-age=3600")
  })
})

describe("staticHeaderRules", () => {
  const rules = parseRules(staticHeaderRules())

  it("sends the same security headers on every static asset", () => {
    expect(rules["/*"]).toEqual(SECURITY_HEADERS)
  })

  it("gives every prerendered page the page cache policy", () => {
    for (const pattern of ["/", "/:page", "/docs/*", "/blog/*"]) {
      expect(rules[pattern]).toEqual({ "Cache-Control": CACHE_PUBLIC_HTML })
    }
  })

  //Nitro appends `/assets/*` with `immutable`; two matching rules would join
  //their Cache-Control values with a comma
  it("never sets Cache-Control on a rule that matches /assets/", () => {
    expect(rules["/*"]).not.toHaveProperty("Cache-Control")
    expect(rules).not.toHaveProperty("/assets/*")
  })
})
