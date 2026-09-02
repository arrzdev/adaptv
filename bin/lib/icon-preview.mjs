// The contact sheet: every STATE an app's icon is actually rendered in.
//
// A terminal cannot show the one thing the dev needs to check. `gen icons` makes decisions they
// can only judge by eye — is the mark still legible inside Android's safe zone, does the logo
// survive being cut to a circle, does the dark variant disappear on the backdrop iOS puts behind
// it, is the 16px favicon a smudge — and the alternative to showing them is a build, an install,
// and a look at a home screen.
//
// So the sheet is organised by STATE, not by file. A row of filenames tells a dev what adaptv
// wrote; a row of home screens tells them what their users will see. Each tile is composited the
// way the platform composites it — the mask it applies, the backdrop it supplies, the tint it
// maps — because a dark icon judged on this page's own background looks fine and is invisible on
// a phone.
//
// ONE self-contained HTML file: no server, no upload, no assets to resolve. Every image is
// inlined as a data URI, which is why it can live in `.adaptv/` (gitignored, disposable) and
// still be opened straight from disk weeks later.
//
// Written on EVERY run, not behind a flag. It is the only place a dev can see what the warnings
// describe, and it costs one file in a directory adaptv already owns and gitignores. Behind a
// flag it was a review step only someone who already knew to look would find.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/** The tile size every mock is drawn at — the safe-zone rings are computed from it. */
const TILE_PX = 132

/** The backdrops the two platforms actually put behind an icon. */
const IOS_LIGHT = "#ececed"
const IOS_DARK = "#1c1c1e"

/** A stand-in for the user's chosen home-screen tint, for the tinted mock. */
const TINT = "#7aa7ff"

/**
 * Two plausible Material You palettes, for the themed-icon mock. Android derives these from the
 * wallpaper, so like `TINT` they stand in for a colour the dev does not choose — but unlike iOS
 * the launcher supplies BOTH the ink and what sits behind it, which is why each entry is a pair.
 */
const ANDROID_THEMED = [
  { label: "themed · light", bg: "#dbe2f5", ink: "#37436b" },
  { label: "themed · dark", bg: "#2b2f3a", ink: "#c2cbe8" },
]

const MIME = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

const dataUri = (file) =>
  `data:${MIME[path.extname(file).toLowerCase()] ?? "image/png"};base64,${readFileSync(file).toString("base64")}`

/**
 * Write the contact sheet and return the path.
 *
 * `names` is what {@link generateIcons} wrote, `manifest` the icons array the web manifest will
 * carry for this set — shown as real JSON, because "what ends up in manifest.json" is a thing
 * the dev otherwise has to build and curl for.
 */
