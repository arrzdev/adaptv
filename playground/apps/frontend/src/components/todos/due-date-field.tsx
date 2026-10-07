import { Pressable, Text, View } from "@arrzdev/adaptv/components"
import {
  dismissVirtualKeyboard,
  willOpenVirtualKeyboard,
} from "@arrzdev/adaptv/hooks"
import { Calendar, X } from "lucide-react"
import { useEffect, useState } from "react"
import { DateWheelPicker } from "@/components/todos/date-wheel-picker"
import { startOfDay } from "@/data/collections/todos/dates"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

function formatFull(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

type DueDateFieldProps = {
  value: Date | null
  onChange: (value: Date | null) => void
}

export function DueDateField({ value, onChange }: DueDateFieldProps) {
  const reducedMotion = useAppReducedMotion()
  const haptic = useHaptics()
  const [expanded, setExpanded] = useState(false)

  //the wheels commit live — the form value always holds whatever the picker last
  //showed, so submitting or closing mid-spin keeps that date. the trigger button
  //is the only thing that opens/closes the picker (focusing an input or tapping
  //elsewhere leaves it alone).
  function openPicker() {
    //the wheel and the on-screen keyboard are mutually exclusive — see the
    //focusin effect below. Opening the wheel drops the keyboard.
    dismissVirtualKeyboard()
    //opening seeds the value — the wheels' date IS the due date from here on
    if (!value) onChange(startOfDay(new Date()))
    setExpanded(true)
  }

  function handleToggle() {
    if (expanded) {
      setExpanded(false)
      return
    }
    openPicker()
  }

  function handleClear() {
    haptic.impact("light")
    onChange(null)
    setExpanded(false)
  }

  //the wheel and the keyboard can't share the drawer: together they make the content
  //taller than the space above the keyboard, and the panel can't lift far enough, so
  //the pinned action buttons end up behind the keyboard. Keep them exclusive —
  //focusing any text field collapses the wheel (handleToggle covers the other way).
  useEffect(() => {
    if (!expanded) return

    function handleFocusIn(event: FocusEvent) {
      if (!(event.target instanceof HTMLElement)) return
      if (!willOpenVirtualKeyboard(event.target)) return
      setExpanded(false)
    }

    document.addEventListener("focusin", handleFocusIn)
    return () => document.removeEventListener("focusin", handleFocusIn)
  }, [expanded])

  //while expanded, value is always seeded (see openPicker)
  const shown = value ?? startOfDay(new Date())
  const triggerLabel = value ? formatFull(value) : "Add due date"

  const isEmpty = !value
  //while open there's always a way out to "no due date"
  const showClear = value !== null
  const revealDuration = reducedMotion ? 0 : 0.26

  return (
    <View className="flex flex-col gap-y-2">
      <Text className="ps-1 text-sm font-medium text-subtle">
        Due date
      </Text>
      <View className="overflow-hidden rounded-md bg-surface ring-1 ring-inset ring-border">
        <View row className="flex items-center">
          <Pressable
            render={
              <button
                type="button"
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-x-2 px-3 py-3 text-left text-base"
              />
            }
            onPress={handleToggle}
          >
            <Calendar
              size={18}
              strokeWidth={1.75}
              aria-hidden
              className="shrink-0 text-muted"
            />
            <Text
              className={cn(
                "truncate",
                isEmpty ? "text-muted" : "text-foreground",
              )}
            >
              {triggerLabel}
            </Text>
          </Pressable>
          {showClear && (
            <Pressable
              render={
                <button
                  type="button"
                  aria-label="Clear due date"
                  className="mr-2 flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-secondary hover:text-foreground"
                />
              }
              onPress={handleClear}
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </Pressable>
          )}
        </View>

        {/* kept mounted. The footprint snaps open/closed — grid 0fr<->1fr with NO
            transition, so it's the content's natural height with no magic pixel
            constant — and only the wheel animates, sliding + fading in on the
            compositor (transform/opacity). Animating the box height instead is
            what we removed: it dragged the whole form 150px while the wheel
            cross-faded, which read as parallax, and the per-frame resize also
            fired the drawer's content ResizeObservers. `contain:content` keeps
            the wheel's paint self-contained. */}
        <View
          className={cn(
            "grid",
            expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <View className="overflow-hidden">
            <View
              aria-hidden={!expanded}
              className={cn(
                "border-t border-border-subtle px-3 pb-3 pt-2 [contain:content] transition-[transform,opacity] ease-out",
                expanded
                  ? "translate-y-0 opacity-100"
                  : "-translate-y-2 opacity-0",
              )}
              style={{ transitionDuration: `${revealDuration}s` }}
            >
              <DateWheelPicker
                value={shown}
                onChange={(next) => onChange(startOfDay(next))}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  )
}
