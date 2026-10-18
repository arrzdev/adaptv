import { FolderGit2, Layers } from "lucide-react"
import type { ReactNode } from "react"
import { Reveal } from "@/components/reveal"

type Glyph = "npm" | "avatars" | "folder" | "targets"

//PLACEHOLDER (board request): fake numbers, replace with real data before this ships
//adaptv is not on npm yet, so none of these counts exist. Every number on the band is in
//this one constant, so replacing them is one edit.
export const STATS: readonly {
  value: string
  /** words between the number and the glyph */
  before?: string
  glyph: Glyph
  label: string
}[] = [
  { value: "120K+", before: "weekly", glyph: "npm", label: "downloads" },
  { value: "18K+", glyph: "avatars", label: "developers" },
  { value: "4,500+", glyph: "folder", label: "apps shipped" },
  { value: "6", glyph: "targets", label: "targets, one codebase" },
]

/** The mark sits in a tile one em tall, so it scales with the line it is set in. */
function Tile({ children }: { children: ReactNode }) {
  return (
    <span className="inline-grid size-[0.92em] place-items-center rounded-[0.24em] border border-border-strong bg-card text-foreground">
      {children}
    </span>
  )
}

/** npm's mark from simple-icons, in its brand red. */
function NpmMark() {
  return (
    <span className="inline-grid size-[0.92em] place-items-center rounded-[0.24em] bg-[#cb3837]">
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="size-[0.62em] fill-white"
      >
        <path d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z" />
      </svg>
    </span>
  )
}

//abstract people, not photographs: a gradient disc with a letter, each its own pair of hues
const FACES = [
  { letter: "A", from: "#5b6cff", to: "#b65cff" },
  { letter: "M", from: "#ff6a9a", to: "#ffb86a" },
  { letter: "K", from: "#12996a", to: "#7fc4f5" },
] as const

function Avatars() {
  return (
    <span className="inline-flex">
      {FACES.map((face, index) => (
        <span
          key={face.letter}
          className="grid size-[0.92em] place-items-center rounded-full ring-[0.05em] ring-background"
          style={{
            backgroundImage: `linear-gradient(135deg, ${face.from}, ${face.to})`,
            marginLeft: index === 0 ? 0 : "-0.28em",
          }}
        >
          <span className="text-[0.4em] text-white tracking-normal">
            {face.letter}
          </span>
        </span>
      ))}
    </span>
  )
}

function GlyphFor({ glyph }: { glyph: Glyph }) {
  if (glyph === "npm") return <NpmMark />
  if (glyph === "avatars") return <Avatars />
  return (
    <Tile>
      {glyph === "folder" ? (
        <FolderGit2 className="size-[0.55em]" strokeWidth={2} />
      ) : (
        <Layers className="size-[0.55em]" strokeWidth={2} />
      )}
    </Tile>
  )
}

/**
 * The numbers band, after expo.dev's: one big centred line per figure, the number, a
 * small mark, then what it counts. Set in container units so the longest line still fits
 * one line on a 320 px phone; each line is one line at every width (`whitespace-nowrap`).
 */
export function Stats() {
  return (
    <section className="sheet @container">
      <ul className="flex flex-col items-center gap-[0.32em] px-4 py-16 text-center font-semibold text-[clamp(1.25rem,7cqi,4.25rem)] leading-[1.1] tracking-[-0.04em] md:px-10 md:py-24">
        {STATS.map((stat, index) => (
          <li key={stat.label}>
            <Reveal delay={index * 0.06}>
              <span className="inline-flex items-center gap-[0.28em] whitespace-nowrap">
                <span className="text-foreground tabular-nums">
                  {stat.value}
                </span>
                {stat.before ? (
                  <span className="text-muted">{stat.before}</span>
                ) : null}
                <GlyphFor glyph={stat.glyph} />
                <span className="text-muted">{stat.label}</span>
              </span>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  )
}
