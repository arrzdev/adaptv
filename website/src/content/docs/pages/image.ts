import { ImageDemo } from "@/components/docs-demos/image-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "image",
  title: "Image",
  summary:
    "An `<img>` that reserves its box before the file loads, so nothing moves.",
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
      text: "A plain `<img>` has no height until it loads, then it pushes the page down ([layout shift](/docs/layout-shift)). `Image` always reserves a box, and the types allow only four ways to do it. `<Image src={url} />` alone does not compile.",
    },
    {
      type: "table",
      head: ["You write", "The box comes from"],
      rows: [
        ["`<Image src={asset} />`", "The size the build read from the file."],
        ["`<Image src={url} width={640} height={400} />`", "The pair."],
        [
          "`<Image src={url} aspectRatio={16 / 9} />`",
          "The ratio. Use it for remote images.",
        ],
        [
          "`<Image src={url} fill />`",
          "A parent that is positioned and has a height.",
        ],
      ],
    },
    {
      type: "p",
      text: "In the three URL forms, `src` can be `null` or `undefined`. The box stays.",
    },
    { type: "h3", text: "Import an image" },
    {
      type: "p",
      text: "Add `?adaptv-image` to an import. You get `{ src, width, height, lqip }` instead of a string. `width` and `height` reserve the box. `lqip` is a tiny blurred WebP that paints before the file loads. SVG, animated and very small images have no `lqip`. A file with no readable size fails the build. Set `images.placeholder` to `false` in [adaptv.config.ts](/docs/config) to skip `lqip`.",
    },
    {
      type: "code",
      label: "hero.tsx",
      lang: "tsx",
      code: `import hero from "./hero.jpg?adaptv-image"

<Image src={hero} alt="The harbour at dawn" />`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "src",
          type: "AdaptvImageAsset | string | null",
          description: "An import, or a URL.",
        },
        {
          name: "width",
          type: "number",
          description:
            "Intrinsic width in pixels. With `height` it sets the ratio. It does not set the rendered size.",
        },
        {
          name: "height",
          type: "number",
          description: "Intrinsic height in pixels.",
        },
        {
          name: "aspectRatio",
          type: 'number | "W / H"',
          description:
            'The box ratio, such as `16 / 9` or `"4 / 3"`. It wins over `width` and `height`.',
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Fill the parent (`absolute inset-0`). The parent must be positioned and have a height.",
        },
        {
          name: "alt",
          type: "string",
          default: '""',
          description: "Alternative text. Empty means decorative.",
        },
        {
          name: "fit",
          type: '"cover" | "contain" | "fill" | "none" | "scale-down"',
          default: '"cover"',
          description: "CSS `object-fit`.",
        },
        {
          name: "position",
          type: "string",
          default: '"center"',
          description: "CSS `object-position`.",
        },
        {
          name: "placeholder",
          type: "string | false",
          description:
            "A `data:image/*` URL to show while loading, or `false` for none. Defaults to the import's `lqip`. BlurHash and ThumbHash are not supported.",
        },
        {
          name: "priority",
          type: "boolean",
          default: "false",
          description:
            "For the largest image on first paint: eager load and high fetch priority.",
        },
        {
          name: "loading",
          type: '"lazy" | "eager"',
          default: '"lazy"',
          description: "Ignored when `priority` is set.",
        },
        {
          name: "className",
          type: "string",
          description: "Lands on the root box, not the `<img>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "`Image.Placeholder`, `Image.Error`, `Image.Invalid`.",
        },
        {
          name: "ref",
          type: "Ref<HTMLImageElement>",
          description:
            "The `<img>`. It is `null` in the error and invalid states.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<img>` attributes pass through to the `<img>`, such as `srcSet`, `sizes`, `onLoad` and `onError`. `draggable` is always `false`. adaptv does not make `srcset` variants.",
    },
    { type: "h2", text: "Slots and states" },
    {
      type: "p",
      text: "Size the root by width (`w-24`, `max-w-md`). The ratio sets the height. Each slot is a `<div>` that fills the root. It takes `className` and any `<div>` attribute, and it is hidden unless its state is live. Changing `src` resets the state to loading. There is no retry: change `src` or remount.",
    },
    {
      type: "table",
      head: ["State", "When", "Shows"],
      rows: [
        [
          "loading",
          "`src` has not loaded or failed.",
          "The blur and `Image.Placeholder`. The placeholder is transparent by default.",
        ],
        ["loaded", "The image loaded.", "The photo, faded in."],
        ["error", "The request or decode failed.", "`Image.Error`."],
        [
          "invalid",
          "`src` is empty, or a `data:` URL that is not an image.",
          "`Image.Invalid`. Nothing is requested.",
        ],
      ],
    },
    {
      type: "code",
      label: "avatar.tsx",
      lang: "tsx",
      code: `<Image src={user.avatarUrl} aspectRatio={1} alt={user.name} className="w-12 rounded-full">
  <Image.Placeholder className="animate-pulse bg-gray-200" />
  <Image.Invalid className="flex items-center justify-center bg-indigo-100">
    {initials(user.name)}
  </Image.Invalid>
</Image>`,
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
        "The live state, for components inside an `<Image>`. One `is…Visible` flag is true at a time. It throws outside an `<Image>`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "With `fill`, a `position: static` parent lets the image escape to the nearest positioned ancestor. adaptv logs an error in development.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`data-adaptv="image"` is on the root. Every part has `data-part`: `root`, `image`, `lqip`, `placeholder`, `error`, `invalid`. The root has one of `data-image-loading`, `data-image-loaded`, `data-image-error` or `data-image-invalid`, so `data-image-loaded:ring-1` works. The defaults `block w-full bg-gray-50` can be overridden. `relative isolate overflow-hidden` and the ratio are locked.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "The same on every target. `fetchpriority` works from iOS 17.2.",
    },
  ],
}
