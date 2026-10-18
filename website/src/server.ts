/*
 * The Worker's entry: adaptv's handler, with the security and cache headers on every
 * response it renders. Prerendered pages are served from assets and never reach it;
 * they get the same headers from `_headers` (`src/utils/security-headers.ts`).
 */
import handler, { createServerEntry } from "adaptv/server-entry"
import { withSecurityHeaders } from "@/utils/security-headers"

export default createServerEntry({
  async fetch(request, options) {
    return withSecurityHeaders(await handler.fetch(request, options))
  },
})
