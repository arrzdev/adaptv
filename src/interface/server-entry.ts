//The Cloudflare Worker / SSR server entry, re-exported so a consumer's
//`wrangler.toml` can point `main` at `adaptv/server-entry` instead of
//naming `@tanstack/react-start` — keeping TanStack Start out of the app's config
//and `package.json`. adaptv owns the Start dependency; the `default` export is the
//worker's `{ fetch }` handler `defaultStreamHandler` builds from the app's
//generated router.
//
//This lives in framework source, so `ban-server-apis.ts` (which forbids
//`@tanstack/react-start` in APPLICATION source) does not apply — `isApplicationSource`
//is false for adaptv's own modules.
export {
  createServerEntry,
  default,
} from "@tanstack/react-start/server-entry"
