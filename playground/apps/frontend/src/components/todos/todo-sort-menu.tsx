import { Pressable, View } from "adaptv/components"
import type { LucideIcon } from "lucide-react"
import {
  ArrowUpDown,
  Calendar,
  Check,
  Clock,
  Flag,
  History,
  List,
} from "lucide-react"
import { AppDrawer } from "@/components/ui"
import type { TodoSort } from "@/data/collections/todos/sort"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

type SortOption = {
  value: TodoSort
  title: string
  description: string
  Icon: LucideIcon
}

const SORT_OPTIONS: SortOption[] = [
  {
    value: "created",
    title: "Date added",
    description: "Grouped by the day added, newest first",
    Icon: Clock,
  },
  {
    value: "updated",
    title: "Last updated",
    description: "Grouped by the day last changed, newest first",
    Icon: History,
  },
  {
    value: "due",
    title: "Due date",
    description: "Overdue first, then by soonest due date",
    Icon: Calendar,
  },
  {
    value: "priority",
    title: "Priority",
    description: "Most urgent tasks at the top",
    Icon: Flag,
  },
  {
    value: "custom",
    title: "Custom",
    description: "Hold and drag to set your own order",
    Icon: List,
  },
]

type TodoSortTriggerProps = {
  open: boolean
  onOpen: () => void
}

//lives in the list's first section header — only the trigger, so the volatile
//section remounting on sort change never takes the drawer down with it
export function TodoSortTrigger({ open, onOpen }: TodoSortTriggerProps) {
  const haptic = useHaptics()

  function handleOpen() {
    haptic.impact("light")
    onOpen()
  }

  return (
    <Pressable
      render={
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Sort tasks"
          className={cn(
            //padding grows the tap target to ~46px; the matching negative margin
            //cancels it so the icon stays pixel-identical and in the same spot
            "-m-2.5 flex shrink-0 items-center justify-center rounded-md p-3.5 text-muted",
            "origin-center transition-[transform,color] duration-200 ease-out hover:text-foreground active:duration-0 active:scale-95",
            open && "text-foreground",
          )}
        />
      }
      onPress={handleOpen}
    >
      <ArrowUpDown size={18} strokeWidth={2} aria-hidden />
    </Pressable>
  )
}

type TodoSortDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: TodoSort
  onChange: (sort: TodoSort) => void
}

//mounted at a stable page-level position so it animates closed via `open`
export function TodoSortDrawer({
  open,
  onOpenChange,
  value,
  onChange,
}: TodoSortDrawerProps) {
  const haptic = useHaptics()

  function handleSelect(next: TodoSort) {
    haptic.impact("light")
    onChange(next)
    onOpenChange(false)
  }

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="flex flex-col gap-y-1 pb-2 pt-2">
            <AppDrawer.Title className="px-3 pb-1.5 text-sm font-medium text-subtle">
              Sort tasks by
            </AppDrawer.Title>
            {/* single-select: a radiogroup so assistive tech announces the options
                as mutually-exclusive choices (not independent pressed toggles) */}
            <View role="radiogroup" aria-label="Sort tasks by">
              {SORT_OPTIONS.map((option) => {
                const isActive = option.value === value
                const OptionIcon = option.Icon
                return (
                  <Pressable
                    key={option.value}
                    render={
                      // biome-ignore lint/a11y/useSemanticElements: a native radio can't carry this icon + title + description layout; ARIA radio on the button is the intentional single-select pattern
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={cn(
                          "flex w-full items-center gap-x-3 rounded-lg px-3 py-2.5 text-left",
                          "transition-colors duration-200 ease-out",
                          isActive
                            ? "bg-secondary"
                            : "hover:bg-secondary/60",
                        )}
                      />
                    }
                    onPress={() => handleSelect(option.value)}
                  >
                    <OptionIcon
                      size={20}
                      strokeWidth={2}
                      aria-hidden
                      className={cn(
                        "shrink-0",
                        isActive ? "text-primary" : "text-muted",
                      )}
                    />
                    <View className="min-w-0 flex-1">
                      <View className="text-[15px] font-medium leading-tight text-foreground">
                        {option.title}
                      </View>
                      <View className="mt-0.5 text-[13px] leading-snug text-muted">
                        {option.description}
                      </View>
                    </View>
                    {isActive && (
                      <Check
                        size={18}
                        strokeWidth={2}
                        aria-hidden
                        className="shrink-0 text-primary"
                      />
                    )}
                  </Pressable>
                )
              })}
            </View>
          </AppDrawer.Shell>
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
}
