import { Pressable, Text, View } from "@arrzdev/adaptv/components"
import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

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
    <View>
      <View
        row
        className="flex items-center justify-between gap-x-3 px-4 py-4"
      >
        <View row className="flex min-w-0 flex-1 items-center gap-x-3">
          {leading}
          {!leading && Icon && (
            <Icon
              size={20}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-subtle"
            />
          )}
          <Text className="truncate text-base font-medium text-foreground">
            {label}
          </Text>
        </View>
        {trailing}
      </View>
      {showSeparator && (
        <View className="mx-4 border-b border-border-subtle" aria-hidden />
      )}
    </View>
  )
}

type SettingsAddRowProps = {
  icon: LucideIcon
  label: string
  onPress: () => void
  showSeparator?: boolean
}

export function SettingsAddRow({
  icon: Icon,
  label,
  onPress,
  showSeparator = false,
}: SettingsAddRowProps) {
  return (
    <View>
      {showSeparator && (
        <View className="mx-4 border-b border-border-subtle" aria-hidden />
      )}
      <Pressable
        render={<button type="button" />}
        onPress={onPress}
        className="clickable flex w-full items-center gap-x-3 px-4 py-4 text-start"
      >
        <Icon
          size={20}
          strokeWidth={1.75}
          aria-hidden
          className="shrink-0 text-subtle"
        />
        <Text className="text-base font-medium text-foreground">
          {label}
        </Text>
      </Pressable>
    </View>
  )
}
