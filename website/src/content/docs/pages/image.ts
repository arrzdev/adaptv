import { ImageDemo } from "@/components/docs-demos/image-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "image",
  title: "Image",
  summary:
    "An `<img>` that reserves its box before the bytes arrive, so nothing below it moves when the picture decodes.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Image, useImage } from "@arrzdev/adaptv/components"',
  source: "src/components/image.tsx",
  blocks: [
    {
      type: "demo",
      component: ImageDemo,
      code: `import { Image } from "@arrzdev/adaptv/components"
import capture from "./ios-list.png?adaptv-image"

// capture = { src, width: 660, height: 1431, lqip }

<Image
  src={capture}
  aspectRatio="4 / 3"
  fit={fit}
  position="top"
  alt="A list screen running on an iPhone"
  className="rounded-2xl border border-gray-200"
/>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "A plain `<img src>` has no size until its bytes arrive. It renders zero pixels tall, then jumps to full height and pushes everything under it down. That jump is [layout shift](/docs/layout-shift), and in an app it is what makes a screen feel like a web page still loading.",
    },
    {
      type: "p",
      text: "`Image` does not let you create an image without a reserved box. There are four ways to reserve one, and the TypeScript props accept only those four. `<Image src={url} />` with nothing else does not compile.",
    },
    {
      type: "table",
      head: ["You write", "The box comes from"],
      rows: [
        [
          "`<Image src={asset} />`",
          "The `width` and `height` the build read from the file. Use this for every image in your repo.",
        ],
        [
          "`<Image src={url} width={640} height={400} />`",
          "The pair, when you know the pixel size.",
        ],
        [
          "`<Image src={url} aspectRatio={16 / 9} />`",
          "The ratio. The usual answer for remote images: avatars, covers, thumbnails.",
        ],
        [
          "`<Image src={url} fill />`",
          "A parent that is positioned and has a size.",
        ],
      ],
    },
    {
      type: "p",
      text: "In the three URL forms `src` may be `null` or `undefined`. An image whose URL has not arrived yet still holds its box.",
    },
    { type: "h2", text: "Importing an image" },
    {
      type: "p",
      text: "Add `?adaptv-image` to a static import and you get an object instead of a URL string. adaptv's [Vite plugin](/docs/vite-plugin) reads the file at build time.",
    },
    {
      type: "code",
      label: "hero.tsx",
      lang: "tsx",
      code: `import hero from "./hero.jpg?adaptv-image"

// hero = {
//   src: "/assets/hero-D18UDLrP.jpg",   hashed and base-prefixed by Vite
//   width: 2400,                         intrinsic size, EXIF rotation applied
//   height: 1600,
//   lqip: "data:image/webp;base64,…",    a blurred 16px preview
// }

<Image src={hero} alt="The harbour at dawn" />`,
    },
    {
      type: "p",
      text: "`width` and `height` are the point: they are what reserves the box. The `lqip` (low-quality image placeholder) is a 16-pixel WebP with the blur baked in, usually under 200 bytes. It is inlined in your JavaScript, so it paints in the same frame as the HTML, before the real file has been requested.",
    },
    {
      type: "table",
      head: ["Source", "`width` / `height`", "`lqip`"],
      rows: [
        [
          "`.jpg` `.jpeg` `.png` `.webp` `.avif` `.gif` `.tif` `.tiff`",
          "Yes",
          "Yes",
        ],
        ["`.svg`", "Yes, from `width`/`height` or the `viewBox`", "No"],
        ["Animated `.gif`, `.png` or `.webp`", "Yes", "No"],
        ["Smaller than 40px on its long edge", "Yes", "No"],
      ],
    },
    {
      type: "ul",
      items: [
        "A missing placeholder is cosmetic, so those cases are silent. A missing dimension is a layout shift, so it **fails the build**: an unsupported extension, a file that cannot be decoded, an SVG with neither size nor `viewBox`, or `sharp` failing to load.",
        "A placeholder over 1 kB prints a build warning naming the file. It usually means a large flat PNG screenshot.",
        "Results are cached in `node_modules/.cache/adaptv/lqip`, keyed on the file's size and modified time, so a rebuild does not decode the sources again.",
        'A plain `import logo from "./logo.png"` still gives you a URL string, as in any Vite app. Only the query opts in. If you forget it, `<Image src={logo} />` is a type error, because a string `src` needs one of the other three forms.',
      ],
    },
    {
      type: "p",
      text: "To skip generating placeholders for the whole app, set `images.placeholder` to `false` in [adaptv.config.ts](/docs/config). Imports still carry `width` and `height`, so boxes are still reserved. There is no switch for the dimensions.",
    },
    {
      type: "note",
      text: "The build uses `sharp`, which adaptv installs as a dependency. With pnpm on CI, a failure to load it usually means the platform binary was not installed; add the CI platform to `pnpm.supportedArchitectures`. TypeScript knows the `?adaptv-image` module through an ambient declaration inside the package, which your `tsconfig.json` `include` must reach: `node_modules/@arrzdev/adaptv/src/**/virtual-adaptv-*.d.ts`.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "src",
          type: "AdaptvImageAsset | string | null",
          description:
            "A `?adaptv-image` import, or a URL. Required when it is the only thing reserving the box; optional and nullable in the `width`+`height`, `aspectRatio` and `fill` forms.",
        },
        {
          name: "width",
          type: "number",
          description:
            "Intrinsic width in CSS pixels. Used with `height` to derive the ratio, and emitted as the `<img>`'s `width` attribute. It does not set the rendered size; `className` does. Defaults to the asset's.",
        },
        {
          name: "height",
          type: "number",
          description:
            "Intrinsic height in CSS pixels. Defaults to the asset's.",
        },
        {
          name: "aspectRatio",
          type: 'number | "W / H"',
          description:
            "The box's ratio: `16 / 9`, `1`, or the string `\"4 / 3\"`. Wins over `width`/`height` and over an asset's own size, so you can crop a static import to a different shape.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Stretch to the parent (`absolute inset-0`) instead of reserving a ratio. The parent must be positioned and have a height.",
        },
        {
          name: "alt",
          type: "string",
          default: '""',
          description:
            "Alternative text. The empty default marks the image as decorative.",
        },
        {
          name: "fit",
          type: '"cover" | "contain" | "fill" | "none" | "scale-down"',
          default: '"cover"',
          description:
            "CSS `object-fit`. A prop, because the placeholder has to be laid out the same way as the photo.",
        },
        {
          name: "position",
          type: "string",
          default: '"center"',
          description: 'CSS `object-position`: `"top"`, `"20% 50%"`.',
        },
        {
          name: "placeholder",
          type: "string | false",
          description:
            "A `data:image/*` URL to paint while loading, or `false` for none. Defaults to the import's `lqip`.",
        },
        {
          name: "priority",
          type: "boolean",
          default: "false",
          description:
            'For the image that is the largest thing on first paint: `loading="eager"` and `fetchpriority="high"`.',
        },
        {
          name: "loading",
          type: '"lazy" | "eager"',
          default: '"lazy"',
          description:
            "The `<img>` loading mode. Ignored when `priority` is set, which always loads eagerly.",
        },
        {
          name: "onLoad",
          type: "ReactEventHandler<HTMLImageElement>",
          description:
            "The `<img>`'s `load` event. It may not fire for an image that finished loading before React attached, such as a cached image in server-rendered HTML; the state still becomes loaded.",
        },
        {
          name: "onError",
          type: "ReactEventHandler<HTMLImageElement>",
          description: "The `<img>`'s `error` event.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the **root box**, not the `<img>`: size, radius, border, background.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            "Also the root. An inline `aspectRatio` here loses to the reserved one.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "`Image.Placeholder`, `Image.Error` and `Image.Invalid`.",
        },
        {
          name: "ref",
          type: "Ref<HTMLImageElement>",
          description:
            "The `<img>`, not the root. `null` while the image is in the error or invalid state, when no `<img>` is mounted.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<img>` attribute passes through to the `<img>`: `srcSet`, `sizes`, `crossOrigin`, `referrerPolicy`, `decoding`, `aria-*`. `draggable` is always `false`.",
    },
    { type: "h2", text: "Sizing the box" },
    {
      type: "p",
      text: 'The root is a block that is `w-full` by default, and its height follows from the ratio. Size it by width: `className="w-24"`, `max-w-md`, or let a grid cell decide. The ratio is applied as a locked inline `aspect-ratio`, so nothing in `className` or `style` can produce an unreserved box.',
    },
    {
      type: "code",
      label: "sizing.tsx",
      lang: "tsx",
      code: `// an avatar: remote URL, known shape
<Image src={user.avatarUrl} aspectRatio={1} alt="" className="w-12 rounded-full" />

// a static import cropped to a banner
<Image src={hero} aspectRatio="21 / 9" position="top" alt="" />

// fill: the parent owns the box
<View className="relative h-48">
  <Image src={cover.url} fill alt={cover.title} />
  <Caption className="absolute bottom-0" />
</View>`,
    },
    {
      type: "p",
      text: 'With the default `fit="cover"`, a ratio you had to guess for a remote image crops the photo slightly. It never distorts it and never shifts the layout.',
    },
    {
      type: "note",
      tone: "warn",
      text: "`fill` is the one form that can fail at runtime. If the parent is `position: static`, the image escapes to the nearest positioned ancestor and covers that instead. adaptv logs an error for this in development. It cannot check that the parent has a height; if it has none, the image is zero pixels tall.",
    },
    { type: "h2", text: "Load states" },
    {
      type: "table",
      head: ["State", "When", "What shows"],
      rows: [
        [
          "loading",
          "There is a `src` and it has neither loaded nor failed.",
          "The root's grey surface, the blurred placeholder if there is one, and `Image.Placeholder`.",
        ],
        [
          "loaded",
          "The `<img>` fired `load`, or was already complete from cache.",
          "The photo, faded in over `300ms`.",
        ],
        [
          "error",
          "The request or the decode failed.",
          "`Image.Error`. The `<img>` is unmounted.",
        ],
        [
          "invalid",
          "`src` is missing, empty, or a `data:` URL that is not `data:image/*`.",
          "`Image.Invalid`. Nothing is requested.",
        ],
      ],
    },
    {
      type: "ul",
      items: [
        "Changing `src` resets the state to loading in the same render, so the old photo is never shown as the new one.",
        "adaptv does not guess whether a string looks like a URL. Anything that is not empty and not a bad `data:` URL goes to the network, and a failure lands in error.",
        "There is no retry. To try again, change `src` (a cache-busting query is enough) or remount with a new `key`.",
        "Fades are skipped when the user asks for reduced motion.",
        "`alt` is applied only once the image is showing, and the root has `aria-busy` while loading.",
      ],
    },
    { type: "h2", text: "Slots" },
    {
      type: "p",
      text: "Three optional children draw over the same box. Each is a `<div>` that fills the root, inherits its radius, takes `className` and any other `<div>` attribute, and is hidden (`visibility: hidden`) unless its state is live.",
    },
    {
      type: "table",
      head: ["Slot", "Shown while", "Notes"],
      rows: [
        [
          "`Image.Placeholder`",
          "loading",
          "Sits under the photo and above the blur. Transparent by default so the blur shows through: use it for a shimmer, a logo or a spinner. It is `aria-hidden`.",
        ],
        [
          "`Image.Error`",
          "error",
          "Sits above everything, with the neutral grey surface.",
        ],
        [
          "`Image.Invalid`",
          "invalid",
          "The same, for a missing `src`: initials for a user with no avatar, a generic cover.",
        ],
      ],
    },
    {
      type: "code",
      label: "avatar.tsx",
      lang: "tsx",
      code: `<Image src={user.avatarUrl} aspectRatio={1} alt={user.name} className="w-12 rounded-full">
  <Image.Placeholder className="animate-pulse bg-gray-200" />
  <Image.Invalid className="flex items-center justify-center bg-indigo-100 text-indigo-700">
    {initials(user.name)}
  </Image.Invalid>
  <Image.Error className="flex items-center justify-center text-gray-400">
    <BrokenImageIcon />
  </Image.Error>
</Image>`,
    },
    {
      type: "p",
      text: "A slot's hidden state is locked, so a class cannot leave a placeholder painted over a loaded photo. When your own component inside a slot needs the state, read it with `useImage()`.",
    },
    {
      type: "api",
      name: "useImage()",
      signature: `function useImage(): {
  isLoading: boolean
  isImageVisible: boolean
  isPlaceholderVisible: boolean
  isInvalidVisible: boolean
  isErrorVisible: boolean
}`,
      description:
        "The live load state, for components rendered inside an `<Image>`. Exactly one of the four `is…Visible` flags is `true` at a time; `isLoading` equals `isPlaceholderVisible`. Throws when called outside an `<Image>`.",
    },
    { type: "h2", text: "Placeholders for remote images" },
    {
      type: "p",
      text: "`placeholder` takes a `data:image/*` URL. If your backend stores a tiny preview per image, send it as a data URL and pass it straight through.",
    },
    {
      type: "code",
      label: "remote-placeholder.tsx",
      lang: "tsx",
      code: `<Image
  src={photo.url}
  aspectRatio={photo.width / photo.height}
  placeholder={photo.previewDataUrl}
  alt={photo.caption}
/>`,
    },
    {
      type: "note",
      text: "BlurHash and ThumbHash strings are rejected with an error in development. Both need a JavaScript decoder, so they cannot paint until the bundle has downloaded and run, which is after the moment a placeholder is for. Convert them to a small data URL on the server.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Attribute", "On", "When"],
      rows: [
        ['`data-adaptv="image"`', "root", "Always."],
        [
          "`data-part`",
          "every element",
          '`"root"`, `"image"` (the `<img>`), `"lqip"` (the blur), `"placeholder"`, `"error"`, `"invalid"`.',
        ],
        ["`data-image-loading`", "root", "State is loading."],
        ["`data-image-loaded`", "root", "State is loaded."],
        ["`data-image-error`", "root", "State is error."],
        ["`data-image-invalid`", "root", "State is invalid."],
        [
          "`data-image-unreserved`",
          "root",
          "No box was reserved. Only reachable by getting around the types. Emitted in production too, so an end-to-end test can assert it never appears.",
        ],
      ],
    },
    {
      type: "p",
      text: "The state attributes are presence attributes, so Tailwind's `data-image-loaded:ring-1` works on the root. The root's defaults `block w-full bg-gray-50` can be overridden; `relative isolate overflow-hidden` and the ratio are locked. The `<img>` itself takes no classes from you: it is absolutely positioned inside the root, and `fit` and `position` control how the photo sits.",
    },
    { type: "h2", text: "What it does not emit" },
    {
      type: "ul",
      items: [
        '**No `decoding="async"`.** WebKit honours it only for animated images, so on iOS it would do nothing. Pass `decoding` yourself if you have measured a benefit.',
        "**No placeholder in `src`.** The `<img>`'s `src` is only ever the final URL, and the placeholder is a separate layer. Swapping a data URI for the real URL on a lazy image never loads on iOS 15.4 to 16.0.",
        "**No runtime blur filter.** The blur is in the placeholder's pixels, so no image costs a compositor layer.",
        "**No `srcset` generation or format conversion.** The import emits the original file. Pass `srcSet` and `sizes` yourself if you have variants.",
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "Write an `alt` for any image that carries meaning. Leave it out only for decoration.",
        "`Image.Error` and `Image.Invalid` are exposed to assistive technology while visible, so text inside them is announced. `Image.Placeholder` is always hidden from it.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "The component is layout plus one `<img>`, with no per-target branch, and behaves the same on all of them. `fetchpriority` is honoured from iOS 17.2 and ignored before it. iOS webviews do not report layout-shift entries, so to verify a screen there, compare the box's size before and after load, or assert that `data-image-unreserved` is absent.",
    },
  ],
}
