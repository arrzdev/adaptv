import type { ComponentType } from "react"
import type { UpdateRequiredProps } from "#adaptv/config/types"
import { useStoreRelease } from "#adaptv/hooks/use-store-release"

const MS_PER_DAY = 86_400_000

export type UpdateRequiredHostProps = {
  /**
   * Days behind before the screen takes over. `undefined` disables it entirely,
   * which is the default — see the note on interrupting a working app below.
   */
  afterDays?: number
  /** App-supplied overlay; falls back to the built-in prompt. */
  component?: ComponentType<UpdateRequiredProps>
}

/**
 * Take the screen when this install can no longer be reached over the air.
 * → `LIFECYCLE.md §5.6`
 *
 * ## Why this is opt-in, and opt-in by a *number*
 *
 * An install in this state is working. It is running the newest bundle that
 * matched its binary, it still checks the channel, it still has the rollback net.
 * What has stopped is its future: the channel has moved to a native layer it does
 * not have, and only a store update can move it again.
 *
 * That is not, on its own, worth locking someone out of an app that works — so
 * with no `updateRequiredAfterDays` this renders nothing, ever. The case that IS
 * worth it is a **server contract** that moved with the release: an API, a data
 * shape, an auth flow now built for a version this install will never reach. Only
 * the app knows whether that happened, so only the app can set the number.
 *
 * The number rather than a boolean because the honest policy is nearly always a
 * gradient. `0` blocks the moment the channel moves — correct when the contract
 * broke with the release, and needlessly hostile otherwise, since the channel
 * moves when the release is *built*, usually before review lets anyone install
 * it. A larger number lets the store catch up first and only interrupts the
 * installs that really did get left behind.
 */
export function UpdateRequired({
  afterDays,
  component,
}: UpdateRequiredHostProps) {
  const stranded = useStoreRelease()

  if (afterDays === undefined || !stranded) return null
  const days = Math.floor((Date.now() - stranded.since) / MS_PER_DAY)
  if (days < afterDays) return null

  const Screen = component ?? DefaultUpdateRequired
  return (
    <Screen
      days={days}
      since={stranded.since}
      buildTag={stranded.buildTag}
    />
  )
}

function DefaultUpdateRequired({ days }: UpdateRequiredProps) {
  return (
    <div
      data-adaptv="update-required"
      role="alert"
      className="fixed inset-0 z-[120] flex flex-col items-center justify-center gap-y-6 bg-background px-safe-offset-6 py-safe-offset-8 text-center text-foreground"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-14 text-primary"
      >
        <title>Update available</title>
        <path d="M12 3v12" />
        <path d="m8 7 4-4 4 4" />
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
      </svg>
      <p className="max-w-xs text-balance text-base font-medium text-foreground">
        This version of the app is out of date.
      </p>
      {/* The age, not a promise. adaptv knows the channel moved past this
          install; it does not know the new version has cleared review, so a
          "get it now" instruction could send someone to a store page that has
          nothing newer on it yet. */}
      <p className="max-w-xs text-balance text-sm text-muted">
        {days < 1
          ? "Update from the App Store or Google Play to continue."
          : `It has not been able to update for ${days} ${days === 1 ? "day" : "days"}. Update from the App Store or Google Play to continue.`}
      </p>
    </div>
  )
}
