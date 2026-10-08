import { Drawer, ExternalLink, Link, ScrollView, View } from "adaptv/components"
import {
  ArrowLeft,
  ArrowRight,
  Github,
  LayoutGrid,
  Menu,
  Search,
} from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { headingIds, Prose } from "@/components/prose"
import { SitePage } from "@/components/site-page"
import { ALL_DOCS, DOCS, type DocPage } from "@/content/docs"
import { GITHUB_URL } from "@/content/site"
import { cn } from "@/utils/cn"

function matches(page: DocPage, query: string) {
  const haystack = [
    page.title,
    page.summary,
    ...page.blocks.flatMap((block) =>
      block.type === "h2" || block.type === "h3"
        ? [block.text]
        : block.type === "api"
          ? [block.name]
          : [],
    ),
  ]
    .join(" ")
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

function NavLink({ item, active }: { item: DocPage; active: boolean }) {
  return (
    <Link
      to="/docs/$slug"
      params={{ slug: item.slug }}
      className={cn(
        "-ml-px border-l py-1.5 pl-4 text-[14px]",
        active
          ? "border-brand font-medium text-foreground"
          : "border-transparent text-subtle hover:border-border-strong hover:text-foreground",
      )}
    >
      {item.title}
    </Link>
  )
}

/** The sidebar's contents, shared by the desktop rail and the mobile sheet. */
const SECTIONS = ["Guides", "Reference"] as const

function DocsNav({ current }: { current: string }) {
  const [query, setQuery] = useState("")
  const home =
    DOCS.find((group) => group.pages.some((item) => item.slug === current))
      ?.section ?? "Guides"
  const [section, setSection] = useState<(typeof SECTIONS)[number]>(home)
  const results = useMemo(
    () =>
      query.trim() ? ALL_DOCS.filter((item) => matches(item, query)) : null,
    [query],
  )

  return (
    <View className="gap-6">
      <label className="flex h-9 flex-row items-center gap-2 rounded-lg border border-border bg-surface px-3 text-muted focus-within:border-border-strong">
        <Search className="size-3.5 shrink-0" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the docs"
          className="selectable min-w-0 flex-1 bg-transparent text-[13.5px] text-foreground outline-none placeholder:text-muted"
        />
      </label>

      {results ? (
        <View className="gap-1">
          {results.length === 0 ? (
            <span className="text-[13.5px] text-muted">Nothing matches.</span>
          ) : (
            results.map((item) => (
              <Link
                key={item.slug}
                to="/docs/$slug"
                params={{ slug: item.slug }}
                className="flex flex-col gap-0.5 rounded-lg px-3 py-2 hover:bg-sunken"
              >
                <span className="font-medium text-[14px]">{item.title}</span>
                <span className="line-clamp-2 text-[12.5px] text-muted">
                  {item.summary}
                </span>
              </Link>
            ))
          )}
        </View>
      ) : (
        <>
          <Link
            to="/docs"
            className={cn(
              "-mb-2 flex flex-row items-center gap-2.5 rounded-lg px-3 py-2 font-medium text-[14px]",
              current === ""
                ? "bg-sunken text-foreground"
                : "text-subtle hover:bg-sunken hover:text-foreground",
            )}
          >
            <LayoutGrid className="size-4 text-muted" />
            Overview
          </Link>
          <View row className="gap-1 rounded-lg bg-sunken p-1">
            {SECTIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setSection(name)}
                className={cn(
                  "flex-1 cursor-pointer rounded-md py-1.5 font-medium text-[13px] text-muted",
                  name === section && "bg-raised text-foreground shadow-sm",
                )}
              >
                {name}
              </button>
            ))}
          </View>
          {DOCS.filter((group) => group.section === section).map((group) => (
            <View key={group.title} className="gap-2">
              <span className="font-mono text-[11px] text-muted uppercase tracking-[0.14em]">
                {group.title}
              </span>
              <View className="border-border border-l">
                {group.pages.map((item) => (
                  <NavLink
                    key={item.slug}
                    item={item}
                    active={item.slug === current}
                  />
                ))}
              </View>
            </View>
          ))}
        </>
      )}
    </View>
  )
}

function MobileNav({ current, label }: { current: string; label: string }) {
  const [open, setOpen] = useState(false)
  //Link has no press callback to hang a close on, so the sheet closes when the page it
  //navigated to arrives
  // biome-ignore lint/correctness/useExhaustiveDependencies: the slug IS the trigger
  useEffect(() => setOpen(false), [current])
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 cursor-pointer flex-row items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 font-medium text-[14px] lg:hidden"
      >
        <Menu className="size-4 text-muted" />
        {label}
      </button>
      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="bg-black/60" />
          <Drawer.Content className="max-h-[85dvh] rounded-t-[28px] border-border border-t bg-background text-foreground">
            <Drawer.Handle className="mt-2.5 bg-border-strong" />
            <Drawer.Shell className="px-6 pt-5 pb-10">
              <Drawer.Title className="sr-only">Documentation</Drawer.Title>
              <DocsNav current={current} />
            </Drawer.Shell>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  )
}

