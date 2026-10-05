import { Button } from "#adaptv/components/button"
import { View } from "#adaptv/components/view"
import type { BootCode } from "#adaptv/shell/boot-fallback"
import { BOOT_RETRY_ATTR } from "#adaptv/shell/boot-fallback"

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
      data-adaptv="boot-error-mark"
      data-part="mark"
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
      //No lock of its own, matching `Offline`: the one structural thing here is the
      //safe-area padding, and that is the `safe="all"` PROP — View locks it inline.
      //The look is styles/boot-error.css. This is the one element with
      //`data-adaptv="boot-error"`: every sub-part carries its own `boot-error-<part>`.
      className={className}
    >
      <div data-adaptv="boot-error-brand" data-part="brand">
        <AdaptvMark />
        <span data-adaptv="boot-error-wordmark" data-part="wordmark">
          adaptv
        </span>
      </div>

      <div data-adaptv="boot-error-copy" data-part="copy">
        <h1 data-adaptv="boot-error-title" data-part="title">
          {title}
        </h1>
        <p data-adaptv="boot-error-description" data-part="description">
          {description}
        </p>
      </div>

      {/* `onClick` is the live path only. In the fallback it was never
          serialized, and the watchdog reloads on the click instead. */}
      <Button
        {...bootErrorRetryProps}
        haptic
        onClick={() => location.reload()}
        //`Button` ships no variants on purpose — its default is layout plus a neutral
        //fill, and every app dresses it. So this screen has to dress it too, or the
        //only control on it renders as bare text: an inverted fill, because it is the
        //one action here, as a rule keyed on the Button inside this root
        //(styles/boot-error.css). Gray-scale tokens with literal fallbacks rather
        //than the app's semantic tokens, which only exist if the consumer happens to
        //define them. This screen does not get to assume.
      >
        <Button.Text>{retryLabel}</Button.Text>
      </Button>
    </View>
  )
}
