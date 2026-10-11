# adaptv — `Image`: the component, and the build-time placeholder pipeline

> **Layout shift is a named enemy. `Image` is where it is fought.** This document specifies the
> component, the build-time LQIP pipeline behind it, and the parts of the brief that are wrong.
>
> Read at adaptv `da36bd1ac440e0a2d808d6bead69d16f8a2d5bb6` (worktree
> `worktree/ionic-expo-components-research-2aff9c`, `src/components/image.tsx` with uncommitted
> edits). Next.js source pinned at `vercel/next.js@39db24a48bbbd0bdd6acb5d15d43ed6f14639068`.
> **Status: implemented 2026-07-30.** The component, the plugin and the tests exist; blocks marked
> ⟨amended 2026-07-30⟩ or ⟨new⟩ record where building it changed the design, and §12 carries the
> per-file state including the two pieces left unwired. Sections written in the present tense about
> *"the existing component"* (§1 corrections 2–5) describe the code as it was before this pass and
> are kept as the argument for the change, not as a description of `image.tsx` today.
>
> Browser-support facts are from **MDN BCD `main`, read 2026-07-29**, and specifically from the
> `webview_ios` / `webview_android` columns — never `safari_ios` / `chrome_android`, per the rule
> [`docs/design/performance-boost.md`](../design/performance-boost.md) established. WebKit behaviour is cited to
> `bugs.webkit.org` numbers and to WebKit source, not to blog posts. Byte measurements labelled
> *(measured)* were produced during this research on macOS arm64 with `sharp@0.35.3`,
> `blurhash@2.0.5`, `thumbhash@0.1.1`, esbuild `--minify --bundle`, `gzip -9`; they are reproducible
> and are flagged so they can be re-run rather than trusted.

---

## 0. The verdict

| # | Question | Verdict | One-line reason |
|---|---|---|---|
| 1 | Reserve the box from `width`/`height` | **BUILD — and make it unconditional** | Today it is conditional (§1 correction 2), which is the exact failure the owner's test names. |
| 2 | Build-time LQIP for statically-imported images | **BUILD** — but see 3 | ~150 lines against a `sharp` we already ship; nobody else has standardised it (§4.4). |
| 3 | Is LQIP the point of the build-time pipeline? | **NO. Reframe.** | The valuable output of static-import detection is **`width` and `height`**, not the blur. The blur is worth perhaps a tenth of it (§1 correction 1). |
| 4 | BlurHash / ThumbHash as the placeholder encoding | **REJECT** | Both need a JS decoder (1.0 / 1.2 kB gzip) and **cannot paint before hydration**. They are database formats. (§3) |
| 5 | Encoding to use instead | **16 px WebP `data:` URL, blur baked in at build** | ~136–172 B *(measured)*, zero JS, paints in the first frame, native decode in both WebViews. (§3) |
| 6 | Next.js's SVG `feGaussianBlur` wrapper | **DO NOT PORT** | Next needs it only because it paints the placeholder onto the `<img>` itself. adaptv already has a separate layer, so the hack has no job here. (§3.4) |
| 7 | Depend on `vite-imagetools` / `vite-plugin-lqip` | **NO — own it** | The `?inline` primitive is 3 lines; the LQIP ergonomics have been an open gap upstream for 5 years, and adaptv needs `width`/`height` on its own type anyway. (§4.4) |
| 8 | `decoding="async"` in default output | **DO NOT EMIT** | Verified in WebKit source to be a no-op for the case that matters. Emitting it would be a mitigation that silently does nothing — the owner's exact test. (§5.3) |
| 9 | `loading="lazy"` by default | **YES**, iOS 15.4+ | With one **locked invariant**: the `<img>`'s `src` is never a placeholder that is later swapped (WebKit 237703). (§5.2) |
| 10 | `fetchpriority` via a `priority` prop | **YES** | Honoured from iOS 17.2, inert and harmless below. (§5.4) |
| 11 | `contain-intrinsic-size` / `content-visibility` | **NOT YET** | iOS 17 / iOS 18 respectively. Not a baseline tool while adaptv supports iOS 15–16. (§5.5) |
| 12 | Anything in the `ui: {}` config block | **NO** | `ui: {}` has a *mechanism* — resolved pre-paint into an `<html>` attribute. A build-time pipeline cannot participate in it. (§8) |
| 13 | Can adaptv measure CLS on iOS? | **NO — and this is load-bearing** | The Layout Instability API is Chromium-only and WebKit has shown no sign of shipping it. Any CLS gate adaptv ships is Android-only. (§10) |
| 14 | `render` prop on `Image` | **NO** | §3.3 exists for composition; an `<img>` has no useful alternate host element. Named so the omission is a decision. (§7.5) |
| 15 | Does `<Image>` throw in dev when it can reserve no box? | **NO — it does not COMPILE** ⟨amended 2026-07-30⟩ | A four-branch union on the sizing props makes the un-reservable call a type error. The runtime check survives, demoted to a backstop for callers who escape the types. (§11) |
| 16 | `fit` / `position` | **PROPS, in `lockedStyle` on both layers** ⟨amended 2026-07-30⟩ | The placeholder's `background-size`/`-position` must equal the `<img>`'s `object-fit`/`-position` or the blur→image swap jumps, and adaptv cannot read a class name off the `<img>`. (§7.1) |
| 17 | Plugin enforcement | **`enforce: "pre"`, and it is load-bearing** ⟨found in implementation⟩ | Vite's own asset plugin claims any unknown query on a known image extension first, silently resolving the import to a bare URL string with no dimensions. (§4.2a) |

**§11 is decided, and it is decided differently from the way this document originally framed it.**
The question was *"does `<Image>` throw in dev when it cannot reserve a box"*, and the answer is that
it should not need to — the un-reservable call is a **compile** error instead. That is `VISION.md`
principle 1 (the wrong thing becomes impossible) beating a runtime warning, and it is strictly
stronger than option A: a throw can be scrolled past, commented out, or reached only on a code path
nobody exercised in dev. A type error cannot be any of those things. The rest of this document is
amended accordingly; the original three options and their analysis are kept in §11 because the
reasoning that rejected B and C is what rules out weakening the union later.

---

## 1. Corrections to the brief

**1. "Generate a tiny blurred placeholder" is the small half of the feature. The big half is
`width` and `height`, and the brief does not mention it.**

The brief asks for build-time recognition of static images so a *blur* can be generated. The same
recognition yields the image's intrinsic dimensions — and dimensions are the entire CLS mechanism,
while the blur is decoration. Next.js's loader returns both from one call:

