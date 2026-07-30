import { Link } from "#adaptv/components/link"
import { mergeStyles } from "#adaptv/utils/styles"

export type UiNotFoundProps = {
  /** Router path for the home action. Default `/`. */
  homeTo?: string
  className?: string
  codeClassName?: string
  titleClassName?: string
  descriptionClassName?: string
  homeLinkClassName?: string
}

/**
 * Full-screen 404 for the viewport shell. Fills `AppShell`.
 * Uses package `Link` for tap-safe navigation home.
 */
export function UiNotFound({
  homeTo = "/",
  className,
  codeClassName,
  titleClassName,
  descriptionClassName,
  homeLinkClassName,
}: UiNotFoundProps) {
  //A whole-screen fallback the consumer is expected to replace outright
  //(`notFoundScreen` in adaptv.config.ts). Nothing here is structural: it fills the
  //shell because that is the neutral look for a 404, not because anything depends
  //on it — so every part is `base` and `locked` is undefined by decision (§2).
  //`clickable` is not repeated on the Link either; Link locks it itself.
  return (
    <main
      data-adaptv="not-found"
      className={mergeStyles({
        base: "box-border flex min-h-0 flex-1 w-full flex-col items-center bg-gray-50 text-center text-gray-950",
        className,
        locked: undefined,
      })}
    >
      <span
        className={mergeStyles({
          base: "text-gray-500",
          className: codeClassName,
          locked: undefined,
        })}
        aria-hidden
      >
        404
      </span>
      <h1
        className={mergeStyles({
          base: "text-gray-950",
          className: titleClassName,
          locked: undefined,
        })}
      >
        Page not found
      </h1>
      <p
        className={mergeStyles({
          base: "text-gray-600",
          className: descriptionClassName,
          locked: undefined,
        })}
      >
        This page doesn't exist or was moved.
      </p>
      <Link
        to={homeTo}
        className={mergeStyles({
          base: "bg-gray-50 text-gray-950",
          className: homeLinkClassName,
          locked: undefined,
        })}
      >
        Back to home
      </Link>
    </main>
  )
}
