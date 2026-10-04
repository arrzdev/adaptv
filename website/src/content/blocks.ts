import type { ComponentType } from "react"
import type { CodeLang } from "@/components/code"

/*
 * Long-form content is data: an array of blocks rendered by components/prose.tsx. It is
 * server-rendered with no async step, and a page can hold a LIVE component next to the
 * prose that describes it, which a markdown pipeline would need MDX to do.
 *
 * Text fields (`text`, list items, table cells, descriptions) take three inline marks:
 * `code`, **bold** and [label](href). An href starting with "/" is an in-app link.
 */
export type PropRow = {
  name: string
  type: string
  /** Omit when there is none. */
  default?: string
  required?: boolean
  description: string
}

export type TargetName =
  | "Desktop web"
  | "Mobile web"
  | "Installed PWA"
  | "iOS"
  | "Android"

export type TargetRow = {
  target: TargetName
  /** "yes" works, "partial" works with the caveat in `note`, "no" is a no-op or unsupported. */
  status: "yes" | "partial" | "no"
  note?: string
}

export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; label: string; lang: CodeLang; code: string }
  | { type: "note"; text: string; tone?: "info" | "warn" }
  /** An API table: props, options, return fields. */
  | { type: "props"; rows: PropRow[] }
  | { type: "table"; head: string[]; rows: string[][] }
  /** A running component, with the source that produced it underneath. */
  | { type: "demo"; component: ComponentType; code?: string; lang?: CodeLang }
  /**
   * One function, method or hook in a reference page: a mono heading that joins the
   * table of contents, its signature, what it does, then its parameters and return value.
   */
  | {
      type: "api"
      /** Heading and anchor: "impact()", "useHaptics()", "router.preload". */
      name: string
      /** The TypeScript signature, shown as code. */
      signature: string
      description: string
      params?: PropRow[]
      /** What it returns, in a sentence. Inline marks allowed. */
      returns?: string
    }
  /** Where it works, target by target. Use it when the targets genuinely differ. */
  | { type: "targets"; rows: TargetRow[] }
