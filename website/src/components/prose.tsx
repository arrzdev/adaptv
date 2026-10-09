import { ExternalLink, Link, View } from "adaptv/components"
import { Check, Minus, TriangleAlert, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { CodePanel } from "@/components/code"
import type { Block, PropRow, TargetRow } from "@/content/blocks"
import { cn } from "@/utils/cn"

/** "Drag to dismiss" → "drag-to-dismiss". Headings and the table of contents share it. */
function headingId(text: string) {
  return text
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g

/** The three inline marks content may use: `code`, **bold**, [label](href). */
export function Inline({ text }: { text: string }): ReactNode {
  return text.split(INLINE).map((part, index) => {
    //a split string never reorders, so the index is a stable key
    const key = index
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded-md border border-border bg-sunken px-1.5 py-0.5 font-mono text-[0.86em] text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const [, label, href] = link
      const className =
        "font-medium text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-brand"
      return href.startsWith("/") ? (
        <Link key={key} to={href} className={className}>
          {label}
        </Link>
      ) : (
        <ExternalLink key={key} href={href} className={className}>
          {label}
        </ExternalLink>
      )
    }
    return part
  })
}

/**
 * One id per block, `undefined` for blocks that are not headings. A page may repeat a
 * heading ("Props" under each sub-component), so repeats get a numeric suffix; the
 * article and the table of contents both read ids from here and therefore agree.
 */
export function headingIds(blocks: Block[]): (string | undefined)[] {
  const seen = new Map<string, number>()
  return blocks.map((block) => {
    const text =
      block.type === "h2" || block.type === "h3"
        ? block.text
        : block.type === "api"
          ? block.name
          : undefined
    if (text === undefined) return undefined
    const base = headingId(text)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base}-${count}`
  })
}

/** Renders long-form content blocks. `selectable`: this is text people copy. */
export function Prose({ blocks }: { blocks: Block[] }) {
  const ids = headingIds(blocks)
  return (
    <View className="selectable gap-5">
      {blocks.map((block, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static content, never reordered
        <ProseBlock key={index} block={block} id={ids[index]} />
      ))}
    </View>
  )
}

const CELL = "border-border border-t px-4 py-3 align-top"

/** "`render`", one code token: the only first cell that stays on one line. */
const CODE_TOKEN = /^`[^`]+`$/

/**
 * A table too wide for its column scrolls sideways. The fade at the right edge says
 * so, and goes once the last column is in view.
 */
function TableShell({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    const node = scroller.current
    if (!node) return
    //a pixel of slack: zoomed layouts report fractional widths
    const measure = () =>
      setMore(node.scrollLeft + node.clientWidth < node.scrollWidth - 1)
    measure()
    node.addEventListener("scroll", measure, { passive: true })
    const resize = new ResizeObserver(measure)
    resize.observe(node)
    return () => {
      node.removeEventListener("scroll", measure)
      resize.disconnect()
    }
  }, [])
  return (
    <div className={cn("relative", className)}>
      <div
        ref={scroller}
        className="overflow-x-auto rounded-xl border border-border"
      >
        <table className="w-full border-collapse text-left text-[14px]">
          {children}
        </table>
      </div>
      <div
        aria-hidden
        data-testid="scroll-fade"
        data-more={more}
        className={cn(
          "pointer-events-none absolute inset-y-px right-px w-12 rounded-r-xl bg-linear-to-l from-background to-transparent transition-opacity",
          more ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  )
}

/** Props below `sm`: a table of four columns does not fit a phone, so one card each. */
function PropCards({ rows }: { rows: PropRow[] }) {
  return (
    <div
      data-props-cards
      className="overflow-hidden rounded-xl border border-border sm:hidden"
    >
      {rows.map((row) => (
        <div
          key={row.name}
          className="flex flex-col gap-1.5 border-border px-4 py-3 [&:not(:first-child)]:border-t"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[13px] text-foreground">
              {row.name}
              {row.required ? <span className="text-danger">*</span> : null}
            </span>
            <span className="break-words font-mono text-[12.5px] text-brand">
              {row.type}
            </span>
          </div>
          {row.default ? (
            <span className="font-mono text-[12.5px] text-muted">
              Default {row.default}
            </span>
          ) : null}
          <p className="text-[14px] text-subtle leading-relaxed">
            <Inline text={row.description} />
          </p>
        </div>
      ))}
    </div>
  )
}

function HeadRow({ cells }: { cells: string[] }) {
  return (
    <thead>
      <tr className="bg-sunken">
        {cells.map((cell) => (
          <th
            key={cell}
            className="whitespace-nowrap px-4 py-2.5 font-medium font-mono text-[11.5px] text-muted uppercase tracking-[0.1em]"
          >
            {cell}
          </th>
        ))}
      </tr>
    </thead>
  )
}

const STATUS = {
  yes: { icon: Check, label: "Works", tone: "text-success" },
  partial: { icon: Minus, label: "Partial", tone: "text-[#e0a23a]" },
  no: { icon: X, label: "No-op", tone: "text-muted" },
} as const

function Targets({ rows }: { rows: TargetRow[] }) {
  return (
    <View className="overflow-hidden rounded-xl border border-border">
      {rows.map((row) => {
        const status = STATUS[row.status]
        return (
          <View
            key={row.target}
            className="gap-1 border-border px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 [&:not(:first-child)]:border-t"
          >
            <View row className="w-44 shrink-0 items-center gap-2.5">
              <status.icon
                className={cn("size-4 shrink-0", status.tone)}
                strokeWidth={2.5}
              />
              <span className="font-medium text-[14px] text-foreground">
                {row.target}
              </span>
            </View>
            <span className="text-[14px] text-muted leading-relaxed">
              {row.note ? <Inline text={row.note} /> : status.label}
            </span>
          </View>
        )
      })}
    </View>
  )
}

function ProseBlock({ block, id }: { block: Block; id?: string }) {
  switch (block.type) {
    case "h2":
      return (
        <h2
          id={id}
          className="mt-8 scroll-mt-24 font-semibold text-[25px] text-foreground tracking-[-0.025em]"
        >
          <Inline text={block.text} />
        </h2>
      )
    case "h3":
      return (
        <h3
          id={id}
          className="mt-3 scroll-mt-24 font-semibold text-[18px] text-foreground tracking-[-0.015em]"
        >
          <Inline text={block.text} />
        </h3>
      )
    case "p":
      return (
        <p className="text-[16px] text-subtle leading-[1.75]">
          <Inline text={block.text} />
        </p>
      )
    case "ul":
    case "ol": {
      const List = block.type
      return (
        <List
          className={cn(
            "flex flex-col gap-2.5 pl-5 text-[16px] text-subtle leading-[1.7] marker:text-muted",
            block.type === "ul" ? "list-disc" : "list-decimal",
          )}
        >
          {block.items.map((item) => (
            <li key={item} className="pl-1">
              <Inline text={item} />
            </li>
          ))}
        </List>
      )
    }
    case "code":
      return (
        <CodePanel
          samples={[{ label: block.label, lang: block.lang, code: block.code }]}
        />
      )
    case "note": {
      const warn = block.tone === "warn"
      return (
        <View
          row
          className={cn(
            "items-start gap-3 rounded-xl border px-5 py-4 text-[15px] leading-relaxed",
            warn
              ? "border-[#e0a23a]/40 bg-[#e0a23a]/10"
              : "border-brand/30 bg-brand-soft",
          )}
        >
          {warn ? (
            <TriangleAlert className="mt-1 size-4 shrink-0 text-[#e0a23a]" />
          ) : null}
          <p className="text-foreground">
            <Inline text={block.text} />
          </p>
        </View>
      )
    }
    case "props":
      return (
        <>
          <PropCards rows={block.rows} />
          <TableShell className="max-sm:hidden">
            <HeadRow cells={["Prop", "Type", "Default", "Description"]} />
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.name}>
                  <td
                    className={cn(
                      CELL,
                      "whitespace-nowrap font-mono text-[13px] text-foreground",
                    )}
                  >
                    {row.name}
                    {row.required ? (
                      <span className="text-danger">*</span>
                    ) : null}
                  </td>
                  <td
                    className={cn(CELL, "font-mono text-[12.5px] text-brand")}
                  >
                    {row.type}
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "whitespace-nowrap font-mono text-[12.5px] text-muted",
                    )}
                  >
                    {row.default ?? "—"}
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "min-w-[16rem] text-subtle leading-relaxed",
                    )}
                  >
                    <Inline text={row.description} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </>
      )
    case "table":
      return (
        <TableShell>
          <HeadRow cells={block.head} />
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join("|")}>
                {row.map((cell, index) => (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns never reorder
                    key={index}
                    className={cn(
                      CELL,
                      "text-subtle leading-relaxed",
                      index === 0 && "text-foreground",
                      index === 0 &&
                        CODE_TOKEN.test(cell) &&
                        "whitespace-nowrap",
                    )}
                  >
                    <Inline text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </TableShell>
      )
    case "demo":
      return (
        <View className="overflow-hidden rounded-2xl border border-border">
          <View className="dots relative min-h-[220px] items-center justify-center bg-surface p-6 sm:p-10">
            {/* a demo is UI, not prose: it opts back out of text selection */}
            <View className="w-full select-none items-center">
              <block.component />
            </View>
          </View>
          {block.code ? (
            <CodePanel
              className="rounded-none border-0 border-white/10 border-t shadow-none"
              samples={[
                {
                  label: "Source",
                  lang: block.lang ?? "tsx",
                  code: block.code,
                },
              ]}
            />
          ) : null}
        </View>
      )
    case "api":
      return (
        <View className="mt-4 gap-3">
          <h3
            id={id}
            className="scroll-mt-24 font-medium font-mono text-[17px] text-foreground"
          >
            {block.name}
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-border bg-sunken px-4 py-3 font-mono text-[13px] text-subtle leading-relaxed">
            {block.signature}
          </pre>
          <p className="text-[16px] text-subtle leading-[1.75]">
            <Inline text={block.description} />
          </p>
          {block.params?.length ? (
            <ProseBlock block={{ type: "props", rows: block.params }} />
          ) : null}
          {block.returns ? (
            <p className="text-[15px] text-subtle leading-relaxed">
              <span className="mr-2 font-mono text-[11.5px] text-muted uppercase tracking-[0.1em]">
                Returns
              </span>
              <Inline text={block.returns} />
            </p>
          ) : null}
        </View>
      )
    case "targets":
      return <Targets rows={block.rows} />
  }
}
