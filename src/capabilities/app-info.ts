//App identity accessor — which build of this app is running:
//  • native  → @capacitor/app `getInfo()`: the name, the bundle id, the store
//              version and the build number the binary was signed with.
//  • web/PWA → the app's own web manifest, which adaptv generates and serves,
//              for the name and the identity — and `null` for the version and
//              the build, because a page has no installed version.
//
//## Why the web half is honest instead of clever
//
//There is no web equivalent of a store version. A page is whatever the server
//answered with a moment ago, and the closest thing to a build number is the
//service worker's build tag, which names the JS bundle rather than the app the
//user installed. Reporting that as `version` would let a support screen print a
//number, and the number would be a different thing on each target — the exact
//kind of quiet mismatch this layer exists to prevent. So the web says `null`
//twice and {@link getAppInfoCaveat} says why in a sentence a UI can render.
//
//## Not the OTA bundle
//
//`ota/` answers "which JS bundle is live", which moves without the store. This
//answers "which binary is this", which does not. A bug report needs both, and
//conflating them is how a report says 1.4.0 for a device running 1.4.0's binary
//with 1.6.2's JavaScript.
import { App } from "@capacitor/app"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * One record for every target. Every field a target cannot answer is `null`
 * rather than `""` or `"unknown"`: a settings row has to be able to tell "this
 * target will not say" apart from an empty string, and only `null` does that.
 */
export interface AppInfo {
  /** Display name. Native: the binary's. Web: the manifest's `name`. */
  name: string | null
  /** Native: the bundle id. Web: the manifest `id`, which adaptv sets. */
  id: string | null
  /** The store version, `"1.4.0"`. Always `null` on the web. */
  version: string | null
  /** The build number, `"42"`. Always `null` on the web. */
  build: string | null
}

const EMPTY: AppInfo = { name: null, id: null, version: null, build: null }

function nativePlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("App")
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null
}

//Resolved once and kept: none of these four can change while the process is
//alive — a new binary is a new process. This is the memoisation rule
//`device.ts` records, applied to a record with the same lifetime.
let cached: Promise<AppInfo> | null = null

async function readNative(): Promise<AppInfo> {
  try {
    const info = await App.getInfo()
    return {
      name: text(info.name),
      id: text(info.id),
      version: text(info.version),
      build: text(info.build),
    }
  } catch {
    //An OS that refused. The manifest is the floor on every target, including
    //this one: the WebView serves it, and it carries the same name the binary
    //was built from, so a settings screen still has something true to render.
    return readManifest()
  }
}

async function readManifest(): Promise<AppInfo> {
  if (typeof document === "undefined") return EMPTY
  const link = document.querySelector<HTMLLinkElement>(
    'link[rel="manifest"]',
  )
  const href = link?.getAttribute("href")
  if (!href) return EMPTY
  try {
    const response = await fetch(href)
    if (!response.ok) return EMPTY
    const manifest = (await response.json()) as Record<string, unknown>
    return {
      //`short_name` is what a home screen shows when `name` is long, so it is
      //the fallback rather than a second field nobody reads.
      name: text(manifest.name) ?? text(manifest.short_name),
      id: text(manifest.id),
      version: null,
      build: null,
    }
  } catch {
    return EMPTY
  }
}

/**
 * The name, identity, version and build of the running app. Resolves a record
 * of nulls rather than rejecting, on every target and every failure.
 *
 * The manifest is the floor everywhere: a native binary whose plugin is missing
 * or refuses still reports the name and identity adaptv generated the manifest
 * from, and only the two fields that genuinely need the binary go `null`.
 */
export function getAppInfo(): Promise<AppInfo> {
  cached ??= nativePlugin() ? readNative() : readManifest()
  return cached
}

/**
 * What this target will not answer, or `null` when it answers everything. The
 * third state keep-awake established: the call resolves and a field is still
 * empty, and only a sentence can say why.
 */
export function getAppInfoCaveat(): string | null {
  if (nativePlugin()) return null
  if (isNativePlatform())
    return "This binary was built before the app plugin, so the version and the build read as none and the name comes from the app's manifest instead; a rebuild carries them."
  return "A page has no installed version: the browser holds no store version and no build number, so both read as none. The name and the identity come from the app's own web manifest."
}

/** Test seam — drops the memoised record so the next read re-branches. */
export function resetAppInfo(): void {
  cached = null
}
