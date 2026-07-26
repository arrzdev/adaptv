import { cn } from "@arrzdev/adaptv/utils"
import { GhostButton } from "@/components/ui"
import { PRIORITY_LEVELS } from "@/data/collections/todos/priority"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

type PriorityOption = {
  value: number | null
  label: string
  dotClassName?: string
  textClassName?: string
}

const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: null, label: "None" },
  ...PRIORITY_LEVELS.map((level) => ({
    value: level.value,
    label: level.label,
    dotClassName: level.dotClassName,
    textClassName: level.textClassName,
  })),
]

type PriorityPickerProps = {
  value: number | null
  onChange: (priority: number | null) => void
}

export function PriorityPicker({ value, onChange }: PriorityPickerProps) {
  const { hapticPointerHandlers } = useAppVibrate()

  return (
    <div className="flex flex-col gap-y-2">
      <span className="ps-1 text-sm font-medium text-subtle">
        Priority
      </span>
      <div className="scrollable-x -mx-6 flex gap-x-2 px-6">
        {PRIORITY_OPTIONS.map((option) => {
          const isSelected = value === option.value
          const handlers = hapticPointerHandlers(
            () => onChange(option.value),
            "ok",
          )
          return (
            <GhostButton
              key={option.label}
              onClick={handlers.onClick}
              className={cn(
                "shrink-0",
                option.textClassName,
                isSelected && "bg-secondary hover:bg-secondary",
              )}
              aria-pressed={isSelected}
            >
              <span className="inline-flex items-center gap-x-2">
                {option.dotClassName && (
                  <span
                    aria-hidden
                    className={cn(
                      "size-2 rounded-full",
                      option.dotClassName,
                    )}
                  />
                )}
                {option.label}
              </span>
            </GhostButton>
          )
        })}
      </div>
    </div>
  )
}
