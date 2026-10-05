import { Link } from "#adaptv/components/link"

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
  //on it — so every part's look is a default rule in styles/not-found.css and
  //nothing is locked (§2). Each `*ClassName` is the consumer's alone. The
  //interaction lock is not repeated on the Link either; Link locks it itself.
  return (
    <main data-adaptv="not-found" data-part="root" className={className}>
      <span
        data-adaptv="not-found"
        data-part="code"
        className={codeClassName}
        aria-hidden
      >
        404
      </span>
      <h1
        data-adaptv="not-found"
        data-part="title"
        className={titleClassName}
      >
        Page not found
      </h1>
      <p
        data-adaptv="not-found"
        data-part="description"
        className={descriptionClassName}
      >
        This page doesn't exist or was moved.
      </p>
      {/* Link keeps its own `data-adaptv="link"`; this screen's colours for it are a
          rule keyed on the Link inside this root (styles/not-found.css). */}
      <Link to={homeTo} className={homeLinkClassName}>
        Back to home
      </Link>
    </main>
  )
}