export function writeIconPreview({ dest, dirAbs, names, manifest, meta }) {
  const src = (name) => dataUri(path.join(dirAbs, name))
  const has = (name) => names.includes(name)
  //Both rings are DERIVED from what this run actually used, never hardcoded: a sheet that draws
  //the default margin next to art generated with `--margin 25` would be showing a gap that
  //isn't there.
  const ring = Math.round(TILE_PX * meta.safeZone)
  const put = Math.round(TILE_PX * meta.artTarget)
  /**
   * One tile: the STATE it shows, and the FILE that produces it.
   *
   * Both, always. Organising the sheet by state is what makes it answer "how will this look",
   * but every state is rendered from one generated file — so the caption names the state and
   * the line under it names the file. Either alone leaves a question open: a filename does not
   * say where it is used, and a state does not say what to re-draw when it looks wrong.
   * @param {string} name
   * @param {string} state
   * @param {{ cls?: string, backdrop?: string, note?: string }} [opts]
   */
  const screen = (name, state, { cls = "", backdrop, note } = {}) =>
    has(name)
      ? `<figure class="tile ${cls}">
           <div class="art"${backdrop ? ` style="background:${backdrop};background-image:none"` : ""}>
             <img src="${src(name)}" alt="">
           </div>
           <figcaption>${state}<span>${name}</span>${note ? `<em>${note}</em>` : ""}</figcaption>
         </figure>`
      : ""

  /** The tinted mock: the greyscale ramp multiplied by a tint, the way iOS maps it. */
  const tinted = (name) =>
    has(name)
      ? `<figure class="tile ios">
           <div class="art tint" style="background:${TINT}">
             <img src="${src(name)}" alt="">
           </div>
           <figcaption>tinted<span>${name}</span><em>the user picks the colour</em></figcaption>
         </figure>`
      : ""

  /**
   * The themed mock. Android tints the monochrome layer with `SRC_IN` — it keeps the alpha and
   * throws the colour away — so the tile is a block of the launcher's ink MASKED by the file,
   * which is the same operation. Showing the file itself would show a white-on-white square.
   */
  const themed = ({ label, bg, ink }) =>
    has("icon-monochrome.png")
      ? `<figure class="tile safe">
           <div class="art themed squircle" style="background:${bg};--m:url(${src("icon-monochrome.png")})">
             <i style="background:${ink}"></i>
           </div>
           <figcaption>${label}<span>icon-monochrome.png</span><em>the wallpaper picks both colours</em></figcaption>
         </figure>`
      : ""

  // The Android tile has to be BUILT rather than shown: a launcher composites the transparent
  // foreground over `ic_launcher_background` and masks the pair, so a preview that just displays
  // `icon-maskable.png` shows a floating mark and proves nothing about the mask.
  const adaptive = (state, cls) =>
    has("icon-maskable.png")
      ? `<figure class="tile safe">
           <div class="art adaptive ${cls}" style="background:${escapeHtml(meta.background)}">
             <img src="${src("icon-maskable.png")}" alt="">
           </div>
           <figcaption>${state}<span>icon-maskable.png + ${escapeHtml(meta.background)}</span></figcaption>
         </figure>`
      : ""

  writeFileSync(
    dest,
    `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>adaptv icons</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#101014; --dim:#6b6b76; --line:#e4e4e9; --card:#fafafb; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d0d10; --fg:#f2f2f5; --dim:#8e8e9a; --line:#26262e; --card:#15151a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 32px 80px; background:var(--bg); color:var(--fg);
         font:15px/1.5 ui-sans-serif,-apple-system,"Segoe UI",sans-serif; }
  h1 { font-size:19px; margin:0 0 4px; font-weight:600; }
  .sub { color:var(--dim); font-size:13px; margin:0 0 8px; }
  h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
       color:var(--dim); margin:44px 0 6px; }
  .note { color:var(--dim); font-size:13px; margin:0 0 18px; max-width:64ch; }
  .row { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
  .tile { margin:0; width:132px; }
  .tile .art { width:132px; height:132px; display:grid; place-items:center; overflow:hidden;
    border:1px solid var(--line); border-radius:14px; background:var(--card);
    /* a checkerboard, so a transparent asset is visibly transparent rather than white-on-white */
    background-image:
      linear-gradient(45deg,var(--line) 25%,transparent 25%,transparent 75%,var(--line) 75%),
      linear-gradient(45deg,var(--line) 25%,transparent 25%,transparent 75%,var(--line) 75%);
    background-size:16px 16px; background-position:0 0,8px 8px; }
  .tile img { width:100%; height:100%; object-fit:contain; display:block; }
  figcaption { font-size:12px; color:var(--fg); margin-top:8px; }
  figcaption span { display:block; color:var(--dim); font-size:11px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  figcaption em { display:block; color:var(--dim); font-size:11px; font-style:normal; opacity:.75; }
  /* The masks each platform actually applies. Each matches the .art element itself AND an
     ancestor carrying the class, because a composited tile puts the shape on the layer stack
     while a plain one puts it on the figure. */
  .ios .art,  .art.ios       { border-radius:29px; }  /* iOS superellipse, approximated */
  .circle .art, .art.circle  { border-radius:50%; }
  .squircle .art, .art.squircle { border-radius:34px; }
  .rounded .art, .art.rounded { border-radius:18px; }
  /* the composited adaptive pair: brand colour behind, transparent foreground on top */
  .art.adaptive { background-image:none; border:0; position:relative; }
  .art.adaptive img { width:100%; height:100%; }
  /* iOS tints by mapping the greyscale ramp onto the chosen colour — multiply is the closest
     one-line stand-in, and it is honest about the direction: dark stays dark. */
  .art.tint { border:0; }
  .art.tint img { mix-blend-mode:multiply; }
  /* Android's themed layer: a block of the launcher's ink, masked by the file's alpha. That IS
     the SRC_IN tint the launcher does, rather than a stand-in for it. */
  .art.themed { background-image:none; border:0; }
  .art.themed i { display:block; width:100%; height:100%;
    -webkit-mask-image:var(--m); mask-image:var(--m);
    -webkit-mask-size:contain; mask-size:contain;
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-position:center; mask-position:center; }
  /* Two rings, and the gap between them is the whole point.
     · outer, dashed — the 72/108 safe zone: the launcher may cut anything past it
     · inner, dotted — where this run actually put the art (a --margin short of the limit)
     NB: no backticks anywhere below this line — the whole document is a template literal, and
     one inside a CSS comment closes it and turns the rest of the sheet into broken JS. */
  .safe .art { position:relative; }
  .safe .art::after, .safe .art::before { content:""; position:absolute; inset:0;
    margin:auto; border-radius:50%; pointer-events:none; }
  .safe .art::after  { width:${ring}px; height:${ring}px; border:1px dashed #e0483c; opacity:.8; }
  .safe .art::before { width:${put}px; height:${put}px; border:1px dotted #4caf82; opacity:.7; }
  .rings { display:flex; flex-wrap:wrap; gap:18px; margin:14px 0 18px; font-size:12px; color:var(--dim); }
  .rings span { display:flex; align-items:center; gap:6px; }
  .rings i { width:14px; height:0; display:inline-block; }
  .rings .lim { border-top:1px dashed #e0483c; }
  .rings .put { border-top:1px dotted #4caf82; }
  .actual { display:flex; flex-wrap:wrap; gap:20px; align-items:flex-end; padding:16px 20px;
    border:1px solid var(--line); border-radius:12px; background:var(--card); }
  .actual figure { margin:0; text-align:center; }
  .actual img { display:block; image-rendering:auto; margin:0 auto 6px; }
  .actual figcaption { font-size:11px; color:var(--dim); }
  pre { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px 18px; overflow:auto; font-size:12.5px; line-height:1.55;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
</style>

<h1>adaptv icons</h1>
<p class="sub">${escapeHtml(meta.dirRel)} · from ${escapeHtml(meta.sourceRel)} · --margin ${meta.margin}${meta.padding ? ` · --padding ${meta.padding}` : ""}</p>
<p class="note">Every tile below is composited the way the platform composites it — its mask, its
backdrop, its tint. Nothing here is the file on its own.</p>

<h2>iOS home screen</h2>
<p class="note">iOS 18 renders three different icons, and an app that ships no variants keeps its
light one in all three — which is why so many still don't change. The DARK tile is the variant
with no background of its own, on the near-black backdrop the system supplies. The TINTED one is
a greyscale ramp iOS maps the user's chosen colour onto; the blue here stands in for whatever
they pick.</p>
<div class="row">
  ${screen("icon.png", "light", { cls: "ios", backdrop: IOS_LIGHT })}
  ${screen("icon-dark.png", "dark", { cls: "ios", backdrop: IOS_DARK, note: "system backdrop" })}
  ${tinted("icon-tinted.png")}
</div>

<h2>Android home screen</h2>
<p class="note">The launcher composites the transparent foreground over the brand colour, then
masks the pair to whatever shape the device uses — so the same art has to survive all three.
adaptv measured where your logo ends and scaled it to sit inside both rings.</p>
<div class="rings">
  <span><i class="lim"></i>72/108 safe zone — a mask may cut past this</span>
  <span><i class="put"></i>where adaptv put the art (--margin ${meta.margin})</span>
</div>
<div class="row">
  ${adaptive("circle", "circle")}
  ${adaptive("squircle", "squircle")}
  ${adaptive("rounded square", "rounded")}
  ${screen("icon-maskable.png", "foreground alone", { cls: "safe" })}
  ${screen("icon.png", "legacy square", { cls: "rounded" })}
</div>

<h2>Android themed icons (13+)</h2>
<p class="note">When the home screen is themed, the launcher drops your colours entirely: it takes
the <code>monochrome</code> layer's transparency, fills it with an ink derived from the wallpaper,
and draws it on a matching background. An app that ships no such layer opts out and sits there in
full colour — the Android counterpart of an iOS icon with no dark variant. adaptv derives the layer
from your mark's luminance, keeping its internal contrast where there is any and falling back to a
flat silhouette where there isn't.</p>
<div class="row">
  ${ANDROID_THEMED.map(themed).join("\n  ")}
  ${screen("icon-monochrome.png", "the layer alone", { cls: "safe", backdrop: IOS_DARK, note: "white; the launcher supplies the ink" })}
</div>

<h2>Installed web app</h2>
<p class="note">What a browser is handed on install. The maskable pair is drawn edge-to-edge on
the brand colour with the mark inside the safe zone, so a launcher can cut it to any shape; the
<code>any</code> pair keeps its transparency.</p>
<div class="row">
  ${screen("android-chrome-192.png", "any · 192")}
  ${screen("android-chrome-512.png", "any · 512")}
  ${screen("android-maskable-192.png", "maskable · 192", { cls: "circle" })}
  ${screen("android-maskable-512.png", "maskable · 512", { cls: "circle" })}
  ${screen("apple-touch-icon-180.png", "apple touch icon", { cls: "ios" })}
</div>
<pre>${escapeHtml(JSON.stringify({ icons: manifest }, null, 2))}</pre>

<h2>Browser tab, at the size it is drawn</h2>
<p class="note">Not scaled up — this is what a tab actually shows. If the mark is a smudge here it
needs a simpler silhouette at small sizes, not more pixels.</p>
<div class="actual">
  ${actual("favicon-16x16.png", 16, has, src)}
  ${actual("favicon-32x32.png", 32, has, src)}
  ${actual("favicon-96x96.png", 96, has, src)}
  ${actual("favicon.ico", 48, has, src)}
  ${actual("icon.svg", 64, has, src)}
</div>
`,
  )
  return dest
}

const actual = (name, px, has, src) =>
  has(name)
    ? `<figure><img src="${src(name)}" width="${px}" height="${px}" alt=""><figcaption>${name}</figcaption></figure>`
    : ""

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
  )
