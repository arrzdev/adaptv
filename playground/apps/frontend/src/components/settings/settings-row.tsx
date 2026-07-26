import type { LucideIcon } from "lucide-react"
import { SettingsListRow } from "@/components/settings/settings-list-row"
import { Switch } from "@/components/ui"

type SettingsRowProps = {
  label: string
  icon: LucideIcon
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  showSeparator?: boolean
}

export function SettingsRow({
  label,
  icon,
  checked,
  onCheckedChange,
  showSeparator = false,
}: SettingsRowProps) {
  return (
    <SettingsListRow
      icon={icon}
      label={label}
      showSeparator={showSeparator}
      trailing={
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={label}
        />
      }
    />
  )
}
