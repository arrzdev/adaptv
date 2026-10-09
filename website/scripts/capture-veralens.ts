/*
 * Renders the landing page's Veralens screen: its card in "Built with adaptv".
 *
 *   node website/scripts/capture-veralens.ts http://localhost:6101
 *
 * The URL serves Veralens' site built for the web (its repo's `apps/website`: `vite build`,
 * then `vite preview`). The screen is the public home page, signed out, so no account,
 * key or hostname reaches the capture. What these captures are and aren't: phones.ts.
 */
import { join } from "node:path"
import { capture, root } from "./phones.ts"

const url = process.argv[2]
if (!url) {
  process.stderr.write(
    "usage: node website/scripts/capture-veralens.ts <url>\n",
  )
  process.exit(1)
}

//shown at most 280 px wide below the fold, as ChopChop's card: 1.5x
await capture(
  "android",
  url,
  join(root, "website/src/assets/built-with/veralens.webp"),
  //the hero art fades in
  (page) => page.waitForTimeout(1500),
  1.5,
)
