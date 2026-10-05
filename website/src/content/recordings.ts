/*
 * The real screen recordings the landing plays. A section whose clips are not all
 * here is not shipped: the page has no placeholder art. Drop the files into
 * `public/recordings/` and fill the entry, and the section turns on by itself.
 *
 * `VITE_SITE_DRAFTS=1` at build time renders the sections anyway, with empty
 * frames, so the layout can be checked before the recordings exist.
 */
export type Clip = {
  /** An H.264 MP4 under `public/`, muted, cut to loop. */
  src: string
  /** The first frame a viewer sees, and the only one under reduced motion. */
  poster: string
}

export const RECORDINGS: {
  /** A8: one playground screen resized phone → tablet → desktop → back. */
  adapts: Clip | null
  /** A9: the three phone clips of `/lab/landing` in the playground. */
  haptics: Clip | null
  share: Clip | null
  keyboard: Clip | null
} = {
  adapts: null,
  haptics: null,
  share: null,
  keyboard: null,
}

export const SHOW_DRAFTS = import.meta.env.VITE_SITE_DRAFTS === "1"