function OnThisPage({ page }: { page: DocPage }) {
  const ids = headingIds(page.blocks)
  const headings = page.blocks.flatMap((block, index) => {
    const id = ids[index]
    if (!id) return []
    if (block.type === "h2")
      return [{ id, text: block.text.replace(/`/g, ""), depth: 0, mono: false }]
    if (block.type === "h3")
      return [{ id, text: block.text.replace(/`/g, ""), depth: 1, mono: false }]
    if (block.type === "api")
      return [{ id, text: block.name, depth: 1, mono: true }]
    return []
  })
  if (headings.length < 2) return null
  return (
    <View className="gap-2.5">
      <span className="pb-1 font-mono text-[11px] text-muted uppercase tracking-[0.14em]">
        On this page
      </span>
      {headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          // The document never scrolls in an adaptv app, so a #hash link has nothing to
          // move. scrollIntoView walks up to the page's own scroller instead.
          onClick={() =>
            document
              .getElementById(heading.id)
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className={cn(
            "cursor-pointer text-left text-[13.5px] text-subtle leading-snug hover:text-foreground",
            heading.depth === 1 && "pl-3 text-[13px] text-muted",
            heading.mono && "font-mono text-[12px]",
          )}
        >
          {heading.text}
        </button>
      ))}
    </View>
  )
}

function Pager({ page }: { page: DocPage }) {
  const index = ALL_DOCS.findIndex((item) => item.slug === page.slug)
  const previous = ALL_DOCS[index - 1]
  const next = ALL_DOCS[index + 1]
  const card =
    "flex min-w-0 flex-1 flex-col gap-1 rounded-xl border border-border px-5 py-4 hover:border-border-strong hover:bg-surface"
  return (
    <View row className="mt-16 gap-4 border-border border-t pt-8">
      {previous ? (
        <Link
          to="/docs/$slug"
          params={{ slug: previous.slug }}
          className={card}
        >
          <span className="flex flex-row items-center gap-1.5 text-[12.5px] text-muted">
            <ArrowLeft className="size-3.5" />
            Previous
          </span>
          <span className="truncate font-medium text-[15px]">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link
          to="/docs/$slug"
          params={{ slug: next.slug }}
          className={cn(card, "items-end text-right")}
        >
          <span className="flex flex-row items-center gap-1.5 text-[12.5px] text-muted">
            Next
            <ArrowRight className="size-3.5" />
          </span>
          <span className="truncate font-medium text-[15px]">{next.title}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </View>
  )
}

const PLATFORM_TONE = {
  Web: "border-[#e0a23a]/40 bg-[#e0a23a]/10 text-[#e0a23a]",
  PWA: "border-brand/40 bg-brand-soft text-brand",
  iOS: "border-[#38b6ff]/40 bg-[#38b6ff]/10 text-[#38b6ff]",
  Android: "border-success/40 bg-success-soft text-success",
} as const

function PageMeta({ page }: { page: DocPage }) {
  if (!page.platforms && !page.importLine && !page.source) return null
  return (
    <View className="gap-4 border-border border-b pb-6">
      <View row className="flex-wrap items-center gap-2">
        {page.platforms?.map((platform) => (
          <span
            key={platform}
            className={cn(
              "rounded-full border px-2.5 py-0.5 font-medium text-[12px]",
              PLATFORM_TONE[platform],
            )}
          >
            {platform}
          </span>
        ))}
        {page.source ? (
          <ExternalLink
            href={`${GITHUB_URL}/blob/main/${page.source}`}
            className="ml-1 flex flex-row items-center gap-1.5 text-[13px] text-muted hover:text-foreground"
          >
            <Github className="size-3.5" />
            Source
          </ExternalLink>
        ) : null}
      </View>
      {page.importLine ? (
        <pre className="selectable overflow-x-auto rounded-xl border border-border bg-sunken px-4 py-3 font-mono text-[13px] text-subtle">
          {page.importLine}
        </pre>
      ) : null}
    </View>
  )
}

/**
 * The docs chrome: the sidebar rail on desktop, the sheet on a phone, and an optional
 * right-hand column. `current` is the open page's slug, or "" on the overview.
 */
export function DocsShell({
  current,
  label,
  aside,
  children,
}: {
  current: string
  label: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <SitePage>
      <View className="mx-auto w-full max-w-[1440px] flex-row gap-10 px-5 py-8 md:px-8 lg:py-10 xl:gap-14">
        <nav className="hidden w-64 shrink-0 border-border border-r lg:block">
          <ScrollView className="sticky top-24 max-h-[calc(100dvh-7.5rem)] pr-6 pb-6">
            <DocsNav current={current} />
          </ScrollView>
        </nav>

        <article className="flex min-w-0 flex-1 flex-col">
          <View className="pb-4 lg:hidden">
            <MobileNav current={current} label={label} />
          </View>
          {children}
        </article>

        {aside ? (
          <aside className="hidden w-48 shrink-0 xl:block">
            <View className="sticky top-24">{aside}</View>
          </aside>
        ) : null}
      </View>
    </SitePage>
  )
}

export function DocsLayout({ page }: { page: DocPage }) {
  const group = DOCS.find((item) => item.pages.includes(page))
  return (
    <DocsShell
      current={page.slug}
      label={page.title}
      aside={<OnThisPage page={page} />}
    >
      <View className="gap-4 pb-8">
        {group ? (
          <span className="font-mono text-[11.5px] text-brand uppercase tracking-[0.14em]">
            {group.title}
          </span>
        ) : null}
        <h1 className="font-semibold text-[clamp(2rem,4vw,2.75rem)] text-foreground leading-[1.05] tracking-[-0.035em]">
          {page.title}
        </h1>
        <p className="max-w-2xl text-[18px] text-muted leading-relaxed">
          {page.summary}
        </p>
        <PageMeta page={page} />
      </View>
      <View className="max-w-3xl">
        <Prose blocks={page.blocks} />
        <Pager page={page} />
      </View>
    </DocsShell>
  )
}
