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
import { Inline } from "@/components/inline"
import { OnThisPage } from "@/components/on-this-page"
import { Prose } from "@/components/prose"
import { SitePage } from "@/components/site-page"
import { WholeTokens } from "@/components/whole-tokens"
import { ALL_DOCS, DOCS, type DocPage } from "@/content/docs"
import { GITHUB_URL } from "@/content/site"
import { cn } from "@/utils/cn"
import { scrollRegion } from "./scroll-region"

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
      {/* the input drops its own ring (it would hug the text, not the field), so the
          field draws the site's 2 px --adaptv-ring, inset: the scrolling sidebar clips
          anything drawn outside the field's box */}
      <label className="flex h-9 flex-row items-center gap-2 rounded-lg border border-border bg-surface px-3 text-muted focus-within:border-border-strong has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-(--adaptv-ring)">
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
                  <Inline text={item.summary} />
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
              <span className="font-mono text-[12px] text-muted uppercase tracking-[0.08em]">
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

export function Pager({ page }: { page: DocPage }) {
  const index = ALL_DOCS.findIndex((item) => item.slug === page.slug)
  const previous = ALL_DOCS[index - 1]
  const next = ALL_DOCS[index + 1]
  const card =
    "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border border-border px-3 py-2 text-foreground hover:border-border-strong hover:bg-surface"
  return (
    <View row className="mt-12 gap-3 border-border border-t pt-5">
      {previous ? (
        <Link
          to="/docs/$slug"
          params={{ slug: previous.slug }}
          className={card}
        >
          <span className="flex flex-row items-center gap-1.5 text-[12px] text-muted">
            <ArrowLeft className="size-3" />
            Previous
          </span>
          <span className="truncate font-medium text-[13.5px]">
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
          <span className="flex flex-row items-center gap-1.5 text-[12px] text-muted">
            Next
            <ArrowRight className="size-3" />
          </span>
          <span className="truncate font-medium text-[13.5px]">
            {next.title}
          </span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </View>
  )
}

//The hue sits on the border and the dot; the label is --foreground, so every pill reads
//at 4.5:1 or better in both themes (TUD-1626).
const PLATFORM_TONE = {
  Web: { pill: "border-[#e0a23a]/50 bg-[#e0a23a]/10", dot: "bg-[#e0a23a]" },
  PWA: { pill: "border-brand/50 bg-brand-soft", dot: "bg-brand" },
  iOS: { pill: "border-[#38b6ff]/50 bg-[#38b6ff]/10", dot: "bg-[#38b6ff]" },
  Android: { pill: "border-success/50 bg-success-soft", dot: "bg-success" },
} as const

function PageMeta({ page }: { page: DocPage }) {
  if (!page.platforms && !page.importLine && !page.source) return null
  return (
    <View className="gap-4 border-border border-b pb-6">
      <View row className="flex-wrap items-center gap-2">
        {page.platforms?.map((platform) => (
          <span
            key={platform}
            data-platform={platform}
            className={cn(
              "flex flex-row items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium text-[12px] text-foreground",
              PLATFORM_TONE[platform].pill,
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                PLATFORM_TONE[platform].dot,
              )}
            />
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
        <pre
          {...scrollRegion("Import")}
          className="selectable overflow-x-auto rounded-xl border border-border bg-sunken px-4 py-3 font-mono text-[13px] text-subtle"
        >
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
      {/* on the header's lines (`site-container`): the rail starts under the logo's pill edge
          and the on-this-page column ends under the theme toggle's */}
      <View className="site-container flex-row gap-10 py-8 lg:py-10">
        <nav className="hidden w-64 shrink-0 border-border border-r lg:block">
          <ScrollView className="sticky top-24 max-h-[calc(100dvh-7.5rem)] pr-6 pb-6">
            <DocsNav current={current} />
          </ScrollView>
        </nav>

        <article
          data-skip-target=""
          tabIndex={-1}
          className="flex min-w-0 flex-1 flex-col outline-none"
        >
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
      aside={<OnThisPage blocks={page.blocks} />}
    >
      <View className="gap-4 pb-8">
        {group ? (
          <span className="font-mono text-[12px] text-brand uppercase tracking-[0.08em]">
            {group.title}
          </span>
        ) : null}
        <h1 className="text-balance font-semibold text-[clamp(2rem,4vw,2.75rem)] text-foreground leading-[1.05] tracking-[-0.035em]">
          <WholeTokens text={page.title} />
        </h1>
        <p className="max-w-2xl text-[18px] text-muted leading-relaxed">
          <Inline text={page.summary} />
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
