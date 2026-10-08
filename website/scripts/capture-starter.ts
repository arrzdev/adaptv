/*
 * Renders the stand-in screenshots of the starter app for the landing page's hero.
 *
 *   node website/scripts/capture-starter.ts http://localhost:4173
 *
 * The URL serves the app `pnpm create adaptv my-app` writes, built: `pnpm build && pnpm pack`
 * here, `ADAPTV_SPEC=file:<tgz> node packages/create-adaptv/index.mjs my-app` somewhere else,
 * then `pnpm install && pnpm build` in the app and any static server on `.output/public`.
 * What a stand-in is and isn't: phones.ts. This script goes away with the last stand-in.
 */
import { join } from "node:path"
import { capture, root } from "./phones.ts"

const url = process.argv[2]
if (!url) {
  process.stderr.write("usage: node website/scripts/capture-starter.ts <url>\n")
  process.exit(1)
}

for (const phone of ["ios", "android"] as const) {
  await capture(
    phone,
    url,
    join(root, `website/src/assets/hero/starter-${phone}.png`),
  )
}
