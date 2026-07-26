import type { LucideIcon } from "lucide-react"
import type { ComponentPropsWithoutRef, ReactNode } from "react"

type SettingsListRowProps = {
  label: string
  icon?: LucideIcon
  leading?: ReactNode
  trailing?: ReactNode
  showSeparator?: boolean
}

export function SettingsListRow({
  icon: Icon,
  leading,
  label,
  trailing,
  showSeparator = false,
}: SettingsListRowProps) {
  return (
    <li>
      <div className="flex items-center justify-between gap-x-3 px-4 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-x-3">
          {leading}
          {!leading && Icon && (
            <Icon
              size={20}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-subtle"
            />
          )}
          <span className="truncate text-base font-medium text-foreground">
            {label}
          </span>
        </div>
        {trailing}
      </div>
      {showSeparator && (
        <div className="mx-4 border-b border-border-subtle" aria-hidden />
      )}
    </li>
  )
}

type SettingsAddRowProps = {
  icon: LucideIcon
  label: string
  onClick: ComponentPropsWithoutRef<"button">["onClick"]
  showSeparator?: boolean
}

export function SettingsAddRow({
  icon: Icon,
  label,
  onClick,
  showSeparator = false,
}: SettingsAddRowProps) {
  return (
    <li>
      {showSeparator && (
        <div className="mx-4 border-b border-border-subtle" aria-hidden />
      )}
      <button
        type="button"
        onClick={onClick}
        className="clickable flex w-full items-center gap-x-3 px-4 py-4 text-start"
      >
        <Icon
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-subtle"
        />
        <span className="text-base font-medium text-foreground">
          {label}
        </span>
      </button>
    </li>
  )
}
