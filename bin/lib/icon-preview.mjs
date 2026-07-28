// The `--preview` contact sheet: every generated icon, under the masks that will actually be
// applied to it.
//
// A terminal cannot show the one thing the dev needs to check. `gen icons` makes decisions
// they can only judge by eye — is the mark still legible inside the Android safe zone, does the
// logo survive being cut to a circle, is the 16px favicon a smudge — and the alternative to
// showing them is a build, an install, and a look at a home screen. So the whole set is written
// to ONE self-contained HTML file: no server, no upload, no assets to resolve. Every image is
// inlined as a data URI, which is why it can live in `.adaptv/` (gitignored, disposable) and
// still be opened straight from disk weeks later.
//
// Written on EVERY run, not behind a flag. It is the only place a dev can see what the warnings
// describe — a mark cropped by Android's circle, a favicon that turns to mush at 16px, the gap
// `--margin` actually bought them — and it costs one file in a directory adaptv already owns and
// gitignores. Behind a flag it was a review step only someone who already knew to look would find.
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

/** The tile size every mock is drawn at — the rings are computed from it. */
const TILE_PX = 132

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

  const tile = (name, label, cls = "") =>
    has(name)
      ? `<figure class="tile ${cls}"><div class="art"><img src="${src(name)}" alt=""></div><figcaption>${label}<span>${name}</span></figcaption></figure>`
      : ""

  // The Android tile is the one that has to be BUILT rather than shown: a launcher composites
  // the transparent foreground over `ic_launcher_background` and masks the pair, so a preview
  // that just displays `icon-maskable.png` shows a floating mark and proves nothing about the
  // mask. Same two layers, same order, clipped by the shape under test.
  const adaptive = (label, cls) =>
    has("icon-maskable.png")
      ? `<figure class="tile safe"><div class="art adaptive ${cls}" style="background:${escapeHtml(meta.background)}"><img src="${src("icon-maskable.png")}" alt=""></div><figcaption>${label}<span>foreground + background</span></figcaption></figure>`
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
  .sub { color:var(--dim); font-size:13px; margin:0 0 40px; }
  h2 { font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
       color:var(--dim); margin:44px 0 6px; }
  .note { color:var(--dim); font-size:13px; margin:0 0 18px; max-width:62ch; }
  .row { display:flex; flex-wrap:wrap; gap:22px; align-items:flex-start; }
  .tile { margin:0; width:132px; }
  .tile .art { width:132px; height:132px; display:grid; place-items:center; overflow:hidden;
    border:1px solid var(--line); border-radius:14px; background:var(--card);
    /* a checkerboard, so a transparent icon is visibly transparent rather than white-on-white */
    background-image:
      linear-gradient(45deg,var(--line) 25%,transparent 25%,transparent 75%,var(--line) 75%),
      linear-gradient(45deg,var(--line) 25%,transparent 25%,transparent 75%,var(--line) 75%);
    background-size:16px 16px; background-position:0 0,8px 8px; }
  .tile img { width:100%; height:100%; object-fit:contain; display:block; }
  figcaption { font-size:12px; color:var(--fg); margin-top:8px; }
  figcaption span { display:block; color:var(--dim); font-size:11px;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; word-break:break-all; }
  /* The masks each platform actually applies. Each matches the .art element itself AND an
     ancestor carrying the class, because a composited tile puts the shape on the layer stack
     while a plain one puts it on the figure. */
  .ios .art,  .art.ios       { border-radius:29px; }  /* iOS superellipse, approximated */
  .circle .art, .art.circle  { border-radius:50%; }
  .squircle .art, .art.squircle { border-radius:34px; }
  .rounded .art, .art.rounded { border-radius:18px; }
  .mask .art { background-image:none; border-color:transparent; }
  /* the composited adaptive pair: brand colour behind, transparent foreground on top */
  .art.adaptive { background-image:none; border:0; position:relative; }
  .art.adaptive img { width:100%; height:100%; }
  /* Two rings, and the gap between them is the whole point.
     · outer, dashed — the 72/108 safe zone: the launcher may cut anything past it
     · inner, dotted — where this run actually put the art (a --margin short of the limit),
       so the icon sits inside its tile instead of flush against the mask
     NB: no backticks anywhere below this line — the whole document is a template literal, and
     one inside a CSS comment closes it and turns the rest of the sheet into broken JS. */
  .safe .art { position:relative; }
  .safe .art::after, .safe .art::before { content:""; position:absolute; inset:0;
    margin:auto; border-radius:50%; pointer-events:none; }
  .safe .art::after  { width:${ring}px; height:${ring}px; border:1px dashed #e0483c; opacity:.8; }
  .safe .art::before { width:${put}px; height:${put}px; border:1px dotted #4caf82; opacity:.7; }
  .rings { display:flex; gap:18px; margin:14px 0 0; font-size:12px; color:var(--dim); }
  .rings span { display:flex; align-items:center; gap:6px; }
  .rings i { width:14px; height:0; display:inline-block; }
  .rings .lim { border-top:1px dashed #e0483c; }
  .rings .put { border-top:1px dotted #4caf82; }
  .actual { display:flex; gap:20px; align-items:flex-end; padding:16px 20px;
    border:1px solid var(--line); border-radius:12px; background:var(--card); }
  .actual figure { margin:0; text-align:center; }
  .actual img { display:block; image-rendering:auto; margin:0 auto 6px; }
  .actual figcaption { font-size:11px; color:var(--dim); }
  pre { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px 18px; overflow:auto; font-size:12.5px; line-height:1.55;
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
</style>

<h1>adaptv icons</h1>
<p class="sub">${escapeHtml(meta.dirRel)} · generated from ${escapeHtml(meta.sourceRel)}${meta.padding ? ` · padding ${meta.padding}%` : ""}</p>

<h2>iOS home screen</h2>
<p class="note">Flattened onto the brand colour and stripped of its alpha channel — App Store
Connect rejects an icon that merely has one. iOS never masks, so this art is full-bleed.</p>
<div class="row">
  ${tile("icon.png", "app icon", "ios mask")}
  ${tile("apple-touch-icon-180.png", "touch icon", "ios mask")}
</div>

<h2>Android adaptive icon</h2>
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
  ${tile("icon-maskable.png", "foreground alone", "safe")}
</div>

<h2>Web manifest</h2>
<p class="note">What a browser is handed on install. The maskable pair is drawn edge-to-edge on
the brand colour with the mark inside the safe zone; the <code>any</code> pair keeps its
transparency.</p>
<div class="row">
  ${tile("android-chrome-192.png", "any · 192")}
  ${tile("android-chrome-512.png", "any · 512")}
  ${tile("android-maskable-192.png", "maskable · 192", "circle")}
  ${tile("android-maskable-512.png", "maskable · 512", "circle")}
</div>
<pre>${escapeHtml(JSON.stringify({ icons: manifest }, null, 2))}</pre>

<h2>Favicons, at the size they are drawn</h2>
<p class="note">Not scaled up — this is what a browser tab actually shows. If the mark is a
smudge here, it needs a simpler silhouette at small sizes, not more pixels.</p>
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
