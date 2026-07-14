import { Link } from "#nativ/components/link"
import { cn } from "#nativ/utils/cn"

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
  return (
    <main
      className={cn(
        "box-border flex min-h-0 flex-1 w-full flex-col items-center bg-gray-50 text-center text-gray-950",
        className,
      )}
    >
      <span className={cn("text-gray-500", codeClassName)} aria-hidden>
        404
      </span>
      <h1 className={cn("text-gray-950", titleClassName)}>
        Page not found
      </h1>
      <p className={cn("text-gray-600", descriptionClassName)}>
        This page doesn't exist or was moved.
      </p>
      <Link
        to={homeTo}
        className={cn(
          "clickable bg-gray-50 text-gray-950",
          homeLinkClassName,
        )}
      >
        Back to home
      </Link>
    </main>
  )
}