```ts
JSON.stringify({ src: outputPath, height, width, blurDataURL, blurWidth, blurHeight })
```
— [`next-image-loader/index.ts#L31-L91`](https://github.com/vercel/next.js/blob/39db24a48bbbd0bdd6acb5d15d43ed6f14639068/packages/next/src/build/webpack/loaders/next-image-loader/index.ts#L31-L91)

Framed as "a blur pipeline", the feature is a nice-to-have whose absence costs nothing. Framed as
"static imports carry their own dimensions", it is the one mechanism that makes the ergonomic path
(`<Image src={hero} />`, no props) the correct path — doctrine principle 1. **The rest of this
document treats dimensions as the product and the blur as a by-product.**

**2. `src/components/image.tsx` is not "a `useImage` hook, not a component".** It already ships a
compound `Image` with exactly the three slots the brief specifies (`Image.Placeholder`,
`Image.Error`, `Image.Invalid`), a layout anchor deriving `aspect-ratio` from `width`/`height`, and
a correct `mergeStyles` locked/base split on every layer. `useImage()` is a *context reader* for
slot authors, not a loading hook. So this is an **evolution**, not a replacement, and the migration
in §12 is short.

**3. But the existing component has the defect the owner's test is designed to catch.** Line 442:

```ts
const needsCompositionShell = Boolean(children) || width != null || height != null
```

and line 518, `if (!needsCompositionShell) return imgNode`. So:

| Call | Reserved? |
|---|---|
| `<Image src={url} width={640} height={400} />` | ✅ |
| `<Image src={url}><Image.Placeholder /></Image>` | ⚠️ shell exists, **no ratio** — `aspectRatio` is `undefined` without both dims |
| `<Image src={url} />` | ❌ **bare `<img>`, no reservation at all** |
| `<Image src={url} className="h-48 w-full" />` | ❌ same — and it *looks* fine, because the consumer's own classes happen to size it |

The third row is a component that reduces layout shift in one case and silently does not in the
others. That is the reverted `border-transparent` failure with a different name, and it is the most
important thing this document changes.

**4. `isLoadableImageSrc` is a second instance of the same failure.** Lines 109–148 classify a
`src` string as loadable via three regexes, one of which is
`/^[^\s#?]+(?:\/[^\s#?]+)+$|^[^\s#?]+\.[^\s#?]+$/`. That matches `not.a.url`, `README.md` and
`a/b`, and rejects a legitimate `?query`-only relative reference. A heuristic that guesses which
strings are fetchable is a mitigation that works in the cases you thought of. §6.3 replaces it with
three facts the runtime actually knows.

**5. The reference component's `size-full object-cover` on the root is not portable as-is.**
`size-full` means the root fills its parent — i.e. **the parent owns the reservation**, which is
precisely the arrangement adaptv is trying to eliminate. The three-slot *anatomy* is right and is
adopted; the root's sizing is not (§7.2).

---

## 2. What actually reserves a box, and where each mechanism fails

Do not reason about this from memory. The mechanism is a **presentational hint**, not a UA
stylesheet rule, and that distinction decides who can override it.

### 2.1 The `width`/`height` attributes

WHATWG HTML Rendering §15.2 defines the mapping: when both attributes are present and both parse as
non-negative integers, the UA is expected to use them as a presentational hint for `aspect-ratio`
of the form `auto w / h` —
[html.spec.whatwg.org/multipage/rendering.html](https://html.spec.whatwg.org/multipage/rendering.html#the-css-user-agent-style-sheet-and-presentational-hints).
Author-facing constraints (values are CSS pixels; the pair must match the true ratio within 0.5;
"not intended to be used to stretch the image") are in §4.8.17 "Dimension attributes" —
[embedded-content-other.html](https://html.spec.whatwg.org/multipage/embedded-content-other.html#dimension-attributes).
The change landed via [whatwg/html#6032](https://github.com/whatwg/html/pull/6032).

**No shipping engine implements it as `aspect-ratio: attr(width) / attr(height)` in a UA
stylesheet** — a claim that circulates widely, from a since-deleted MDN page. Chromium's
`html.css` contains no `aspect-ratio` rule at all
([source](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/html/resources/html.css));
the blink-dev Intent describes C++ that *mimics* what such a rule would do
([Intent to Implement](https://groups.google.com/a/chromium.org/g/blink-dev/c/hbhKRuBzZ4o), shipped
Chrome 79). Firefox implemented it as an internal property mapped in `nsImageFrame`
([bug 1547231](https://bugzilla.mozilla.org/show_bug.cgi?id=1547231), default-on in Firefox 71).
WebKit shipped it in **Safari 14** ([WebKit blog](https://webkit.org/blog/11340/new-webkit-features-in-safari-14/)).

Cascade position matters: presentational hints enter "between the regular user origin and the
author origin" and **are overridden by author-origin styles**
([css-cascade-5 §preshint](https://drafts.csswg.org/css-cascade-5/#preshint)). So any author
`aspect-ratio` on `img` beats the attributes.

**Failure cases, enumerated:**

| # | Case | Result |
|---|---|---|
| a | `width:100%; height:auto` in CSS | ✅ works — one dimension auto |
| b | CSS sets **both** width and height | ❌ ratio ignored: "When both the height and width … are explicitly set, the `aspect-ratio` property value is ignored" — [MDN, Understanding aspect-ratio](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_box_sizing/Understanding_aspect-ratio) |
| c | Only one attribute, or either fails integer parsing (`width="100%"`, `width=""`) | ❌ no hint at all |
| d | `height:auto` clobbered downstream — `h-full`, a fixed-height flex/grid parent | ❌ degenerates to (b) |
| e | Author CSS declares `aspect-ratio` on `img` | ❌ overrides the hint |
| f | Attribute ratio ≠ real ratio | ⚠️ wrong box, then **shifts on load** — the `auto` keyword lets the natural ratio replace it |
| g | `<picture>` art direction with per-breakpoint ratios | ❌ unless `width`/`height` are on `<source>`: Chrome 90, Firefox 108, **Safari / WebView-iOS 15** |
| h | No `src` yet, or a placeholder `src` swapped later | ❌ in WebKit until 2021 — the element was treated as an error image and the mapping was skipped. [WebKit bug 224197](https://bugs.webkit.org/show_bug.cgi?id=224197), fixed r276521 (2021-05-03), first in STP 125 |

Case **(d)** is the one a Tailwind-based framework will hit constantly, and case **(b)** is the one
a consumer causes by accident with two utility classes.

### 2.2 CSS `aspect-ratio`

MDN BCD `css/properties/aspect-ratio.json`: Chrome 88, Firefox 89, Safari 15, **Safari iOS 15,
WebView on iOS 15, WebView Android 88**. So `aspect-ratio` is available everywhere adaptv ships,
and — unlike the attribute hint — it is a real author-origin declaration adaptv can put in
`lockedStyle`, where a consumer cannot accidentally out-specify it.

### 2.3 `contain-intrinsic-size` / `content-visibility`

BCD, Safari column (which is what `webview_ios` mirrors):

| Property | Chrome | Firefox | Safari / WebView-iOS |
|---|---|---|---|
| `contain-intrinsic-size` | 83 | 107 | **17** |
| `content-visibility` | 85 | 125 | **18** ([WebKit, Safari 18 beta](https://webkit.org/blog/15443/news-from-wwdc24-webkit-in-safari-18-beta/)) |

**Verdict: neither is part of this design.** They are the right tools for long lists of off-screen
images and should be revisited when adaptv's iOS floor reaches 17. Using them today would mean a
mitigation that works on new iPhones and silently does not on iOS 15/16 — the rejected shape.

### 2.4 🔒 The decision: reserve twice, and prefer a wrong-but-stable box to a self-correcting one

adaptv emits **both**:

1. `width` / `height` **attributes on the `<img>`** — free, and they survive a stylesheet that
   fails to load;
2. an explicit **`aspect-ratio` in `lockedStyle` on the wrapper `<div>`** — an element adaptv owns
   entirely, so cases (b)–(e) above cannot reach it.

They cover each other's failure modes, which is why both are present rather than one.

The wrapper's `aspect-ratio` is a **plain ratio, not `auto w / h`**. That means if the declared
dimensions disagree with the file's real dimensions, the box does **not** silently resize when the
image decodes — the image is cropped or letterboxed by `object-fit` instead. This is a deliberate
trade: adaptv chooses a possibly-wrong box that never moves over a correct box that arrives late.
Case (f) is thereby converted from a layout shift into a visual crop, which is a design bug the
developer can see rather than a metric regression they cannot.

---

## 3. The placeholder encoding — BlurHash and ThumbHash are the wrong tool for the web

`expo-image` accepts BlurHash and ThumbHash strings, which is why the brief reaches for them.
The reason that works for Expo does not transfer.

### 3.1 The comparison

| | BlurHash 4×3 | ThumbHash | **16 px WebP data URL** | 20 px JPEG data URL | SQIP (SVG) |
|---|---|---|---|---|---|
| Encoded size | 28 B | 21 B (23 with alpha) | **136 B → 184 B base64** *(measured)* | 390 B → 520 B *(measured)* | ~800–1000 B |
| **JS decoder needed at runtime** | **yes** | **yes** | **no** | **no** | no |
| Decoder size, tree-shaken, gzip | **1001 B** *(measured)* | **1242 B** *(measured)* | 0 | 0 | 0 |
| Earliest possible paint | after hydration | after hydration | **first paint** | **first paint** | first paint |
| Alpha | ✗ | ✓ | ✓ | ✗ | partial |
| Aspect ratio encoded | ✗ | ✓ | inherent | inherent | inherent |

BlurHash string length follows `6 + 2(nx·ny − 1)`
([Algorithm.md](https://github.com/woltapp/blurhash/blob/master/Algorithm.md)); 4×3 = 28 chars,
confirmed empirically.

### 3.2 The byte argument is a trap, and the crossover is measurable

Base64 of already-compressed binary barely gzips (232 B → 222 B). Across 40 *distinct* images
concatenated and gzipped *(measured)*: 40 WebP data URLs = **4376 B**, 40 BlurHash strings =
**967 B**, 40 ThumbHash = **869 B** — about 85–88 gzipped bytes saved per image. Against a 1001 B
(BlurHash) or 1242 B (ThumbHash) decoder, **break-even is ~12 and ~14 images per payload**. Below
that the hash is a net byte *loss*; above it, the saving is bought with a placeholder that cannot
exist until the bundle has downloaded, parsed and run.

### 3.3 Why the hashes exist at all — and why the reason doesn't apply here

BlurHash's README motivates the format on **storage**: a string short enough to live in a JSON field
or a database column, so nobody has to cram thumbnails into their data model. It makes no claim of a
render-time or decode-time advantage. Wolt's context is native apps, where the decoder is compiled
into the binary and costs zero incremental bytes.

That is exactly `expo-image`'s situation and exactly not adaptv's. Expo decodes natively —
`packages/expo-image/ios/Utils/Blurhash.swift`, `ios/Utils/Thumbhash.swift`,
`android/.../blurhash/BlurhashDecoder.kt`. Its **web** path is the honest tell: `useBlurhash.tsx`
runs `decode()` in a `useEffect`, allocates two `<canvas>` elements, `createImageData` →
`putImageData`, upscales 10× (its own comment blames a Chrome animation glitch), then `toBlob` →
`createObjectURL`. In a Capacitor WebView adaptv is on that path in every respect — the WebView is
a browser, not a Swift host.

Mux reached the same conclusion independently, noting that no client decodes these formats natively
and that the LQIP technique is preferable on the web despite being ~150 bytes larger
([mux.com](https://www.mux.com/blog/blurry-image-placeholders-on-the-web)).

> 🔒 **Decision: `placeholder` accepts a `data:image/*` URL and nothing else.** A BlurHash or
> ThumbHash string is rejected with a dev-time error that names the reason and points at the
> conversion. adaptv does **not** ship, lazily import, or recommend a hash decoder.
>
> The escape hatch, for a consumer whose backend already stores hashes, is to convert **on their
> server** to a data URL. Note what that costs: `thumbHashToDataURL` emits an *uncompressed* PNG —
> **4218 characters for 32 px** *(measured)*, 18× a 20 px WebP data URL. So the conversion is
> possible and is the wrong default, which is why it is documented rather than built in.

### 3.4 Format and blur: WebP, blurred at build, no runtime filter

Two findings decide this.

**AVIF is the wrong format at LQIP sizes.** *(measured)* At 16–32 px the AV1/HEIF container
overhead swamps the pixel data: rose 16 px → WebP 136 B, AVIF 353 B, JPEG 362 B. JPEG additionally
has a ~330 B floor from its quantization and Huffman tables regardless of dimensions. **WebP is the
correct raster LQIP format**, and it is safe on both targets (WKWebView from iOS 14; Android
System WebView universally).

**Next's SVG `feGaussianBlur` wrapper should not be ported.** Next builds
`<svg><filter id='b'><feGaussianBlur stdDeviation='20'/><feColorMatrix …/><feFlood/><feComposite
operator='out'/><feComposite in2='SourceGraphic'/><feGaussianBlur stdDeviation='20'/></filter>
<image href='${blurDataURL}'/></svg>` and sets it as a **`background-image` on the `<img>` element
itself** —
[`image-blur-svg.ts#L19-L33`](https://github.com/vercel/next.js/blob/39db24a48bbbd0bdd6acb5d15d43ed6f14639068/packages/next/src/shared/lib/image-blur-svg.ts#L19-L33)
and
[`get-img-props.ts#L702-L731`](https://github.com/vercel/next.js/blob/39db24a48bbbd0bdd6acb5d15d43ed6f14639068/packages/next/src/shared/lib/get-img-props.ts#L702-L731).
Both halves of that design are forced by the same choice: because the background is on the `<img>`,
a CSS `filter` would blur the decoded photo too, so the blur has to live *inside* the `url()`; and
because a Gaussian blur of an 8 px raster feathers its alpha at the edges, the
`feColorMatrix`→`feFlood`→`feComposite` chain exists to rebuild an opaque backdrop
([PR #52583](https://github.com/vercel/next.js/pull/52583), earlier
[#39785](https://github.com/vercel/next.js/pull/39785)). The `blurWidth * 40` viewBox exists to make
`stdDeviation=20` resolution-independent.

**adaptv already paints the placeholder on a separate layer**, so none of that applies. Baking the
blur into the WebP at build time (`sharp.blur(σ)`) costs nothing at runtime, needs no filter graph,
creates no compositing layer, and sidesteps two live Next issues —
[#86264](https://github.com/vercel/next.js/issues/86264) (the filter chain rasterises very slowly
in Gecko) and [#53329](https://github.com/vercel/next.js/issues/53329) (placeholder still visible
after load). The browser's bilinear upscale from 16 px does the rest of the smoothing for free.

Avoiding a runtime `filter: blur()` is also consistent with
[`docs/design/performance-boost.md §4.1`](../design/performance-boost.md): `filter` promotes an element and makes it a
containing block, and one per on-screen image on a 4 GB Android is not free.

---

## 4. The build-time pipeline

### 4.1 What the plugin can and cannot see

adaptv already owns the consumer's Vite plugin (`src/vite/adaptv-plugin.ts`, one `adaptv()` call in
`vite.config.ts`) and already depends on `sharp@0.35.3` — used today only by the CLI's launcher-icon
generator, lazily (`bin/lib/icons.mjs`, `loadSharp()`). So the vehicle and the encoder both exist.

What a Vite plugin sees is **module ids**, in `resolveId` / `load` / `transform`. It therefore sees:

- ✅ `import hero from "./hero.jpg"` — a resolvable file path, at build **and** in dev.
- ✅ the file's bytes, hence its true dimensions and its pixels.
- ❌ `<Image src={someVariable} />` — no. Resolving that would mean data-flow analysis over the
  consumer's source, and acting on the result would mean rewriting it. Both are banned by
  [`VISION.md §2`](../VISION.md) principles 3 and 4.
- ❌ any URL not present in the source: an API response, a CDN path, a template string.

**This is the reach limit, and it is the design's central honesty problem.** Everything the pipeline
produces exists only for images the developer wrote as a literal import.

### 4.2 🔒 The delivery mechanism: an explicit query, not a global type change

```ts
import hero from "./hero.jpg?adaptv-image"
// → { src: "/assets/hero.a1b2c3.jpg", width: 1920, height: 1080,
//     lqip: "data:image/webp;base64,UklGR…" }

<Image src={hero} alt="…" />   // reserved, blurred, lazy — with no props
```

Three candidates were weighed:

| Option | Assessment |
|---|---|
| **Change the meaning of every image import** (Next's model) | Highest ergonomics, and the reason Next gets `width`/`height` for free everywhere. But it silently redefines `import logo from "./logo.png"` app-wide: a plain `<img src={logo}>` then renders `src="[object Object]"`, and every CSS-in-JS / `url()` template-literal use breaks. adaptv is not a full-stack framework that owns the whole app's asset story; it is a component layer. **Rejected.** |
| **A `toString()`-carrying object** so both forms work | Clever, and it does survive `<img src={obj}>` and `` `url(${obj})` ``. But it breaks `JSON.stringify`, identity comparison, and honest typing, and the failure is invisible until it isn't. **Rejected** — the exact "works in one case" shape. |
| **An explicit `?adaptv-image` query** ✅ | No global behaviour change, follows the Vite convention (`?url`, `?raw`, `?inline`), namespaced so it cannot collide with `vite-imagetools` if a consumer also uses it. Costs: the developer must remember it. |

The cost of the chosen option is remembering, so remembering is made unnecessary by §11 rather than
by magic: an import the developer forgot to annotate is a plain `string`, and `<Image src={aString} />`
**does not compile**. The error names the query. That is [`VISION.md §2`](../VISION.md) principle 3
verbatim — *guardrails teach; they never mutate* — with the teaching moved from the console to the
type checker.

### 4.2a 🚨 The plugin must be `enforce: "pre"`, and nothing short of a real build proves it

*Found while implementing, not while researching. Verified by building the same source both ways.*

**Vite's own asset plugin claims any unknown query on a known image extension.** Registered at
normal enforcement, `adaptv:image` is asked *after* it, so:

```js
import hero from "./hero.jpg?adaptv-image"
// → console.log(`/assets/hero-D18UDLrP.jpg?adaptv-image`)     ← a STRING
```

The build **succeeds**. The asset is emitted and hashed correctly. The import resolves to a URL that
even looks plausible. And every dimension is gone, so every `<Image src={hero} />` in the app
silently reserves nothing — the exact failure this whole document exists to prevent, arriving
through the build layer rather than the component layer.

Two things follow, and the second is the more important:

1. `adaptvImagePlugin()` sets `enforce: "pre"`.
2. **The regression test has to be a real `vite build`.** A unit test on the `load` hook cannot see
   this, because in the broken configuration the hook is never called — there is nothing to assert
   on. `src/vite/adaptv-image.test.ts` therefore runs an actual build and asserts that `width:400`
   and a `data:image/webp` URL are present in the emitted chunk, and that no `?adaptv-image` query
   survives into it. It is the only test in the file that needs Vite at all, and it is the only one
   that would have caught this.

### 4.3 What it generates, what it costs, where it is cached

```
sharp(file)
  .rotate()                                   // honour EXIF before measuring
  .resize({ width: 16, height: 16, fit: "inside" })   // longest edge → 16 px
  .blur(1.2)                                  // baked; no runtime filter (§3.4)
  .webp({ quality: 50, smartSubsample: true })
  .toBuffer()
→ `data:image/webp;base64,${buf.toString("base64")}`
```

**Dimensions** come from `sharp(file).metadata()` in the same call — `width`, `height`, and
`orientation`, with EXIF rotation applied so a portrait photo tagged sideways does not reserve a
landscape box.

**Sizing rationale.** Next uses `BLUR_IMG_SIZE = 8` / `BLUR_QUALITY = 70`
([`blur.ts`](https://github.com/vercel/next.js/blob/39db24a48bbbd0bdd6acb5d15d43ed6f14639068/packages/next/src/build/webpack/loaders/next-image-loader/blur.ts#L1-L89))
but *preserves the source format*, so a JPEG source yields a 480–530 character data URL. Vercel's own
benchmark in [PR #92421](https://github.com/vercel/next.js/pull/92421) shows switching to WebP cuts
that by 33–76% at roughly neutral encode time — the PR is still open. adaptv should simply start
where Next is heading: **WebP always, 16 px, q50** ⇒ 136–172 B *(measured)*, i.e. smaller than
Next's 8 px output while carrying 4× the pixels.

**Per-image cost, measured on this implementation** *(macOS arm64, `sharp@0.35.3`, one warm process;
`metadata()` + the full encode chain above, per image)*:

| Source | Cost | Placeholder |
|---|---|---|
| 800 × 600 JPEG | **4.6 ms** | — |
| 1600 × 1200 photo-like gradient | **5.3 ms** | 84 B WebP → **135-character data URL** |
| 2000 × 1500 JPEG | **15.0 ms** | — |
| 4000 × 3000 JPEG | **53.9 ms** | — |

135 characters is inside the 136–172 B band §3.1 predicted, and the shape of the table is the point:
cost tracks the **source** decode, not the output, which is exactly why the cache key must be
derivable from `stat()` alone. A whole-build measurement on a one-image Vite app: **cold 61 ms, warm
7.7 ms** — the cache is doing what it exists to do.

Vercel's own benchmark measures **0.87–17.2 ms per image** across ten real files for the
resize+encode half alone; the numbers above include the decode, and the decode is what the 4000 px
row is made of. `vite-imagetools` demonstrates the failure that follows from ignoring this — it
hashes `await img.toBuffer()` *before* the cache lookup, i.e. a full decode+re-encode
on every hit; its
[discussion #816](https://github.com/JonasKruckenberg/imagetools/discussions/816) reports a
VitePress build going **3 s → 50 s with four images**, with rebuilds barely faster. *(Causal
attribution inferred from source, not benchmarked — mark unverified.)*

> 🔒 **Cache key: `size + mtimeMs + pipeline-version`, stored at
> `node_modules/.cache/adaptv/lqip/<key>.json`.** Never a hash of the decoded pixels. The
> pipeline-version component is what makes a change to the constants above invalidate every entry
> without a manual clean.

**Dev server.** Next refuses to pay this cost at all in webpack dev — it inlines a
`/_next/image?…&w=8&q=70` URL instead, with the comment that generating blurs "can delay starting
the dev server" (`blur.ts` L56-L65). adaptv does not need that dodge because the work is per-module
and lazy: the `load` hook fires only when the module is first requested, and the cache survives dev
restarts. **But concurrent transforms must be deduped** (a `Map<id, Promise>`), or an HMR storm
re-encodes the same file N times.

**Bundle cost.** The data URL is inlined into the JS module. That is the point — no request — but
Next issue [#54012](https://github.com/vercel/next.js/issues/54012) records the corollary: the
placeholder ships whether or not it is used, and is not tree-shaken away. adaptv's exposure is
smaller (opt-in per import, WebP-only), but the plugin should **warn once per image whose data URL
exceeds 1 kB**, which in practice means "this source is a giant PNG screenshot; the resize did not
help".

### 4.4 Depend or build?

The Vite ecosystem was surveyed. Summary of what exists:

| Package | State | Fit |
|---|---|---|
| **`vite-imagetools`** v10.0.1, 2026-06-15, ~300k/wk, MIT, actively maintained | `?w=16&blur=8&format=webp&inline&as=metadata` genuinely does this — the `inline` branch swaps `metadata.src` for a base64 data URL, verified in source. Caches to `node_modules/.cache/imagetools`. | The primitive works; the **LQIP ergonomics have been open for 5 years** ([issue #86](https://github.com/JonasKruckenberg/imagetools/issues/86), 2021-05-03, opened by the maintainer; [PR #662](https://github.com/JonasKruckenberg/imagetools/pull/662) unmerged since 2023-11). Live cache-hit correctness bugs (#904, #909). v10 requires Vite ≥ 7 / Node ≥ 22. |
| **`vite-plugin-lqip`** v0.0.5, 2024-02-16, 414/wk | Exactly this feature. But: unpublished HEAD; the documented `sharp.blur` option is never used (the code hardcodes `.blur(1.25)`); the data-URL MIME is derived from the *source* extension so a `.jpg` yields `data:image/jpeg` containing WebP bytes; **no caching at all**. | 📖 **Read, don't depend** — the [`docs/design/architecture.md §5.5`](../design/architecture.md) verdict. ~60 lines worth copying with the bugs fixed. |
| **`@responsive-image/vite-plugin`** v3.0.1, 2026-07-14 | Maintained, four LQIP strategies. | Brings its own runtime and component system — adopting its worldview to get 150 lines. |
| **`lqip-modern`** v2.2.1, 12 kB, sharp-based, 16×16 WebP | Correct algorithm, plain Node API, no Vite coupling. | The best "depend on the algorithm, own the plugin" middle path if the encode block is ever worth outsourcing. It is 6 lines. |

And the state of the art elsewhere: **Astro deliberately deferred placeholders**
([roadmap discussion #1031](https://github.com/withastro/roadmap/discussions/1031) lists them under
future work, no follow-up RFC exists); **SvelteKit's request is open and labelled `needs-decision`**
([sveltejs/kit#13523](https://github.com/sveltejs/kit/issues/13523)); **Nuxt's `placeholder` is a
second network request**, not an inlined data URL (it calls `$img()` and uses the resulting URL).

> 🔒 **Verdict: build it.** Not from NIH — [`docs/design/architecture.md §0.6`](../design/architecture.md) says rent the
> solved core — but because the thing to rent does not exist. Every candidate solves the *transform*
> (which is 6 lines of `sharp`) and none solves the *integration*, which is the part adaptv actually
> needs: an `AdaptvImageAsset` type whose `width`/`height` the `Image` component consumes, on
> adaptv's own cache key, with adaptv's own failure semantics (§4.5). Depending on `vite-imagetools`
> would add a 300 kB-class dependency and a Vite ≥ 7 / Node ≥ 22 floor to avoid writing a `sharp`
> pipeline adaptv already has the dependency for.
>
> `lqip-modern` remains the fallback if maintaining the encode block ever proves annoying.

### 4.5 🔒 Failure modes — and the rule that separates them

**A missing placeholder is cosmetic. A missing dimension is a layout shift. They must therefore
degrade differently, and the plugin must never conflate them.**

| Situation | `width`/`height` | `lqip` | Behaviour |
|---|---|---|---|
| Normal raster (jpg/png/webp/avif) | ✅ | ✅ | — |
| **SVG** | ✅ from the viewBox | ❌ | Silent. A vector has no meaningful LQIP; it also usually paints instantly. |
| **Animated GIF / APNG / animated WebP** | ✅ | ❌ | Silent, with the first frame *not* used. Next guards this with `!isAnimated(content)`; before [PR #54028](https://github.com/vercel/next.js/pull/54028) it inlined **the entire animated file** as the placeholder, which is the origin of issue #54012. |
| Source is already tiny (< 40 px on the long edge) | ✅ | ❌ | Skipped — the placeholder would be larger than the image. (Next warns at < 40×40.) |
| Encoded data URL > 1 kB | ✅ | ✅ + **build warning** | Names the file and its dimensions. |
| **`sharp` fails to load** | ❌ | ❌ | **Build error, not a warning.** Because `width`/`height` are gone, every `?adaptv-image` import would silently stop reserving. The message names the realistic cause (§4.6). |
| Corrupt / unreadable file | ❌ | ❌ | **Build error.** Same reasoning. |
| **Remote URL, known only at runtime** | n/a | n/a | The plugin never sees it. §6.1 and §11 own this case. |

Note the asymmetry: the two `❌ ❌` rows are the only build **errors**, and both are errors precisely
because the *dimensions* are missing. This is the rule stated as code: the pipeline may silently
decline to produce a placeholder; it may never silently decline to produce a reservation.

The CLI's `loadSharp()` returns `null` on failure and downgrades to one icon warning — correct
there, because a missing launcher icon is visible. It is the wrong policy here.

### 4.6 The `sharp` tax, stated honestly

`sharp` is already a `dependencies` entry, so this pipeline adds no new install cost. But taking it
from "a CLI lazy-import" to "on the critical path of every consumer's build" changes its risk
profile, and the facts should be written down:

- **~19 MB installed per platform** (sharp core ~0.96 MB + platform shim + libvips ~17 MB; Windows
  bundles libvips into the shim at ~18.3 MB). Prebuilt binaries cover every mainstream CI —
  GitHub Actions, Vercel and Netlify resolve `@img/sharp-linux-x64` with no configuration.
- **`sharp` is Apache-2.0; `@img/sharp-libvips-*` are LGPL-3.0-or-later.** Dynamically linked, so
  fine in practice, but a framework taking a hard dependency should record it. This is the
  `THIRD_PARTY_LICENSES` file [`docs/design/architecture.md §5.5`](../design/architecture.md) already says is owed.
- **pnpm + optional dependencies is the #1 field failure** — "Could not load the sharp module using
  the linux-x64 runtime", e.g. [vercel/vercel#11220](https://github.com/vercel/vercel/issues/11220).
  Since adaptv's own playground is a pnpm workspace, its consumers will hit this. The fix is a
  `pnpm.supportedArchitectures` block, and it belongs in the quickstart **and** in the §4.5 build
  error's text — an error that names its own fix is the difference between a support ticket and a
  30-second repair.
- **`sharp` must stay external to any bundle.** If the deferred `dist` cutover ever bundles
  `src/vite/`, `sharp` needs an `external` entry or the build breaks in a way that only reproduces
  on the consumer's machine.

---

## 5. The native tier — what changes inside a WebView

Everything above is the web answer. adaptv ships to WKWebView and Android System WebView. Five
things differ, and three of them change the design.

### 5.1 Android WebView is Chrome; iOS WebView is Safari — with one caveat each

Chromium's own docs state WebView's goal is to ship alongside Chrome for Android, and on most OS
versions that is a strict technical requirement
([web-platform-compatibility.md](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/web-platform-compatibility.md)).
From Android 10 it is a Play-Store-updatable Trichrome component, separate from Chrome. **No public
per-version WebView distribution data exists** — Google publishes OS distribution, not WebView
distribution — so "recent Chrome-equivalent wherever Play Services is alive, with a long tail
where it is not" is the honest assumption, and it is *unverified*.

BCD mirrors `webview_android` off `chrome_android` for every property in this document.

### 5.2 🔒 `loading="lazy"`: yes from iOS 15.4 — with one invariant

BCD `html/elements/img.json`: `loading` → Chrome 77, Firefox 75, **Safari 15.4**, with
`safari_ios` and `webview_ios` both `"mirror"` ⇒ **WebView on iOS 15.4**
([WebKit, Safari 15.4](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)).

⚠️ **Do not cite caniuse's 16.4** — [caniuse.com/loading-lazy-attr](https://caniuse.com/loading-lazy-attr)
covers images *and iframes*, and 16.4 is the iframe number.

It is genuinely on in WKWebView, not just in Safari — `UnifiedWebPreferences.yaml` sets
`LazyImageLoadingEnabled` `defaultValue: WebKit: true` (WebKit2 = the WKWebView embedder), while
WebKitLegacy stays `false`. And scroll containers are handled by design:
`LazyLoadImageObserver.cpp` constructs its IntersectionObserver with **`scrollMargin: "100%"`**,
which expands intermediate scroll containers' clip rects — so images inside a nested
`overflow:auto` scroller get one viewport of lead. There is no network-aware threshold as in
Chrome (1250 px on 4G, 2500 px on 3G-or-lower).

> 🔒 **Invariant, and it is why the design puts the placeholder on a separate layer rather than in
> the `<img>`'s `src`: the `<img>`'s `src` is only ever the final URL. adaptv never renders a
> placeholder into `src` and swaps it later.**
>
> [WebKit bug 237703](https://bugs.webkit.org/show_bug.cgi?id=237703) — "Native image Lazyloading
> sometimes does not load", fixed 2022-09-14
> ([254471@main](https://github.com/WebKit/WebKit/commit/0c40ba62b482511fe03646f1d4982efd727475dd))
> — is exactly this: with `loading="lazy"`, a `src` that starts as a data-URI placeholder and is
> later replaced keeps the old URL in `ImageLoader::updateFromElement()` and **never loads**.
> Removing `loading="lazy"` made it go away. It is live on any iOS 15.4–16.0 device. The
> ecosystem hit it too — WP Rocket fixed it by stripping the attribute
> ([#4961](https://github.com/wp-media/wp-rocket/issues/4961)).
>
> Also worth knowing: [bug 293532](https://bugs.webkit.org/show_bug.cgi?id=293532) (open,
> 2025-05-24) — inside `<picture>`, `<source>` candidates ignore `loading="lazy"` in Safari 18 and
> download eagerly, then again on approach. adaptv does not emit `<picture>` today; if it ever
> does, this is the bug to test first.

Corroborating signal: **Ionic is deleting `ion-img` over exactly this**
([PR #31254](https://github.com/ionic-team/ionic-framework/pull/31254), merged 2026-07-09 into
`major-9.0`) — the component existed only to lazy-load, which is now native. Note also that
`ion-img` takes only `src` and `alt` ([docs](https://ionicframework.com/docs/api/img)) — no
dimension passthrough at all, i.e. **CLS-prone by construction**. That is the gap adaptv's `Image`
exists to close, and it is worth saying so.

### 5.3 🔒 `decoding="async"` is a no-op in WebKit — do not emit it

BCD: `img > decoding` → Safari 11.1, so the *attribute* is understood everywhere. The spec wording
is `should`, not `must` ([WHATWG, image decoding hint](https://html.spec.whatwg.org/multipage/images.html)),
and WebKit exercises that latitude. `RenderBoxModelObject::decodingModeForImageDraw`:

```cpp
if (imgElement->decodingMode() == DecodingMode::Synchronous)
    return DecodingMode::Synchronous;
if (imgElement->decodingMode() == DecodingMode::Asynchronous) {
    if (bitmapImage->isAsyncDecodingEnabledForTesting() || bitmapImage->isAnimated())
        return DecodingMode::Asynchronous;
    return defaultDecodingMode();   // ← the async request falls through
}
```

`defaultDecodingMode()` returns async only on the first-ever tile paint of an element that has
never painted an image, or when the element is outside the viewport — otherwise **Synchronous**.

⇒ **`decoding="sync"` is honoured unconditionally; `decoding="async"` is honoured only for animated
images.** For a static, on-screen, previously-painted image it lands on the same policy as no
attribute at all.

Emitting `decoding="async"` by default would therefore be a mitigation that appears to work
(the attribute is in the DOM, DevTools shows it, Chrome honours it) and does nothing on the platform
adaptv cares most about. That is the owner's test, failed. **Omit it**, and record why here so the
omission is not "re-fixed" later.

### 5.4 `fetchpriority`: emit it freely

BCD `img > fetchpriority` and [caniuse](https://caniuse.com/mdn-html_elements_img_fetchpriority)
agree: Chrome 101, Firefox 132, **Safari 17.2, Safari iOS 17.2, WebView on iOS 17.2**, Android
WebView 101 ([WebKit, Safari 17.2](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/)).
On iOS 15/16 it is an inert unknown attribute — safe to emit unconditionally, simply ineffective
there. This is the correct shape for a hint: it degrades to nothing, visibly, on a known version
floor.

### 5.5 🔒 The finding that should change something else: Capacitor serves local assets `no-cache`

Both Capacitor asset handlers set `Cache-Control: no-cache` on **every** local response:

```swift
// ios/Capacitor/Capacitor/WebViewAssetHandler.swift  (WKURLSchemeHandler)
var headers = ["Content-Type": mimeType, "Cache-Control": "no-cache"]
```
```java
// android/capacitor/src/main/java/com/getcapacitor/WebViewLocalServer.java  (PathHandler)
"Cache-Control", "no-cache"
```

(Android does **not** use `androidx.webkit.WebViewAssetLoader`, contrary to common belief — it is
Capacitor's own `WebViewLocalServer` intercepting `shouldInterceptRequest`. Schemes:
`ios.scheme` defaults to `capacitor` ⇒ `capacitor://localhost`; `android.scheme` defaults to `https`
⇒ `https://localhost` — [capacitorjs.com/docs/config](https://capacitorjs.com/docs/config).)

So **bundled images are not HTTP-cached by the WebView**: every navigation back to a screen re-reads
and re-decodes them. Combine that with WebKit's decode policy:

```cpp
// Source/WebCore/platform/graphics/BitmapImageSource.cpp
bool BitmapImageSource::isLargeForDecoding() const {
    auto sizeInBytes = size(...).unclampedArea() * sizeof(uint32_t);
    return sizeInBytes > (isAnimated() ? 100 * KB : 500 * KB);
}
```

500 KB of *decoded* bytes ≈ 125,000 px ≈ **354 × 354** — i.e. essentially every real photo is
"large". WebKit enabled async decoding for large images
([bug 165039](https://bugs.webkit.org/show_bug.cgi?id=165039)) and then disabled it by default
([174432](https://bugs.webkit.org/show_bug.cgi?id=174432)) and after the first tile paint
([174451](https://bugs.webkit.org/show_bug.cgi?id=174451)) because async decode produced visible
flashes.

Two consequences:

1. It **strengthens the placeholder case on native specifically**. On repeat navigations in a
   Capacitor app there is a real, recurring decode gap with nothing on screen, and the LQIP is what
   fills it. This is the most adaptv-specific argument for the whole feature, and it is the one the
   web framing misses.
2. It is **an argument for a separate work item**, not for this component: the real fix is not
   shipping 4000 px sources to a 390 pt-wide phone. `srcset`/`sizes` are passthrough props today
   (§7.1); a future `Image` may want to own them. Out of scope here, flagged.

*Unverified:* no Capacitor issue was found tracking WebKit image-decode flicker specifically
(#1003 / #4702 / #620 are splash-screen background flashes). The decode behaviour is verified from
WebKit source; the *user-visible impact inside Capacitor* is inferred and is one of §10's
experiments.

---

## 6. The state machine

### 6.1 The five states, and what determines each

| State | Condition | Slot | Stack |
|---|---|---|---|
| **invalid** | no `src`, or `src` is empty/whitespace, or a `data:` URL that is not `image/*` | `Image.Invalid` | over |
| **loading** | a `src` exists and has neither loaded nor errored | `Image.Placeholder` | **under** |
| **loaded** | the `<img>` fired `load` (or is `complete` with `naturalWidth > 0`) | — | — |
| **error** | the `<img>` fired `error` | `Image.Error` | over |
| *(no slot mounted)* | any of the above | the root's own neutral surface | — |

**Overlay or replacement?**

- **`Image.Placeholder` is an overlay, underneath.** It is mounted from first render, sits at a
  lower z-index than the `<img>`, and fades out on load. It must be *under*: a placeholder that can
  outrank the loaded image is a placeholder that can never go away. (The existing code's comment
  already says this; it stays.)
- **`Image.Error` and `Image.Invalid` are overlays, on top.** The `<img>` is not rendered in either
  state — so "over" is not strictly needed — but "over" is the only stack that is *also* correct if
  a future change re-mounts it, and it guarantees a broken-image glyph can never show through.
- **Nothing is a replacement**, because a replacement changes the box, and no state of this
  component is ever allowed to change the box. The box belongs to the root and is set before any
  state is known.

**A slot is never required.** If the consumer mounts no `Image.Placeholder`, the root's own neutral
surface is what shows during loading — the "grey placeholder underneath" the brief asks for is the
**default**, not an opt-in. `Image.Placeholder` exists to put *content* on it (a skeleton shimmer, a
logo, a spinner).

**⟨Amended 2026-07-30⟩ There are two placeholder layers, and they get different `data-part`s.**

| Layer | `data-part` | Owner | Rendered when | z |
|---|---|---|---|---|
| the **LQIP layer** | `lqip` | adaptv | a placeholder data URL is in play | `z-0` |
| the **`Image.Placeholder` slot** | `placeholder` | the consumer | they mounted one with content | `z-[1]` |

They must **not** share a `data-part`, even though "placeholder" describes both. Two elements on one
(scope, part) coordinate is [Radix #602](https://github.com/radix-ui/primitives/issues/602) in
miniature: `[data-adaptv="image"] [data-part="placeholder"]` would reach both, so a consumer could
not restyle their own slot without also hitting the blur underneath it — and the whole point of
docs/decisions/styling.md §3's two-axis namespace is that the pair addresses exactly one thing.

The slot cannot *be* the LQIP layer, because it is the consumer's child and adaptv has no way to
hoist a `data:` URL into an element it does not construct — and inventing one (a portal, a context
that the slot reads and paints) would make the placeholder conditional on the consumer having
written a slot, which §6.1 has just finished saying it is not. So the LQIP is adaptv's own layer,
underneath, and the slot composites over it.

That in turn decides one class: **the `Image.Placeholder` slot's `base` is transparent**, unlike
`Image.Error` and `Image.Invalid`, which keep the neutral surface. A slot that defaulted to
`bg-gray-50` would hide the picture it is supposed to sit on. `className="bg-…"` makes it opaque
again, which is an ordinary restyle.

**⟨Amended 2026-07-30⟩ `claimSlot` is deleted.** The old code derived visibility partly from *which
slots were mounted* (`isErrorVisible` was true for an invalid `src` when no `Image.Invalid` existed).
With the machine above, visibility is a pure function of the state, so the mount-tracking `useState`
and its layout effects go — one fewer render pass per slot, and one fewer way for the state to
disagree with itself.

### 6.2 🔒 `src` changing mid-flight

Today the reset lives in a `useLayoutEffect` (lines 450–462). That is one frame late: React commits
the new `src` on the `<img>` while `loaded` is still `true` from the previous image, so for one
paint the component claims the *new* image is loaded and the placeholder is gone.

**Derive it during render instead**, with the "adjusting state when props change" pattern:

```ts
const [prevSrc, setPrevSrc] = useState(resolvedSrc)
if (prevSrc !== resolvedSrc) {
  setPrevSrc(resolvedSrc)
  setLoaded(false)
  setErrored(false)
}
```

The `complete`/`naturalWidth` probe (for a cached image that fires no `load` event) stays in a
layout effect — it needs the DOM node — but it now only ever *promotes* state, never resets it.

**The aspect ratio changes with `src` too** when `src` is an `AdaptvImageAsset`. That is the one
legitimate box change in the component's life, and it happens **synchronously with the src change**,
before any network activity — so it is a shift attributable to the consumer's own state update, not
to loading. That is the correct place for it to be.

*Not adopted:* `expo-image`'s `recyclingKey`. Its job is to reset a recycled view when the *content*
changes but the `src` string does not — a virtualized-list concern. Deriving from `src` covers every
case adaptv can name today; if a list ever recycles identical `src`s across different rows, revisit.

### 6.3 🔒 Kill `isLoadableImageSrc`

The regex triple (§1 correction 4) is replaced by three facts the runtime can actually establish:

```ts
const trimmed = typeof src === "string" ? src.trim() : ""
const missing = !trimmed
const badDataUrl = trimmed.startsWith("data:") && !trimmed.startsWith("data:image/")
const invalid = missing || badDataUrl
```

Everything else is handed to the network, and a failure lands in `error`. Rationale: `invalid` and
`error` render the same kind of thing; the only reason to distinguish them is that `invalid` is a
*programming* mistake (a null field, a bad interpolation) worth surfacing differently in dev. A
regex that guesses which strings are fetchable will be wrong in both directions, and being wrong
towards `invalid` means a perfectly good URL is never even attempted.

---

## 7. The prop surface

Each prop is labelled **CLS** (it exists to fight layout shift) or **ERG** (ergonomics /
performance). Anything that is neither should not exist.

### 7.1 The table

| Prop | Type | Default | Why |
|---|---|---|---|
| `src` | `string \| AdaptvImageAsset \| null \| undefined` | — | **CLS** in its object form: the asset carries `width`, `height`, `lqip`, so the box is reserved with no other props. String form is the runtime/remote case. |
| `width`, `height` | `number` | from `src` if an asset | **CLS**. Intrinsic pixel dimensions. Emitted as attributes *and* used to compute the wrapper ratio (§2.4). `number` only — the HTML spec requires values that parse as non-negative integers, and accepting `"100%"` would produce a silently ignored hint (failure case c). |
| `aspectRatio` | `number \| \`${number} / ${number}\`` | — | **CLS, and the most important prop in the table.** It is how a *remote* image reserves a box when its pixel dimensions are unknown. Without it, the reservation would exist only for static imports — the "works in one case" failure. Overrides `width`/`height` when both are present. |
| `placeholder` | `string \| false` | the asset's `lqip` | **ERG.** A `data:image/*` URL to use instead, or `false` to disable. This is the opt-out and the custom placeholder in one prop, per the brief. A BlurHash/ThumbHash string is rejected in dev with a message naming §3.3. |
| `fill` ⟨added 2026-07-30⟩ | `true` | — | **CLS.** The fourth way to reserve, for the case where the box belongs to a parent (a card, a hero, a fixed-height row). Originally listed as absent below; it is back because the sizing union needs a fourth branch for callers who genuinely have no ratio, and "`aspectRatio` plus a `className` height" is not one — it is two numbers where the parent already knows the answer. ⚠︎ The one form with a runtime failure mode: see §11. |
| `fit` | `"cover" \| "contain" \| "fill" \| "none" \| "scale-down"` | `"cover"` | **ERG, with a structural justification.** It would otherwise be pure `className` territory — but the placeholder layer's `background-size` must agree with the `<img>`'s `object-fit`, and adaptv cannot read a class name. The prop is the only channel through which two elements can be kept in step. (Next has the identical coupling and an `INVALID_BACKGROUND_SIZE_VALUES` list to prove it.) Values mirror CSS verbatim, because a web developer already knows them and there is DOM underneath. **`cover` by default**, matching React Native, `expo-image` and the reference component's own `size-full object-cover` — with a bonus worth stating: under `cover`, a *wrong* `aspectRatio` **crops** rather than distorts, so the default protects the developer who had to guess a remote image's ratio. |
| `position` ⟨added 2026-07-30⟩ | `string` | `"center"` | **ERG.** CSS `object-position`, mirrored onto the placeholder's `background-position`. Same argument as `fit`, one level down: the two layers must agree, and `contentPosition`'s original rejection below assumed `background-position: 50% 50%` was right for every fit — which is only true while nobody uses `contain`. |
| `priority` | `boolean` | `false` | **ERG (LCP, not CLS).** Sets `loading="eager"` + `fetchpriority="high"`, and paints the `<img>` from the server HTML on instead of holding it at `opacity-0` until hydration (no fade). Names an intent rather than two mechanisms, and lets the mapping change as support does. |
| `loading` | `"lazy" \| "eager"` | `"lazy"` | **ERG.** Escape hatch under `priority`. Default lazy is safe from iOS 15.4 (§5.2). |
| `alt` | `string` | `""` | Accessibility. Kept as a defaulted string rather than required, matching today's behaviour; a dev warning for a missing `alt` on a non-decorative image is a separate lint. |
| `onLoad`, `onError` | handlers | — | Passthrough, called after internal state updates. |
| `sizes`, `srcSet`, `crossOrigin`, `referrerPolicy`, `id`, `title`, … | native | — | Passthrough via `ImgHTMLAttributes`. |
| `className`, `style` | — | — | Routed through `mergeStyles` (§9). ⟨amended 2026-07-30⟩ They land on the **root**, not the `<img>`: the root is the in-flow box now, so an `h-48` or a `rounded-xl` has to reach it to mean anything, and the `<img>` is absolutely positioned inside it and owns nothing a consumer would want to restyle. |

**Deliberately absent, each with a reason:**

| Not a prop | Why |
|---|---|
| `decoding` | Would imply adaptv has an opinion. It has one — don't (§5.3) — and it is expressed by emitting nothing. Still reachable through the native passthrough for a consumer who has measured something adaptv has not. |
| `blurRadius` / `transition` (expo-image has both) | The blur is baked at build (§3.4), so a runtime radius would require a runtime filter. The fade duration is `className` — `duration-300` is already overridable. |
| ~~`contentPosition`~~ | ⟨reversed 2026-07-30⟩ Now shipped as `position`, above. The original reasoning — that `background-position: 50% 50%` is correct for every `object-position` a `cover` fit will actually use — is true and irrelevant the moment `fit="contain"` exists, which it does. |
| `render` (§3.3) | §3.3's failure analysis is about *composition* — rendering the primitive as an `<li>`, an `<a>`, a `<button>`. An `<img>` has no alternate host element that keeps it an image. Named explicitly so the omission is a decision, not an oversight. |
| ~~`fill`~~ | ⟨reversed 2026-07-30⟩ Now shipped, above. |
| `cachePolicy`, `recyclingKey` (expo-image) | Native-only concepts. `cachePolicy` has no web equivalent adaptv can honour on all six targets, and §6.2 explains why `recyclingKey` is not yet needed. |

### 7.2 The anatomy

```
<div data-adaptv="image" data-part="root">        ← in-flow, reserves the box, aspect-ratio locked
  <div data-part="lqip">          (if any LQIP)   ← absolute inset-0, z-0,   adaptv's LQIP layer
  <div data-part="placeholder">   (if mounted)    ← absolute inset-0, z-[1], Image.Placeholder
  <div data-part="invalid">       (if mounted)    ← absolute inset-0, z-20
  <div data-part="error">         (if mounted)    ← absolute inset-0, z-20
  <img data-part="image">         (unless invalid/errored) ← absolute inset-0, z-10
</div>
```

Three changes from today:

1. **The separate `ImageLayoutAnchor` is folded into the root.** Today there is a `relative size-full`
   shell *plus* an in-flow `block w-full` anchor carrying the ratio. Two elements that must agree
   about one box is one more than necessary, and it is why `size-full` appears on the shell —
   pushing the reservation up to the parent. The root becomes the in-flow reserved box directly.
2. **The root always renders.** `needsCompositionShell` is deleted (§1 correction 3). There is no
   "standalone" mode.
3. **`isolate` on the root.** The stack uses `z-0`/`z-10`/`z-20`; without `isolation: isolate` those
   participate in the nearest ancestor stacking context and can interleave with the consumer's own
   layers. This is structural, so it is `locked`.

Also deleted: `IMAGE_COMPOSED_IMG_TRANSFORM_CLASS` (`translateZ(0) scale(1.008)`). The `scale` is a
seam-hiding hack for a fractional-pixel gap, and the `translateZ(0)` is precisely the promotion
[`docs/design/performance-boost.md §4.1`](../design/performance-boost.md) just finished arguing against — a containing
block for `fixed`/`absolute` descendants, applied per image. If a seam is genuinely visible, the fix
is `overflow: clip` on the root (which Chromium's UA sheet already applies to `img`), not a
per-image compositing layer.

---

## 8. Is any of this consumer-questionable?

The test is *is the alternative broken, or just different?*

| Thing | Alternative | Broken or different? | Where it goes |
|---|---|---|---|
| Reserving the box | not reserving it | **broken** — it is the whole component | Doctrine. No knob. |
| `aspect-ratio` in `lockedStyle` | a consumer inline `height` that defeats it | **broken** — same shape as `Checkbox.Box`'s locked size (`src/components/checkbox.tsx` L270-280) | `lockedStyle`. Change it with the `aspectRatio` **prop**. |
| Lazy loading | eager | **different** — and it is per-image | The `loading` / `priority` **props**, not a config flag. |
| The neutral placeholder surface | a transparent box | **different** | `base` — one class, fully overridable. |
| Baked blur | no blur | **different** | The `placeholder` **prop** (`false` disables). |
| **LQIP generation at build** | not generating it — a build-time/bundle-size cost | **different** | `adaptv.config.ts` → `images: { placeholder?: boolean }`. **Not `ui: {}`.** |
| Rejecting BlurHash strings | accepting them | **broken** — accepting means shipping a decoder that cannot paint before hydration (§3) | Doctrine. Dev error. |

**Nothing belongs in `ui: {}`, and the reason is mechanical rather than a matter of taste.** The
`ui` block has a defined implementation: it is *"Resolved **once**, in the pre-paint init script,
against the runtime platform; the result is a boolean-presence attribute on `<html>`"* — so
`styles.css` stays a single static artifact with no build matrix
(`src/config/app-config.ts`, `AdaptvUiConfig`). A build-time image pipeline has no runtime platform
to resolve against and produces no CSS. Putting `placeholder` there would break the block's one
invariant to gain a nicer-looking home.

`images: { placeholder }` is a **build** key, alongside `router` and `sw`, and it exists only
because "spend 1–17 ms and ~200 bytes per image" is a legitimate budget question — not because the
alternative renders correctly in a different way.

---

## 9. How it satisfies the styling contract

### 9.1 §2 — the base/locked split, part by part

⟨Amended 2026-07-30. Two rows changed: the consumer's `className`/`style` moved from the `<img>` to
the root, and `fit`/`position` moved from a class on the `<img>` into `lockedStyle` on **two**
elements. The reasoning for both is below the table.⟩

| Part | `base` (overridable) | `className` | `locked` | `baseStyle` | `lockedStyle` |
|---|---|---|---|---|---|
| **root** | `block w-full` + the neutral surface class | **consumer** | `relative isolate overflow-hidden` (or `absolute inset-0 isolate size-full overflow-hidden` under `fill`) | — | **`{ aspectRatio }`** |
| **LQIP layer** (`data-part="lqip"`) | neutral surface, `opacity-100`, the fade transition | — (adaptv's own layer) | `absolute inset-0 size-full z-0 rounded-[inherit]`, and `invisible` in the hidden state | `{ backgroundImage: url(lqip), backgroundRepeat: "no-repeat" }` | **`{ backgroundSize, backgroundPosition }`** |
| **placeholder slot** (`data-part="placeholder"`) | transparent, `opacity-100`, transition | consumer | `absolute inset-0 size-full z-[1] rounded-[inherit]`, `invisible` when hidden | — | — |
| **invalid / error** | neutral surface, `opacity-100`, transition | consumer | `absolute inset-0 size-full z-20 rounded-[inherit]`, `invisible` when hidden | — | — |
| **img** | the fade transition, `opacity-100` when visible | — (structural) | `absolute inset-0 block size-full z-10`, and `-z-10 opacity-0` when hidden | — | **`{ objectFit, objectPosition }`** |

Four things are worth stating rather than reading off the table:

**Why `aspectRatio` is `lockedStyle` and not `baseStyle`.** It is the reservation. A consumer inline
`style={{ height: 40 }}` that reaches the root before it does would defeat the entire component —
which is the identical argument `Checkbox.Box` already makes for its derived box size:

> *"A consumer inline `width` would resize the square without resizing the checkmark, which is a
> silently broken control rather than a restyled one — `size={n}` is the supported way to change
> it."* — `src/components/checkbox.tsx`

Here the supported way is `aspectRatio={n}`. And locking it costs nothing a consumer legitimately
wants: a `className="h-48"` still works — with both a definite height and a ratio, the ratio simply
governs the width instead, and the box is still reserved. The only thing made impossible is an
*unreserved* box.

**Why the LQIP `background-image` is `baseStyle` but its `background-size`/`-position` are
`lockedStyle`.** ⟨amended⟩ The two halves of that declaration answer to different owners. *Which
picture* is decoration — a consumer who replaces it with a gradient has restyled the component. *How
it is fitted* is one half of a pair whose other half lives on the `<img>`, and a pair that can
half-change is broken, not restyled. Same asymmetry the existing `ImageSlotLayer` already gets right
between the hidden and visible halves of the visibility state.

**Why `fit`/`position` are `lockedStyle` on the `<img>` rather than a `base` class.** This is the
one place the doc's original §9.1 was wrong, and the amendment that adds the `fit` prop is what
exposes it. If `object-fit` ships as a `base` class, a consumer's `className="object-contain"`
legitimately beats it — and then the `<img>` is `contain` while the placeholder is still `cover`,
so the blur→image swap jumps. adaptv would have shipped a mitigation that works when you use the
prop and fails silently when you use a class, which is [`VISION.md §2.1`](../VISION.md)'s test, failed,
by the very feature added to pass it.

So the inline tier holds both, the consumer's own `style={{ objectFit }}` loses to it, and the
supported way to change the fit is `fit="contain"` — which moves **both** layers. Identical in shape
to `Checkbox.Box`: a value two elements are derived from is broken by a partial override, not
restyled by one. What is *not* locked is everything a consumer actually wants: `rounded-full`,
`bg-*`, `h-48`, opacity, the fade duration.

**The `hidden` states stay locked; the `visible` states stay base.** Unchanged from today, and the
comment explaining it in `image.tsx` survives the refactor verbatim.

### 9.2 §3.1 — boolean-presence `data-*`, namespaced per component

```html
<div data-adaptv="image" data-part="root" data-image-loading>
  <div data-part="lqip">
  <div data-part="placeholder">
  <img data-part="image">
</div>
```

| Attribute | When |
|---|---|
| `data-adaptv="image"`, `data-part="…"` | always — the (scope, part) coordinate §3 mandates |
| `data-image-loading` | a `src` exists and has neither loaded nor errored |
| `data-image-loaded` | the image is showing |
| `data-image-error` | the load failed |
| `data-image-invalid` | no `src`, or a non-image `data:` URL |

All four are **presence** attributes (`"" | undefined`), not `data-state="loading"`, per §3.1 — and
all four are **namespaced with the component name** (`data-image-*`, not `data-loading`) per the same
section's second rule, so composing `Image` inside another adaptv primitive cannot produce two
writers of one attribute (the Radix [#602](https://github.com/radix-ui/primitives/issues/602)
failure).

They live on the **root**, so one selector reaches everything:

```css
[data-adaptv="image"][data-image-loading] [data-part="placeholder"] { animation: shimmer 1.2s infinite; }
```

`useImage()` stays as the React-side reader for slot authors who need to branch on *content* rather
than style.

### 9.3 §3.2 — measured scalars are CSS variables. `Image` publishes none, and that is a decision.

§3.2 governs values that are *computed post-layout in the same frame* and must cross JS→CSS without
a React round-trip. Nothing in `Image` qualifies: the aspect ratio is known statically before first
paint, and the LQIP is a build artifact. Publishing `--image-aspect-ratio` would put a value that
belongs in `lockedStyle` (where it is enforceable) into a custom property (where any consumer rule
can redefine it). **`Image` declares no custom property**, and this paragraph exists so the absence
reads as a decision rather than an omission.

### 9.4 §3.3 — `render`

Not offered. See §7.1. The `mergeStyles`-aware composition path §3.3 mandates is still honoured
wherever it applies: the slots accept `className` and route it through `mergeStyles`, never through
concatenation.

### 9.5 §6.0.1 — no `!important`

Nothing in this design emits CSS. Every declaration is either a Tailwind utility resolved by
`mergeStyles`/tailwind-merge **before** it reaches the DOM, or an inline style whose precedence is
object-spread order. There is no new `@utility`, therefore **no new `extendTailwindMerge`
registration is required** in `src/utils/cn.ts` — which is stated explicitly because §5.5 makes
forgetting one a silent loss of the `locked` guarantee, and "no change needed" is a claim worth
having on record.

---

## 10. Proving it works

### 10.1 🚨 The constraint that shapes all of this: CLS cannot be measured on iOS

MDN BCD `api/LayoutShift.json`: `chrome: 77`, **`firefox: false`, `safari: false`**, with
`safari_ios` and `webview_ios` mirroring ⇒ **false**. MDN labels the interface *"Limited
availability"*. [caniuse](https://caniuse.com/mdn-api_layoutshift): Safari not supported through
version 27 and TP; iOS Safari not supported through 26.5. Google's own `web-vitals` library states
`onCLS()` as Chromium-only while `onLCP` / `onINP` / `onFCP` / `onTTFB` list Chromium, Firefox and
Safari.

And it is not imminent: **Safari 26.2 (2025-12-12) added Largest Contentful Paint and the Event
Timing API** ([WebKit](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)) and
conspicuously not Layout Instability. CLS was not in Interop 2025.

⇒ **`new PerformanceObserver(…).observe({type: "layout-shift"})` will never fire in a Capacitor iOS
app.** Any CLS budget, regression gate or field telemetry adaptv ships is Android-only. Plan for
that here rather than discovering it in CI. Feature-detect with
`"layout-shift" in PerformanceObserver.supportedEntryTypes` — that detect is itself safe
(`supportedEntryTypes` is Safari 13).

### 10.2 The measurement that runs everywhere: test the component, not the page

The strongest gate does not need CLS at all, because it does not need the page.

```
render <Image> with a src that never resolves
  → read root.getBoundingClientRect()
resolve the image
  → read it again
assert: identical, to the pixel
```

Run that as a `vitest` + `happy-dom` matrix over the cases that must all behave the same, which is
exactly the owner's test written as a table:

| Case | Must reserve |
|---|---|
| `<Image src={staticImport} />` | ✅ from the asset |
| `<Image src={url} width={640} height={400} />` | ✅ |
| `<Image src={url} aspectRatio={16/9} />` | ✅ |
| `<Image src={url} />` | **compile error** (§11) — never a silent unreserved box. Asserted by `pnpm typecheck` against a `@ts-expect-error` fixture in `image.test.tsx`, not by vitest. |
| `<Image src={null} />` + `Image.Invalid` | ✅ (the box exists before any src does) |
| `src` swapped mid-flight, same ratio | ✅ no change |
| consumer `className="h-48"` | ✅ still reserved, width now derived |
| consumer `style={{ height: 40 }}` | ✅ `lockedStyle` wins |
| `Image.Placeholder`/`Error`/`Invalid` each visible | ✅ box unchanged in every state |

`happy-dom` does not do layout, so this needs a real engine — run it under `vitest` with a browser
provider, or as a Playwright assertion on the playground. **Flagged as the one open implementation
question in the test plan**; the existing `style-precedence.test.tsx` `withPendingImages` helper
(which pins `HTMLImageElement.prototype.complete` to `false`) is the right seam for the state half
regardless.

### 10.3 On Android — real CLS numbers are available

`WebView.setWebContentsDebuggingEnabled(true)` (Capacitor:
`android.webContentsDebuggingEnabled`, automatically on in development), then `chrome://inspect` →
full DevTools including the Performance panel with layout-shift regions highlighted
([Chrome docs](https://developer.chrome.com/docs/devtools/remote-debugging/webviews)). The
Layout Instability API is present (`webview_android` mirrors `chrome_android` ⇒ 77), so
`web-vitals`' `onCLS()` works in-page.

**Caveat worth writing on the result:** this measures the same DOM, not the same device. iOS
diverges on safe-area insets, WKWebView keyboard/visual-viewport behaviour, font metrics and scroll
rubber-banding — all CLS-relevant.

### 10.4 On iOS — what is actually possible

1. **Safari Web Inspector Timelines** gives *layout events*, not a shift score. The "Layout &
   Rendering" instrument lists every style invalidation, layout, composite and paint with the JS
   that triggered it. Useful for "did a layout happen when the image decoded?", useless for a
   number. Setup: `WKWebView.isInspectable = true` is **required on iOS 16.4+** and defaults to
   `false` ([WebKit](https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/));
   Capacitor's knob is `ios.webContentsDebuggingEnabled`.
2. **Screen-recording frame analysis** — `xcrun simctl io recordVideo` on the simulator, or
   QuickTime against a device; step frames and measure displacement. The only method that captures
   what a user on real iOS hardware saw. Produces a yes/no plus a magnitude, not a comparable score.
3. **Do not build a JS CLS polyfill.** `getBoundingClientRect()` in a rAF loop forces synchronous
   layout, so the instrument perturbs what it measures; it only sees elements you enrolled, so it
   systematically under-counts; and the engine's impact-region computation is a 2-D union
   (the Klee measure problem, per the [Layout Instability draft](https://wicg.github.io/layout-instability/))
   that a JS approximation will not reproduce. This is [`docs/design/performance-boost.md §8.4`](../design/performance-boost.md)'s
   rule — *do not measure frames with JavaScript* — applied to a different metric for the same
   reason. No off-the-shelf polyfill was found; *unverified* that one exists.

### 10.5 The build-cost measurement, which is the other thing that can regress

The plugin should emit, behind the CLI's existing verbose channel: images processed, cache hits,
total ms, worst single image. The number to defend is **cold-build total** and **warm-build total**;
`vite-imagetools`' discussion #816 (3 s → 50 s for four images, with rebuilds barely faster) is the
regression to make impossible, and the cache key in §4.3 is the thing being tested.

### 10.6 The device

[`docs/design/performance-boost.md §8.5`](../design/performance-boost.md)'s cheap physical Android is the same purchase
that makes §10.3 real. Until it exists, the Android numbers are emulator numbers and should be
labelled as such.

---

## 11. 🔒 Decided — the un-reservable call does not compile

**Decided 2026-07-30. The question this section originally asked was the wrong one.**

It asked *"does `<Image>` throw in development when it can reserve no box?"* — and every option it
enumerated is a **runtime** answer to a question that can be answered at **compile** time. That is
`VISION.md` principle 1: the wrong thing does not become a warning, it becomes impossible.

### 11.1 The mechanism: a four-branch union on the sizing props

```ts
type ImageSizing =
  | { src: AdaptvImageAsset; width?: number; height?: number }   // the build supplies them
  | { src?: string | null; width: number; height: number }
  | { src?: string | null; aspectRatio: ImageAspectRatio }
  | { src?: string | null; fill: true }
```

```tsx
<Image src={hero} alt="…" />                        // ✅ the asset carries the box
<Image src={url} width={640} height={400} alt="…" /> // ✅
<Image src={url} aspectRatio={16 / 9} alt="…" />     // ✅ the remote case
<Image src={url} fill alt="…" />                     // ✅ the parent owns the box
<Image src={url} alt="…" />                          // ✖ does not compile
<Image alt="…" />                                    // ✖ does not compile
```

Note what `src?: string | null` in three of the four branches buys: `<Image src={null} width={64}
height={64} />` compiles, because an avatar whose URL has not arrived yet still has a box — which is
the entire point. What cannot be written is a *form that reserves nothing*, with or without a `src`.

Why this beats option A, which this section previously recommended: a throw can be scrolled past in
a busy console, commented out, or simply never reached because the branch that renders that
`<Image>` was not exercised in dev. A type error is none of those. It also arrives at the moment of
writing rather than the moment of running, which is where a guardrail that *teaches* belongs.

### 11.2 The runtime check survives, demoted

The union is the mechanism; the runtime check is the **backstop** for callers who escape the types —
plain JS, an `as string`, a spread props object, a `@ts-ignore`. It is:

- in dev, one `console.error` per message naming all four ways out, and
- in **every** build, `data-image-unreserved` on the root.

That second half is not the doc's original "production fallback"; it is stronger. The original
proposal emitted the attribute only in production, mirroring Next — whose throw lives inside
`if (process.env.NODE_ENV !== 'production')`, so in a production build the check does not run at all
and `blurDataURL: ''` is fed into the SVG. Emitting the attribute unconditionally means one E2E
selector (`[data-image-unreserved]`) works against a dev server *and* a real bundle, which is the
only way the assertion is worth writing.

### 11.3 ⚠︎ `fill` is the one form with a genuine runtime failure mode

`fill` does not reserve anything itself: it stretches to a parent that must be **positioned** and
**sized**, and no type can inspect a parent. Both halves fail differently:

| Half | Failure | Checkable? |
|---|---|---|
| parent is `position: static` | the root escapes to the nearest positioned ancestor — silently, and often *looks* fine on the page it was written on | ✅ dev-only `getComputedStyle(parent).position` in a layout effect |
| parent has no height | the box collapses to zero and the image never appears | ❌ needs a real layout pass, which no environment adaptv tests in performs |

So the positioning half is checked and the sizing half is documented, and the asymmetry is stated
rather than papered over. This is the residual risk in the design: `fill` is the one branch of the
union where "it compiles" is not the same as "it reserves".

### 11.4 The original analysis, kept

The three options below are retained because the reasoning that rejects **B** and **C** is what
rules out weakening the union later — in particular C, which is the shape someone will propose the
first time the union is inconvenient.

The condition is precise: `src` is a plain string (not an asset), and neither `width`+`height` nor
`aspectRatio` nor `fill` was given.

| Option | Consequence |
|---|---|
| **A. Throw in dev** ~~(recommended)~~ — superseded by §11.1 | The guarantee is real. `<Image>` reserves a box or it does not render, on every target, for every src. The cost is a hard stop the first time someone types `<Image src={user.avatar} />`. Next.js sets the precedent — missing `width`/`height` and `placeholder="blur"` without `blurDataURL` both **throw**, and the message enumerates the fixes ([`get-img-props.ts#L588-L601`](https://github.com/vercel/next.js/blob/39db24a48bbbd0bdd6acb5d15d43ed6f14639068/packages/next/src/shared/lib/get-img-props.ts#L588-L601)). |
| **B. Warn in dev, render unreserved in prod** | Softer, and it is what the component does today by accident. But a warning in a console nobody reads is indistinguishable from no mechanism, and it reintroduces exactly the "works in one case" state §1 correction 3 removes. |
| **C. Reserve a default box** (e.g. `1 / 1`) | Never shifts, always wrong. It converts an invisible bug into an invisible design defect, which is worse because nothing ever reports it. **Reject.** |

⚠️ **A trap in Next's precedent worth copying carefully.** Their throw is inside
`if (process.env.NODE_ENV !== 'production')`, so in a production build the check simply does not run
and `blurDataURL: ''` is fed into the SVG — a silently broken placeholder. A dev-only guarantee that
evaporates at build time is a dev-only guarantee. §11.2 is the answer: the attribute ships in both.

**Outcome: neither A, B nor C — the type system, per §11.1**, with A's dev message and a
strengthened version of its production fallback kept as the backstop. That is the only arrangement
under which the sentence *"adaptv's `Image` does not cause layout shift"* is true rather than
usually true, and "usually true" is the property the owner has already rejected once this week.

---

## 12. Migration — what is deleted, what is kept

| # | File | Change |
|---|---|---|
| 1 | `src/components/image.tsx` | Delete `needsCompositionShell` and the `if (!needsCompositionShell) return imgNode` branch (§1.3). The shell is unconditional. |
| 2 | `src/components/image.tsx` | Delete `ImageLayoutAnchor`, `IMAGE_LAYOUT_ANCHOR_LAYOUT_CLASS`, `IMAGE_COMPOSED_SHELL_LAYOUT_CLASS`, `IMAGE_STANDALONE_LAYOUT_CLASS`. One root element carries the reservation (§7.2). |
| 3 | `src/components/image.tsx` | Delete `IMAGE_COMPOSED_IMG_TRANSFORM_CLASS` (`translateZ(0) scale(1.008)`) — a per-image compositing layer and containing block (§7.2). |
| 4 | `src/components/image.tsx` | Delete `isLoadableImageSrc`, `ABSOLUTE_URL_PROTOCOL`, `RELATIVE_PATH`, `SIMPLE_RELATIVE_PATH`; replace with the three-fact check (§6.3). |
| 5 | `src/components/image.tsx` | Move the load-state reset from `useLayoutEffect` to render-time derivation (§6.2). |
| 6 | `src/components/image.tsx` | Add `aspectRatio`, `placeholder`, `fit`, `position`, `fill`, `priority`, `loading` props (§7.1) and the `ImageSizing` union (§11.1). Add `data-adaptv` / `data-part` / `data-image-*` (§9.2). Add `isolate` to the root's `locked`. |
| 7 | `src/components/image.tsx` | **Keep**: the three compound slots, `ImageSlotLayer`'s locked/base asymmetry and its comment, `useImage()`, `useReducedMotion` gating, the `complete`/`naturalWidth` cached-image probe. ⟨amended⟩ **`claimSlot` is deleted** — visibility is now a pure function of the state, so nothing needs to know which slots exist (§6.1). |
| 7a | `src/components/image.tsx` | ⟨new⟩ `forwardRef` → **`ref` as a plain prop** (React 19), diverging from the other primitives in this directory. **Not** because `forwardRef` breaks the union — that was the initial guess and it is wrong: `forwardRef<HTMLImageElement, ImageProps>` still rejects `<Image src={url} />`, *verified by compiling it*. The reason is the message. `forwardRef` reports the failure against `PropsWithoutRef<P> & RefAttributes<T>`, which prints as a four-way union of `Omit<Omit<ImgHTMLAttributes<…>, "ref" \| "children" \| …>, "ref">`; the plain function reports it against `ImageProps`. When a type error *is* the guardrail, the guardrail is the text the developer reads. |
| 8 | `src/vite/adaptv-image.ts` | **New.** `resolveId`/`load` for `*.{jpg,jpeg,png,webp,avif,gif,tif,tiff,svg}?adaptv-image`; sharp metadata + LQIP; the cache from §4.3; the failure policy from §4.5. ⟨amended⟩ `enforce: "pre"` — see §4.2a. |
| 9 | `src/vite/adaptv-plugin.ts` | Register it next to `adaptvPwaRegisterPlugin()`. ⚠︎ *Not* "it composes because it only answers for its own suffix" — that was wrong; it needs `enforce: "pre"` to be asked at all (§4.2a). |
| 10 | `src/config/app-config.ts` | Add `images?: { placeholder?: boolean }` and pass it to `adaptvImagePlugin({ placeholder })`. **Do not** add anything to `AdaptvUiConfig` (§8). ⟨status⟩ **Not wired.** The plugin takes the option and defaults it to `true`; the config key is a one-line follow-up. |
| 11 | `src/interface/components.index.ts` | Export `AdaptvImageAsset`, `ImageFit`, `ImageAspectRatio`. ⟨status⟩ `export * from "../components/image"` already carries them. |
| 12 | `src/virtual-adaptv-image-asset.d.ts` | **New.** The ambient `declare module "*?adaptv-image"`. ⚠︎ The asset shape is written out rather than imported: an ambient declaration resolves inside the *consumer's* tsconfig, where `#adaptv/*` does not exist. ⟨status⟩ **Done, and the `"./image-asset"` export this row asked for was deliberately not added** (2026-08-30). The file shipped under the `virtual-adaptv-*` name instead, which the consumer's existing `include` glob already picks up — the same delivery every one of the seven ambient declarations in `src/` uses, and none of them is in `exports`. An export would have bought nothing: a subpath does not load an ambient declaration either, so it is one consumer-side line either way. (This row also named the path wrong — `src/vite/adaptv-image-asset.d.ts` never existed.) |
| 13 | `src/components/style-precedence.test.tsx` | ⟨done⟩ The standalone case is gone with standalone mode. Replaced by: the consumer `className` owns the **root**; a consumer inline `aspectRatio` loses to the reservation; the `<img>` is locked into the stack with `object-fit: cover`; a slot layer is locked into the stack. |
| 13a | `src/components/image.test.tsx`, `src/vite/adaptv-image.test.ts` | **New.** The §10.2 reservation table, the state machine including a mid-flight `src` swap, the `fit`/`position` mirroring, the plugin's failure policy — and a `@ts-expect-error` fixture that makes `pnpm typecheck` the enforcer of §11.1. |
| 14 | `src/utils/cn.ts` | **No change** (§9.5). |
| 15 | `docs/VISION.md` §5 | ⟨done⟩ The `Image` line — *"lazy, placeholder/blur, safe intrinsic sizing (no layout shift)"* — is delivered by this doc; point it here. |
| 16 | `docs/research/component-surface.md` §6 | ⟨done⟩ The `expo-image` row's `placeholder` entry should note that its blurhash/thumbhash support is a **native-decoder** feature that does not transfer to a WebView (§3.3). |

---

## 13. Where this sits

- [`docs/decisions/styling.md §2 / §3.1 / §3.2 / §3.3 / §6.0.1`](../decisions/styling.md) — the contract §9 satisfies clause by
  clause, including the two "no change / no variable" claims made explicitly so they are decisions.
- [`docs/design/architecture.md §0.1 / §0.6 / §5.4 / §5.5`](../design/architecture.md) — opinionated defaults; rent the
  solved core; the health check that makes `vite-plugin-lqip` a 📖 rather than a ✅; and the
  `THIRD_PARTY_LICENSES` obligation `sharp`'s LGPL libvips adds to.
- [`VISION.md §2`](../VISION.md) principles 1–3 — the ergonomic path is the correct path (§4.2), and
  guardrails teach rather than mutate (§11), which is why the design has an explicit import query
  and a loud error instead of AST rewriting.
- [`docs/design/performance-boost.md §4.1 / §7.5 / §8.4`](../design/performance-boost.md) — the containing-block argument
  that deletes the `translateZ(0) scale(1.008)` class, the `ui: {}` test applied identically in §8,
  and the rule against measuring rendering with JavaScript, applied to CLS in §10.4.
- [`docs/design/rendering.md §3.5`](../design/rendering.md) — Capacitor gets no service worker, which is why §5.5's
  `Cache-Control: no-cache` on local assets has no cache layer above it to compensate.
- [`docs/research/component-surface.md §6`](../research/component-surface.md) — the `expo-image` prop inventory §7.1 is
  measured against, and §12 row 16's correction to it.
