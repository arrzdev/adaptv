import { describe, expect, it } from "vitest"
import { assertNoRemovedConfigKeys } from "#adaptv/vite/removed-config-keys"

//the shape the guard sees: whatever `defineApp` returned, as plain data.
const validConfig = {
  appId: "dev.arrz.example",
  name: "Example",
  themeColor: { light: "#fff", dark: "#000" },
  splashScreen: () => Promise.resolve({ default: () => null }),
  router: {
    render: "ssr",
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
    memoryHistoryInStandalone: true,
    //`router` is an open record by design — unknown keys here are forwarded to
    //createRouter, so the guard must NOT flag them.
    defaultPreload: "viewport",
  },
}

describe("assertNoRemovedConfigKeys", () => {
  it("passes a config that only uses live keys", () => {
    expect(() => assertNoRemovedConfigKeys(validConfig)).not.toThrow()
  })

  //the regression this guard was written for: `providers` was removed in favour
  //of a layout route, the consumer kept the key, their provider tree never
  //mounted, and the splash hung forever with nothing pointing at the config.
  it("throws on `providers` and points at the layout-route migration", () => {
    expect(() =>
      assertNoRemovedConfigKeys({
        ...validConfig,
        providers: () => Promise.resolve({ default: () => null }),
      }),
    ).toThrow(/`providers`[\s\S]*layout route/)
  })

  it("throws on removed keys nested under `router`", () => {
    expect(() =>
      assertNoRemovedConfigKeys({
        ...validConfig,
        router: {
          ...validConfig.router,
          generatedRouteTree: "./routing/routeTree.gen.ts",
        },
      }),
    ).toThrow(/`router\.generatedRouteTree`/)
  })

  it("names `routerConfig` as the replacement for `virtualRouteConfig`", () => {
    expect(() =>
      assertNoRemovedConfigKeys({
        ...validConfig,
        router: {
          ...validConfig.router,
          virtualRouteConfig: "./src/routing/config.ts",
        },
      }),
    ).toThrow(/`router\.virtualRouteConfig`[\s\S]*`router\.routerConfig`/)
  })

  //one round-trip per dead key is the same slow loop the guard exists to end
  it("reports every offender in a single error", () => {
    let message = ""
    try {
      assertNoRemovedConfigKeys({
        ...validConfig,
        providers: () => Promise.resolve({ default: () => null }),
        router: {
          ...validConfig.router,
          generatedRouteTree: "./routing/routeTree.gen.ts",
          quoteStyle: "double",
        },
      })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain("3 keys")
    expect(message).toContain("`providers`")
    expect(message).toContain("`router.generatedRouteTree`")
    expect(message).toContain("`router.quoteStyle`")
  })

  it("ignores a key explicitly set to undefined", () => {
    expect(() =>
      assertNoRemovedConfigKeys({ ...validConfig, providers: undefined }),
    ).not.toThrow()
  })

  it("does not walk into a non-object `router`", () => {
    expect(() =>
      assertNoRemovedConfigKeys({ ...validConfig, router: "nope" }),
    ).not.toThrow()
  })
})
