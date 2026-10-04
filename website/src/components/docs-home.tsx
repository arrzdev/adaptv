import { Link, View } from "@arrzdev/adaptv/components"
import {
  ArrowRight,
  Blocks,
  BookOpen,
  Compass,
  type LucideIcon,
  Rocket,
  Settings2,
  Ship,
  Webhook,
  Zap,
} from "lucide-react"
import { DocsShell } from "@/components/docs-layout"
import { ALL_DOCS, DOCS } from "@/content/docs"

/*
 * The docs overview. Built from DOCS, so a page registered in the index shows up here
 * without anyone remembering to list it. Only the two lead cards name slugs, and they
 * drop out if the slug is not registered.
 */
const GROUP_ART: Record<string, { icon: LucideIcon; blurb: string }> = {
  "Get started": {
    icon: Rocket,
    blurb: "What adaptv is, and the shortest path to a running app.",
  },
  Concepts: {
    icon: Compass,
    blurb: "The frame, routing, rendering, styling and the keyboard.",
  },
  Shipping: {
    icon: Ship,
    blurb: "Offline, updates, hosting, and the two app stores.",
  },
  Components: {
    icon: Blocks,
    blurb: "Unstyled primitives with the native physics built in.",
  },
  Hooks: {
    icon: Webhook,
    blurb: "One signal per device fact, the same on every target.",
  },
  APIs: {
    icon: Zap,
    blurb: "Capabilities, storage, the router and utilities.",
  },
  "Config and CLI": {
    icon: Settings2,
    blurb: "Every config key, every command, every flag.",
  },
}

const LEADS = [
  {
    slug: "quick-start",
    kicker: "Five minutes",
    title: "Quick start",
    text: "Get an app running in a browser, then on a simulator.",
  },
  {
    slug: "six-targets",
    kicker: "The idea",
    title: "One codebase, six targets",
    text: "What each target gets, and what adaptv does to make them agree.",
  },
] as const

export function DocsHome() {
  const leads = LEADS.filter((lead) =>
    ALL_DOCS.some((page) => page.slug === lead.slug),
  )
  return (
    <DocsShell current="" label="Overview">
      <View className="w-full max-w-5xl">
        <View className="gap-4 pb-10">
          <span className="font-mono text-[11.5px] text-brand uppercase tracking-[0.14em]">
            Documentation
          </span>
          <h1 className="font-semibold text-[clamp(2.2rem,4.5vw,3.25rem)] text-foreground leading-[1.02] tracking-[-0.04em]">
            Every component, hook,
            <br />
            <span className="text-muted">config key and command.</span>
          </h1>
          <p className="max-w-2xl text-[18px] text-muted leading-relaxed">
            adaptv is a React framework that ships one codebase to the web, the
            home screen, the App Store and Google Play. Start with a guide, or
            go straight to the reference.
          </p>
        </View>

        {leads.length > 0 ? (
          <View className="gap-4 pb-14 md:flex-row">
            {leads.map((lead) => (
              <Link
                key={lead.slug}
                to="/docs/$slug"
                params={{ slug: lead.slug }}
                className="group relative flex min-w-0 flex-1 flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-surface p-6 hover:border-border-strong"
              >
                <span className="dots pointer-events-none absolute inset-0 opacity-40" />
                <span className="relative font-mono text-[11px] text-muted uppercase tracking-[0.14em]">
                  {lead.kicker}
                </span>
                <span className="relative font-semibold text-[22px] text-foreground tracking-[-0.02em]">
                  {lead.title}
                </span>
                <span className="relative max-w-sm text-[14.5px] text-muted leading-relaxed">
                  {lead.text}
                </span>
                <span className="relative mt-3 flex flex-row items-center gap-1.5 font-medium text-[13.5px] text-brand">
                  Read
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </View>
        ) : null}

        {(["Guides", "Reference"] as const).map((section) => (
          <View key={section} className="gap-5 pb-14">
            <View row className="items-center gap-4">
              <h2 className="font-semibold text-[20px] text-foreground tracking-[-0.02em]">
                {section}
              </h2>
              <span className="h-px flex-1 bg-border" />
            </View>
            <View className="grid gap-4 md:grid-cols-2">
              {DOCS.filter((group) => group.section === section).map(
                (group) => {
                  const art = GROUP_ART[group.title]
                  const Icon = art?.icon ?? BookOpen
                  return (
                    <View
                      key={group.title}
                      className="gap-4 rounded-2xl border border-border p-5"
                    >
                      <View row className="items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-sunken text-brand">
                          <Icon className="size-[18px]" />
                        </span>
                        <View className="min-w-0 gap-0.5">
                          <span className="font-medium text-[15.5px] text-foreground">
                            {group.title}
                          </span>
                          {art ? (
                            <span className="text-[13px] text-muted leading-snug">
                              {art.blurb}
                            </span>
                          ) : null}
                        </View>
                      </View>
                      <View row className="flex-wrap gap-1.5">
                        {group.pages.map((page) => (
                          <Link
                            key={page.slug}
                            to="/docs/$slug"
                            params={{ slug: page.slug }}
                            className="rounded-md border border-border bg-surface px-2.5 py-1 text-[13px] text-subtle hover:border-border-strong hover:text-foreground"
                          >
                            {page.title}
                          </Link>
                        ))}
                      </View>
                    </View>
                  )
                },
              )}
            </View>
          </View>
        ))}
      </View>
    </DocsShell>
  )
}
