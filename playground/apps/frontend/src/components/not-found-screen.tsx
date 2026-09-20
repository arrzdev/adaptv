import { Link, View } from "@arrzdev/adaptv/components"
import stressedMascotUrl from "@/components/illustrations/stressed-mascot.svg?url"
import { ReservedSvgSpace } from "@/components/reserved-svg-space"

export function NotFoundScreen() {
  return (
    <View
      fill
      className="box-border w-full items-center justify-center gap-y-10 bg-background px-safe-offset-6 py-safe-offset-8 text-center text-foreground"
    >
      <div className="relative grid w-full max-w-lg place-items-center">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 flex -translate-y-[24%] select-none items-center justify-center min-[768px]:-translate-y-[28%]"
        >
          <span className="bg-gradient-to-b from-primary/50 via-primary/25 to-primary/10 bg-clip-text font-sans text-[clamp(8.5rem,48vw,12rem)] font-bold leading-[0.82] tracking-[-0.02em] text-transparent tabular-nums min-[768px]:text-[clamp(9.5rem,54vw,22rem)]">
            404
          </span>
        </span>
        <ReservedSvgSpace className="relative z-10 w-[min(72vw,18rem,52dvh)]">
          {/* A file, not an inline <svg>: this screen is a static import of
              the root route, so inline art would ride in every page's initial
              JS. Eager and default decoding on purpose: it is the page's
              only art. Its box is held twice while it loads, by
              ReservedSvgSpace's aspect ratio and by the width/height
              attributes' own ratio. No pointer events: it is art, not a
              picture to drag out or long-press-save, which the inline <svg>
              never offered. */}
          <img
            src={stressedMascotUrl}
            alt=""
            width={1024}
            height={1024}
            className="pointer-events-none"
          />
        </ReservedSvgSpace>
      </div>

      <h1 className="sr-only">Page not found</h1>

      <Link
        to="/"
        className="inline-flex w-full max-w-xs origin-center items-center justify-center rounded-xl bg-gradient-to-b from-primary/32 via-primary/14 to-surface px-8 py-4 text-center text-base font-semibold uppercase leading-none tracking-[0.14em] text-primary no-underline ring-1 ring-inset ring-primary/28 shadow-[inset_0_1px_0_0_oklch(1_0_0/0.5)] transition-[transform,background-color] duration-200 ease-out hover:from-primary/38 hover:via-primary/18 hover:ring-primary/38 active:scale-[0.98] active:duration-0"
      >
        Back home
      </Link>
    </View>
  )
}

export default NotFoundScreen
