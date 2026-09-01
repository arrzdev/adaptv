/**
 * The opacity boundary, as code.
 *
 * adaptv is a framework, not a wrapper: a consumer writes `adaptv.config.ts`, imports from
 * `@arrzdev/adaptv`, and is never told that TanStack Router, TanStack Start or Capacitor are
 * underneath (`docs/design/cli-contract.md` R8, `docs/decisions/register.md` L20 / O2). That is a
 * promise about the WHOLE surface,
 * and output is part of the surface — a `✖` naming `@tanstack/start-server-core` teaches the
 * dev the one thing the framework spent its architecture hiding, and does it at the exact
 * moment they are most likely to go and search for it.
 *
 * It was a doc rule and a habit, and a habit is not a mechanism. It broke the first time an
 * error message was made MORE helpful: a dev-server failure was taught to lift the real cause
 * out of the captured output onto the `✖` line, and the real cause was
 * `Cannot find module 'tanstack-start-injected-head-scripts:v'`. Nothing objected, because
 * nothing could. This module is the mechanism, and `opacity.test.mjs` is the enforcement.
 *
 * The rule is deliberately ONE-WAY: it can only ever suppress. Anything unrecognised prints.
 * A filter that rewrote text would eventually mangle a message the dev needed, and the failure
 * mode of this design is a leak someone notices, not a diagnosis silently corrupted.
 */

/**
 * The engines a consumer must never be told about, in every spelling a real error uses them:
 * the scoped package (`@tanstack/react-router`), a pnpm store path segment
 * (`@tanstack+start-server-core@1.167.7`), a bare or hyphenated form (`tanstack-start-…`,
 * `CapacitorCordova`), and the virtual-module ids the plugins mint
 * (`tanstack-start-injected-head-scripts:v`, `tanstack-router:autoimport`).
 *
 * NOT here on purpose: `vite`, `gradle`, `xcodebuild`, `pod`. Those are the platform toolchain
 * a dev already knows they are on, and the contract names them out loud — R24's phase
 * vocabulary includes `gradle · assembleDebug`, and the busy-port fix tells the dev to pass
 * `-- --port <n>` to the dev server. Hiding those would cost real diagnostic value and buy no
 * opacity, because nothing about them says how adaptv is built.
 */
export const PLUMBING = /(@?tanstack|capacitor|cordova)/i

/** Does this line name something the consumer is not supposed to know exists? */
export const namesPlumbing = (line) => PLUMBING.test(String(line ?? ""))

/**
 * Keep only the lines safe to show. Used on failure `detail`, where each line stands alone and
 * dropping one costs nothing but the line — the caller has already decided what the `✖` itself
 * says, which is the part that must never be merely deleted.
 */
export const withoutPlumbing = (lines) =>
  (lines ?? []).filter((l) => !namesPlumbing(l))

/**
 * Is this file the DEV'S code? Only their own source may be named in a locator, and the test is
 * ownership rather than spelling: anything under `node_modules` belongs to the toolchain, and
 * so does anything adaptv generates into `.adaptv/`. Everything else under the app root is
 * theirs and is exactly what they need to see.
 *
 * `file` may be absolute or already relative; `appRoot` is compared as a plain prefix because
 * both come from the same process and neither is user input.
 */
export function isAppSource(file, appRoot) {
  const f = String(file ?? "")
  if (!f || f.includes("node_modules") || f.includes(".adaptv/"))
    return false
  return !f.startsWith("/") || (!!appRoot && f.startsWith(`${appRoot}/`))
}
