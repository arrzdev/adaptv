import { Link, View } from "adaptv/components"
import { SitePage } from "@/components/site-page"

/**
 * A URL with no page. The framework's default screen skips every layout, so it has no
 * site header and a reader who followed a stale link has nowhere to go but back. This
 * one is a normal site page: the header, a short line, and the two places worth going.
 */
export default function NotFoundScreen() {
  return (
    <SitePage>
      <View className="mx-auto w-full max-w-3xl gap-6 px-5 py-14 md:py-20">
        <span className="font-mono text-[12px] text-muted uppercase tracking-wider">
          404
        </span>
        <h1 className="font-semibold text-[44px] text-foreground leading-[1.05] tracking-[-0.035em]">
          Page not found
        </h1>
        <p className="text-[18px] text-subtle leading-relaxed">
          There is no page at this address. It may have moved, or the link has a
          typo.
        </p>
        <View row className="flex-wrap gap-3">
          <Link
            to="/"
            className="rounded-full bg-foreground px-5 py-2.5 font-medium text-[15px] text-background"
          >
            Home
          </Link>
          <Link
            to="/docs"
            className="rounded-full border border-border-strong px-5 py-2.5 font-medium text-[15px] text-foreground hover:bg-sunken"
          >
            Documentation
          </Link>
        </View>
      </View>
    </SitePage>
  )
}
