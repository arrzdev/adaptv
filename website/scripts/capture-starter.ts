/*
 * Renders the stand-in screenshots of the starter app for the landing page's hero.
 *
 *   node website/scripts/capture-starter.ts http://localhost:4173
 *
 * The URL serves the app `pnpm create adaptv my-app` writes, built: `pnpm build && pnpm pack`
 * here, `ADAPTV_SPEC=file:<tgz> node packages/create-adaptv/index.mjs my-app` somewhere else,
 * then `pnpm install && pnpm build` in the app and any static server on `.output/public`.
 *
 * These are NOT device captures. Chromium renders the app in each phone's viewport at its
 * screenshot resolution, in dark mode, and the only additions are a drawn status bar and
 * Inter in place of the phone's system font (Linux has neither SF nor Roboto). A real
 * capture of the same screen replaces a file in src/assets/hero/ as is, so this script
 * goes away with the last stand-in. Playwright comes from the playground:
 * `pnpm playground:setup` first.
 */
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const url = process.argv[2]
if (!url) {
  process.stderr.write("usage: node website/scripts/capture-starter.ts <url>\n")
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(join(root, "playground/package.json"))
const { chromium } = require("@playwright/test")

const icons = `
  <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 2.6c2.2 0 4.2.9 5.7 2.3l1.2-1.2A9.7 9.7 0 0 0 8 .9 9.7 9.7 0 0 0 1.1 3.7l1.2 1.2A8 8 0 0 1 8 2.6Zm0 3.3c1.3 0 2.5.5 3.4 1.3l1.2-1.2A6.6 6.6 0 0 0 8 4.2 6.6 6.6 0 0 0 3.4 6l1.2 1.2c.9-.8 2.1-1.3 3.4-1.3Zm0 3.3c.5 0 .9.2 1.2.5L8 11 6.8 9.7c.3-.3.7-.5 1.2-.5Z"/></svg>
  <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="23" height="12" rx="3.5" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="20" height="9" rx="2" fill="currentColor"/><path d="M25 4.5v4c.8-.3 1.3-1.1 1.3-2s-.5-1.7-1.3-2Z" fill="currentColor" opacity=".4"/></svg>`

/* Each viewport and scale is the phone's own, so a screenshot from the phone has the same size. */
const DEVICES = {
  //iPhone 15: 1179 × 2556. The status bar sits either side of the Dynamic Island.
  ios: {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    bar: `<div style="height:54px;display:flex;align-items:center;justify-content:space-between;padding:4px 30px 0 52px;font:600 17px Inter">
      <span>9:41</span><span style="display:flex;gap:6px;align-items:center">${icons}</span></div>`,
  },
  //Pixel 8: 1080 × 2400. The camera hole is the frame's, in the middle of the bar.
  android: {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    bar: `<div style="height:40px;display:flex;align-items:center;justify-content:space-between;padding:0 22px;font:500 14px Inter">
      <span>9:41</span><span style="display:flex;gap:6px;align-items:center;transform:scale(.85)">${icons}</span></div>`,
  },
} as const

const browser = await chromium.launch()
for (const [name, device] of Object.entries(DEVICES)) {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  })
  const page = await context.newPage()
  await page.goto(url, { waitUntil: "networkidle" })
  await page.addStyleTag({
    content: `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=block");
      html, body { font-family: Inter, sans-serif; }`,
  })
  await page.evaluate((bar: string) => {
    const el = document.createElement("div")
    el.style.cssText =
      "position:fixed;inset:0 0 auto;z-index:2147483647;color:inherit"
    el.innerHTML = bar
    document.body.append(el)
  }, device.bar)
  await page.evaluate(() => document.fonts.ready)
  const out = join(root, `website/src/assets/hero/starter-${name}.png`)
  await page.screenshot({ path: out })
  process.stdout.write(`${out}\n`)
  await context.close()
}
await browser.close()
