import { Button } from "#adaptv/components/button"
import { View } from "#adaptv/components/view"
import type { BootCode } from "#adaptv/shell/boot-fallback"
import { BOOT_RETRY_ATTR } from "#adaptv/shell/boot-fallback"
import { mergeStyles } from "#adaptv/utils/styles"

export type { BootCode }

/**
 * **Optional.** Marks *which* control reloads, for a screen with more than one
 * button. You do not need it otherwise — see {@link BootError} for why every
 * `<button>` already reloads.
 */
export const bootErrorRetryProps = { [BOOT_RETRY_ATTR]: "" } as const

/**
 * Props for the boot error screen. Every one is optional.
 *
 * Notably absent: `error`, `reset`. Neither exists here. This screen is rendered
 * when the app's bundle never ran, so there is no error object to describe and no
 * React tree to reset — the only recovery that exists is a reload.
 */
export type BootErrorProps = {
  /**
   * How the boot failed — `BOOT-LOAD`, `BOOT-THROW`, `BOOT-REJECT`, `BOOT-STALL`.
   * → `docs/design/rendering.md §3.1.3` for what each one means.
   *
   * **adaptv's own screen never renders it**, deliberately: whether a code helps
   * or just alarms a user is a product decision, and it belongs to the app. It is
   * here so an overriding `bootErrorScreen` can branch on it — different copy for
   * "we are not serving the file" than for "the file we served is broken".
   */
  code?: BootCode
  title?: string
  description?: string
  retryLabel?: string
  className?: string
}

/**
 * The adaptv mark. Inline, and the same geometry the dev-build error page draws
 * (`bin/lib/offline-page.mjs`) — these are the two screens adaptv shows when its
 * own shell could not start, and they should read as one thing.
 *
 * `currentColor` throughout, so it follows the theme with no second definition.
 */
function AdaptvMark() {
  return (
    <svg
      aria-hidden
      viewBox="192 192 640 640"
      fill="none"
      className="size-14"
    >
      <title>adaptv logo</title>
      <circle cx="512" cy="512" r="164" fill="currentColor" />
      <g
        stroke="currentColor"
        strokeWidth="100"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M256 400V296H360" />
        <path d="M768 624V728H664" />
      </g>
    </svg>
  )
}

/**
 * The default boot error screen. → `docs/design/rendering.md §3.1.3`
 *
 * ## Where this renders, and what is true there
 *
 * Only when the app's bundle never executed — a 404 on the entry chunk, a syntax
 * error, a corrupt OTA bundle. It is **prerendered to static HTML at build time**
 * and embedded in the document, because at that point there is no React left to
 * render anything. See `shell/boot-fallback.ts`.
 *
 * So nothing here may assume a runtime. There are no hooks, no state, and the
 * retry `onClick` below is **not** what makes the button work — a build-time
 * render serializes no event handlers. The inline watchdog reloads on any button
 * click inside the fallback, which is sound rather than lucky: in a document with
 * no app JavaScript, a button has no other reachable behaviour.
 *
 * ## Why it carries the adaptv mark
 *
 * This is adaptv's screen for "adaptv could not start", the sibling of the dev
 * build's "couldn't reach dev server". An app that wants its own branding here
 * overrides `bootErrorScreen` — which is the point of the slot.
 */
export function BootError({
  code,
  title = "Couldn't load the app",
  description = "Something went wrong while starting up.",
  retryLabel = "Try again",
  className,
}: BootErrorProps) {
  //accepted and deliberately not rendered — what a user is told about a failure
  //is the app's call, not the framework's. A useful side effect: because this
  //component ignores it, all four prerendered variants come out identical and
  //collapse to a single copy in the document (see `getBootFallbackMarkup`).
  void code

  return (
    <View
      data-adaptv="boot-error"
      safe="all"
      role="alert"
      aria-live="assertive"
      //`locked: undefined`, matching `Offline`: the one structural thing here is
      //the safe-area padding, and that is the `safe="all"` PROP — View locks it.
      className={mergeStyles({
        base: "flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-6 px-6 text-center text-gray-950 dark:text-gray-50",
        className,
        locked: undefined,
      })}
    >
      <div className="flex flex-col items-center gap-3">
        <AdaptvMark />
        <span className="text-xs font-semibold tracking-[0.08em] opacity-45">
          adaptv
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-sm opacity-60">{description}</p>
      </div>

      {/* `onClick` is the live path only. In the fallback it was never
          serialized, and the watchdog reloads on the click instead. */}
      <Button
        {...bootErrorRetryProps}
        haptic
        onClick={() => location.reload()}
        //`Button` ships no variants on purpose — its base is layout plus a neutral
        //fill, and every app dresses it. So this screen has to dress it too, or the
        //only control on it renders as bare text. Inverted fill because it is the
        //one action here, and in gray-scale utilities rather than the app's
        //semantic tokens: `styles/index.css` (`@source`) guarantees these classes
        //exist in the stylesheet, while `bg-background` and friends only exist if
        //the consumer happens to define them. This screen does not get to assume.
        className="rounded-xl bg-gray-950 px-4 py-2.5 text-sm font-medium text-gray-50 dark:bg-gray-50 dark:text-gray-950"
      >
        <Button.Text>{retryLabel}</Button.Text>
      </Button>
    </View>
  )
}
