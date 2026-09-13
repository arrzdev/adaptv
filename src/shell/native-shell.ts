/**
 * Which native build is this WebView running inside, and is it the one the dev session serves?
 *
 * `adaptv dev ios|android` points an INSTALLED app at the dev server. That app is a native
 * shell, and the dev server cannot swap it: when the native project changed (a plugin, a
 * config field the binary bakes in, hand-written native code) the CLI rebuilds and reinstalls
 * it, and until that lands the app already on the device is the wrong binary. It used to
 * reconnect anyway, the moment the dev server answered, so the dev saw the app come up inside
 * a stale shell and then get replaced by the rebuilt one.
 *
 * So every dev build carries an id, and the dev session names the id it expects:
 *
 * - **The shell's id** is a nonce the CLI mints per native build (`<platform>-<hex>`) and bakes
 *   into the generated native config as the WebView's appended user agent. A user agent is the
 *   one value that ships inside both the `.app` and the `.apk`, and that every document in
 *   that WebView can read without a bridge and before any network — including the offline
 *   page, which Android serves with no bridge at all.
 * - **The expected id** is decided by the CLI once it knows whether the installed app is reused
 *   or rebuilt, and the dev server answers it at {@link NATIVE_SHELL_ENDPOINT}. Until the CLI
 *   has decided, the answer is `pending`.
 *
 * Only `match` reconnects. The verdict is the dev server's (`vite/native-shell-plugin.ts`);
 * both clients — the entry's boot gate and the offline page — send their own id and obey.
 *
 * Mirrored in `bin/lib/native-shell.mjs`, because the CLI cannot import framework source;
 * `native-shell.test.mjs` pins the token, the endpoint and the parser between the two.
 */

/** The user-agent product token the id travels under: `adaptv-shell/<id>`. */
export const NATIVE_SHELL_TOKEN = "adaptv-shell"

/** Where the dev server answers `{ verdict }` for `?id=<shell id>`. */
export const NATIVE_SHELL_ENDPOINT = "/__adaptv/native-shell"

export type NativeShellVerdict = "match" | "pending" | "stale" | "unserved"

/**
 * The shell id a user agent carries, or `null`.
 *
 * Matched as a whole product token: WebKit puts it after `Mobile/<build>`, Chromium after
 * `Safari/<version>`.
 */
export function shellIdFromUserAgent(
  userAgent: string | null | undefined,
): string | null {
  const m = /(?:^|\s)adaptv-shell\/([a-z]+-[0-9a-f]+)(?=\s|$)/.exec(
    userAgent ?? "",
  )
  return m ? m[1] : null
}

/**
 * The dev server's decision for one shell.
 *
 * `expected` maps each platform of the run to the id the CLI decided on, `null` while it is still
 * deciding, and `false` once the run has dropped it (its native project could not be prepared).
 * A platform with no entry is not part of the run at all. `expected` itself is `null` when
 * nothing could be read from the CLI.
 *
 * - `match`    — the id is the build this session installed or reused: reconnect.
 * - `pending`  — the CLI has not decided for that platform yet (still preparing). Wait.
 * - `stale`    — the CLI decided on a different build. Wait for that one to be launched.
 * - `unserved` — this run is not serving that platform: `dev ios` while an Android app from an
 *                earlier run polls the same port, or a `dev all` that dropped a platform. Wait,
 *                but no build is coming, and the app must not be told one is.
 *
 * A shell with NO id is `stale`, not `pending`: nothing unmarked can prove it is current, and
 * the CLI never reuses an install it holds no id for, so a rebuild is what is coming.
 */
export function nativeShellVerdict(
  id: string | null | undefined,
  expected: Record<string, string | false | null | undefined> | null,
): NativeShellVerdict {
  const dash = id ? id.indexOf("-") : -1
  if (!id || dash < 1) return "stale"
  if (!expected) return "pending"
  const platform = id.slice(0, dash)
  if (!Object.hasOwn(expected, platform)) return "unserved"
  const want = expected[platform]
  if (want === false) return "unserved"
  if (want == null) return "pending"
  return want === id ? "match" : "stale"
}
