import { ExternalLink, Link, ScrollView, View } from "adaptv/components"
import { useTheme } from "adaptv/hooks"
import { Github, Moon, Sun } from "lucide-react"
import type { ReactNode } from "react"
import { Wordmark } from "@/components/logo"
import { GITHUB_URL } from "@/content/site"
import { cn } from "@/utils/cn"

//each link is as wide as it is in Geist, in any font: the group is right-aligned, so a link
//that changed width when Geist swapped in moved the whole group (a layout shift). The label
//plus 8 px a side on a phone (both stay over the 44 px touch target), 12 px from `sm`
const NAV = [
  { to: "/docs", label: "Docs", width: "w-[50px] sm:w-[58px]" },
  { to: "/blog", label: "Blog", width: "w-[47px] sm:w-[55px]" },
] as const

/**
 * Every page on the site. The page's root IS the scroller — adaptv's shell stretches a
 * route's only root element, so there is no wrapper — and the header is sticky INSIDE
 * it, which is what lets content blur underneath.
 */
export function SitePage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    // the gutter is held from the first paint: the HTML paints in chunks, and a scrollbar
    // that appeared once the content outgrew the screen narrowed the page (a layout shift)
    <ScrollView
      showsVerticalScrollIndicator
      className="bg-background [scrollbar-gutter:stable]"
    >
      <SiteHeader />
      <View className={cn("w-full", className)}>{children}</View>
      <SiteFooter />
    </ScrollView>
  )
}

function SiteHeader() {
  const { resolved, setPreference } = useTheme()
  const toggleTheme = () =>
    setPreference(resolved === "dark" ? "light" : "dark")
  return (
    <header className="sticky top-0 z-40 w-full px-3 pt-safe-offset-3">
      <View
        row
        className="mx-auto h-12 w-full max-w-[1200px] items-center justify-between rounded-full border border-border-strong/70 bg-background/70 pr-1 pl-3 sm:pr-2 sm:pl-5 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      >
        <Link to="/" className="flex h-11 items-center text-foreground">
          <Wordmark />
        </Link>
        {/* every item has a fixed width (the links below, the 44 px icon buttons), so
            the right-aligned group is as wide from the first paint as after the fonts
            and icons arrive, and does not move */}
        <View row className="items-center sm:gap-1">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex h-11 items-center justify-center rounded-full font-medium text-[14px] text-subtle hover:bg-sunken hover:text-foreground",
                item.width,
              )}
            >
              {item.label}
            </Link>
          ))}
          <ExternalLink
            href={GITHUB_URL}
            aria-label="adaptv on GitHub"
            className="grid size-11 sm:ml-1 place-items-center rounded-full text-subtle hover:bg-sunken hover:text-foreground"
          >
            <Github className="size-[18px]" />
          </ExternalLink>
          {/* Both icons are in the markup and CSS picks one. Branching on the resolved
              theme instead would hydrate wrong: the server cannot know it, and the
              client reads it off <html> on its very first render. */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle light and dark"
            className="grid size-11 cursor-pointer place-items-center rounded-full text-subtle hover:bg-sunken hover:text-foreground"
          >
            <Sun className="hidden size-[18px] dark:block" />
            <Moon className="size-[18px] dark:hidden" />
          </button>
        </View>
      </View>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="w-full pb-safe">
      <View className="sheet ruled gap-8 px-6 py-12 md:flex-row md:justify-between md:px-10">
        <View className="max-w-sm gap-3">
          <Wordmark />
          <p className="text-[14px] text-muted leading-relaxed">
            One React codebase for the web, the home screen, the App Store and
            Google Play. MIT licensed.
          </p>
          <p className="text-[13px] text-muted">
            This site is an adaptv app.
            <br />
            Add it to your home screen, it opens offline!
          </p>
          <p className="text-[12px] text-muted">
            The Android robot is reproduced or modified from work created and
            shared by Google and used according to terms described in the
            Creative Commons 3.0 Attribution License.
          </p>
        </View>
        <View row className="gap-16 text-[14px]">
          <FooterColumn title="Learn">
            <Link to="/docs" className="text-subtle hover:text-foreground">
              Documentation
            </Link>
            <Link to="/blog" className="text-subtle hover:text-foreground">
              Blog
            </Link>
          </FooterColumn>
          <FooterColumn title="Project">
            <ExternalLink
              href={GITHUB_URL}
              className="text-subtle hover:text-foreground"
            >
              GitHub
            </ExternalLink>
            <ExternalLink
              href={`${GITHUB_URL}/blob/main/docs/roadmap/README.md`}
              className="text-subtle hover:text-foreground"
            >
              Roadmap
            </ExternalLink>
          </FooterColumn>
        </View>
      </View>
    </footer>
  )
}

function FooterColumn({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <View className="gap-2.5">
      <span className="font-medium text-[13px] text-foreground">{title}</span>
      {children}
    </View>
  )
}
