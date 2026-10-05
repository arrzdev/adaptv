/**
 * Types `import hero from "./hero.jpg?adaptv-image"` without the consumer having
 * to import the plugin's types by hand.
 *
 * Reaches the consumer through `interface/route-globals.d.ts`, which references every
 * `virtual-adaptv-*.d.ts` and is the one file an app's tsconfig already includes, so it
 * needs no wiring at all. `?adaptv-image` is a specifier only adaptv's Vite plugin knows how
 * to resolve, which is the same category as the virtual modules beside it — a new
 * package export would have been one more line every consumer must remember.
 *
 * ⚠︎ The shape is written out rather than imported from
 * `#adaptv/components/image.tsx`, and that duplication is deliberate: an ambient
 * declaration has to resolve inside the CONSUMER's tsconfig, where adaptv's own
 * `#adaptv/*` self-alias does not exist. Keep it in step with `AdaptvImageAsset`
 * — that type is the canonical one, this is the ambient mirror.
 */
declare module "*?adaptv-image" {
  const asset: {
    /** The emitted asset URL — hashed and base-prefixed by Vite. */
    src: string
    /** Intrinsic width in CSS pixels, EXIF orientation already applied. */
    width: number
    /** Intrinsic height in CSS pixels, EXIF orientation already applied. */
    height: number
    /**
     * A 16 px WebP `data:` URL with the blur baked in. Absent for vectors,
     * animations and sources already smaller than the placeholder would be.
     */
    lqip?: string
  }
  export default asset
}
