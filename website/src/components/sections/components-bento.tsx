import {
  Button,
  Drawer,
  Pressable,
  Swipeable,
  Switch,
  View,
  WheelColumn,
} from "adaptv/components"
import { BellOff, Moon, Pin, Plane, Trash2, Wifi } from "lucide-react"
import { useMemo, useState } from "react"
import { Card } from "@/components/card"
import { Section } from "@/components/section"
import { cn } from "@/utils/cn"

const NOTES = [
  ["Standup moved to 10:30", "Calendar"],
  ["Release notes need a second pair of eyes", "Inês"],
  ["Your build finished in 41s", "CI"],
] as const

function SwipeRows() {
  const [rows, setRows] = useState<number[]>([0, 1, 2])
  const [pinned, setPinned] = useState<number[]>([])
  return (
    <View className="w-full max-w-md gap-2">
      <Swipeable.Group>
        {rows.map((row) => (
          <Swipeable key={row} className="overflow-hidden rounded-2xl">
            <Swipeable.Content>
              <View
                row
                className="items-center gap-3 rounded-2xl border border-tile-line bg-tile px-4 py-3 text-left"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full bg-border-strong",
                    pinned.includes(row) && "bg-brand",
                  )}
                />
                <View className="min-w-0 gap-0.5">
                  <span className="truncate font-medium text-[14px]">
                    {NOTES[row][0]}
                  </span>
                  <span className="text-[12px] text-muted">
                    {NOTES[row][1]}
                  </span>
                </View>
              </View>
            </Swipeable.Content>
            <Swipeable.LeftActions>
              <Pressable
                aria-label="Pin"
                onPress={() =>
                  setPinned((list) =>
                    list.includes(row)
                      ? list.filter((item) => item !== row)
                      : [...list, row],
                  )
                }
                className="flex h-full w-20 items-center justify-center bg-brand text-brand-foreground"
              >
                <Pin className="size-5" />
              </Pressable>
            </Swipeable.LeftActions>
            <Swipeable.RightActions>
              <Pressable
                aria-label="Delete"
                onPress={() =>
                  setRows((list) => list.filter((item) => item !== row))
                }
                className="flex h-full w-20 items-center justify-center bg-danger text-white"
              >
                <Trash2 className="size-5" />
              </Pressable>
            </Swipeable.RightActions>
          </Swipeable>
        ))}
      </Swipeable.Group>
      {rows.length === 0 ? (
        <Pressable
          onPress={() => setRows([0, 1, 2])}
          className="self-center rounded-full bg-tile px-4 py-2 font-medium text-[13px] active:opacity-70"
        >
          Bring them back
        </Pressable>
      ) : (
        <span className="pt-2 text-center font-mono text-[11px] text-muted">
          drag a row left or right
        </span>
      )}
    </View>
  )
}

function TimeWheel() {
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(41)
  const hours = useMemo(
    () =>
      Array.from({ length: 24 }, (_, value) => ({
        value,
        label: String(value).padStart(2, "0"),
      })),
    [],
  )
  const minutes = useMemo(
    () =>
      Array.from({ length: 60 }, (_, value) => ({
        value,
        label: String(value).padStart(2, "0"),
      })),
    [],
  )
  const item =
    "text-[20px] text-muted tabular-nums data-[active=true]:font-medium data-[active=true]:text-foreground"
  return (
    <View row className="relative w-44 items-stretch">
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-[30px] -translate-y-1/2 rounded-lg bg-foreground/[0.07]" />
      <WheelColumn
        className="relative flex-1"
        itemClassName={item}
        items={hours}
        value={hour}
        onChange={setHour}
        ariaLabel="Hour"
      />
      <WheelColumn
        className="relative flex-1"
        itemClassName={item}
        items={minutes}
        value={minute}
        onChange={setMinute}
        ariaLabel="Minute"
      />
    </View>
  )
}

const SETTINGS = [
  { icon: Wifi, label: "Wi-Fi", on: true },
  { icon: Plane, label: "Airplane mode", on: false },
  { icon: BellOff, label: "Do not disturb", on: true },
  { icon: Moon, label: "Night shift", on: false },
] as const

function Switches() {
  const [state, setState] = useState<boolean[]>(SETTINGS.map((row) => row.on))
  return (
    <View className="w-full max-w-xs overflow-hidden rounded-2xl border border-tile-line bg-tile text-left">
      {SETTINGS.map(({ icon: Icon, label }, index) => (
        <View
          key={label}
          row
          className="items-center gap-3 border-tile-line px-4 py-3 [&:not(:first-child)]:border-t"
        >
          <Icon className="size-4 text-muted" />
          <span className="flex-1 text-[14px]">{label}</span>
          <Switch
            size={6}
            aria-label={label}
            checked={state[index]}
            onCheckedChange={(next) =>
              setState((list) =>
                list.map((value, at) => (at === index ? next : value)),
              )
            }
            className={cn(
              "rounded-full bg-border-strong transition-colors",
              state[index] && "bg-success",
            )}
          >
            <Switch.Thumb className="rounded-full bg-white shadow-sm" />
          </Switch>
        </View>
      ))}
    </View>
  )
}

function SheetTrigger() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="rounded-full bg-foreground px-6 py-3 font-medium text-[15px] text-background active:scale-95"
      >
        Open the sheet
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="bg-black/60" />
          <Drawer.Content className="mx-auto max-w-xl rounded-t-[28px] border-border border-t bg-surface text-foreground">
            <Drawer.Handle className="mt-2.5 bg-border-strong" />
            <Drawer.Shell className="gap-4 px-7 pt-5 pb-8">
              <Drawer.Title className="font-semibold text-[22px] tracking-tight">
                This is a real sheet.
              </Drawer.Title>
              <Drawer.Description className="text-[15px] text-subtle leading-relaxed">
                Drag it down. It follows your finger, rubber-bands past the top,
                and throws shut on a flick. On a phone it rises with the
                keyboard, and the page behind it never moves.
              </Drawer.Description>
              <Drawer.Close className="mt-2 h-12 cursor-pointer rounded-full bg-foreground font-medium text-[15px] text-background">
                Nice
              </Drawer.Close>
            </Drawer.Shell>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  )
}

/** A demo's box: a fixed height, so a demo never resizes its card. */
const STAGE = "h-[220px] md:h-[260px]"

/** Not screenshots of components: the components. */
export function ComponentsBento() {
  return (
    <Section
      title="Try the components here"
      lede="This is adaptv running on this page, the same code that ships to a phone. Drag, swipe, spin. They come unstyled, so the look is yours."
    >
      <View className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card
          className="md:col-span-2"
          visualClassName={STAGE}
          visual={<SwipeRows />}
          small
          title="Swipe a row"
          body="Follows your finger, leaves vertical scrolling alone, and keeps one row open at a time."
        />
        <Card
          visualClassName={STAGE}
          visual={<TimeWheel />}
          small
          title="Spin the wheel"
          body="Flick it: it coasts, slows down and settles on a value without a jump."
        />
        <Card
          visualClassName={STAGE}
          visual={<SheetTrigger />}
          small
          title="Open a sheet"
          body="Pull it down to close it. On a phone it stays above the keyboard; on Android, Back closes it."
        />
        <Card
          className="md:col-span-2"
          visualClassName={STAGE}
          visual={<Switches />}
          small
          title="Flip a switch"
          body="Screen readers get the label and the state. On a phone you feel a haptic tick."
        />
      </View>
    </Section>
  )
}
