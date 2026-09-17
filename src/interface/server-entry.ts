//The Cloudflare Worker / SSR server entry, re-exported so a consumer's
//`wrangler.toml` can point `main` at `@arrzdev/adaptv/server-entry` instead of
//naming `@tanstack/react-start` — keeping TanStack Start out of the app's config
//and `package.json`. adaptv owns the Start dependency; the `default` export is the
//worker's `{ fetch }` handler `defaultStreamHandler` builds from the app's
//generated router.
//
//`ban-server-apis.ts` allows this one specifier by name (`ALLOWED_START_SPECIFIERS`):
//under a linked install this file is not under `node_modules`, so the ban governs
//it like application source.
export {
  createServerEntry,
  default,
} from "@tanstack/react-start/server-entry"
