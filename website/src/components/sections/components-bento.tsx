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
import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { cn } from "@/utils/cn"

function Card({
  title,
  line,
  children,
  className,
  stageClassName,
}: {
  title: string
  line: string
  children: ReactNode
  className?: string
  stageClassName?: string
}) {
  return (
    <Reveal className={cn("h-full", className)}>
      <View className="h-full overflow-hidden rounded-3xl border border-border bg-surface">
        <View
          className={cn(
            "dots relative min-h-[260px] flex-1 items-center justify-center p-6 sm:p-8",
            stageClassName,
          )}
        >
          {children}
        </View>
        <View className="gap-1.5 border-border border-t p-6">
          <span className="font-medium text-[16px] tracking-tight">
            {title}
          </span>
          <span className="text-[14px] text-muted leading-relaxed">{line}</span>
        </View>
      </View>
    </Reveal>
  )
}

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
      {/* an inset grouped list: one rounded card clips every row, so a row slides under
          the card's edge and its action sits flush against it, square, with no gap */}
      {rows.length > 0 ? (
        <View className="overflow-hidden rounded-2xl border border-border-strong bg-raised">
          <Swipeable.Group>
            {rows.map((row, index) => (
              <SwipeRow
                key={row}
                row={row}
                first={index === 0}
                pinned={pinned.includes(row)}
                onPin={() =>
                  setPinned((list) =>
                    list.includes(row)
                      ? list.filter((item) => item !== row)
                      : [...list, row],
                  )
                }
                onDelete={() =>
                  setRows((list) => list.filter((item) => item !== row))
                }
              />
            ))}
          </Swipeable.Group>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Pressable
          onPress={() => setRows([0, 1, 2])}
          className="self-center rounded-full bg-sunken px-4 py-2 font-medium text-[13px] active:opacity-70"
        >
          Bring them back
        </Pressable>
      ) : (
        <span className="pt-2 text-center font-mono text-[12px] text-muted">
          drag a row left or right
        </span>
      )}
    </View>
  )
}

function SwipeRow({
  row,
  first,
  pinned,
  onPin,
  onDelete,
}: {
  row: number
  first: boolean
  pinned: boolean
  onPin: () => void
  onDelete: () => void
}) {
  return (
    <Swipeable>
      {/* opaque, so the actions parked behind it never show through; the separator is
          part of the row and inset to the text, as in an iOS list */}
      <Swipeable.Content>
        <View row className="items-stretch gap-3 bg-raised pl-4">
          <span
            className={cn(
              "size-2 shrink-0 self-center rounded-full bg-border-strong",
              pinned && "bg-brand",
            )}
          />
          <View
            className={cn(
              "min-w-0 flex-1 gap-0.5 py-3.5 pr-4",
              !first && "border-border-strong border-t",
            )}
          >
            <span className="truncate font-medium text-[14px]">
              {NOTES[row][0]}
            </span>
            <span className="text-[12px] text-muted">{NOTES[row][1]}</span>
          </View>
        </View>
      </Swipeable.Content>
      <Swipeable.LeftActions>
        <Pressable
          aria-label="Pin"
          onPress={onPin}
          className="flex h-full w-20 items-center justify-center bg-brand text-brand-foreground"
        >
          <Pin className="size-5" />
        </Pressable>
      </Swipeable.LeftActions>
      <Swipeable.RightActions>
        <Pressable
          aria-label="Delete"
          onPress={onDelete}
          className="flex h-full w-20 items-center justify-center bg-danger text-white"
        >
          <Trash2 className="size-5" />
        </Pressable>
      </Swipeable.RightActions>
    </Swipeable>
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
    <View className="w-full max-w-xs overflow-hidden rounded-2xl border border-border bg-raised">
      {SETTINGS.map(({ icon: Icon, label }, index) => (
        <View
          key={label}
          row
          className="items-center gap-3 border-border px-4 py-3 [&:not(:first-child)]:border-t"
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
          {/* edge to edge at every width, as a sheet is on a phone; only the copy keeps
              a readable measure. The panel is full width by default (the framework pins
              it `left: 0; right: 0`), so nothing here may cap the panel itself */}
          <Drawer.Content className="rounded-t-[28px] border-border border-t bg-surface text-foreground">
            <Drawer.Handle className="mt-2.5 bg-border-strong" />
            <Drawer.Shell className="mx-auto w-full max-w-xl gap-4 px-7 pt-5 pb-8">
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
          title="Swipe a row"
          line="Follows your finger, leaves vertical scrolling alone, and keeps one row open at a time."
        >
          <SwipeRows />
        </Card>
        <Card
          title="Spin the wheel"
          line="Flick it: it coasts, slows down and settles on a value without a jump."
        >
          <TimeWheel />
        </Card>
        <Card
          title="Open a sheet"
          line="Pull it down to close it. On a phone it stays above the keyboard; on Android, Back closes it."
        >
          <SheetTrigger />
        </Card>
        <Card
          className="md:col-span-2"
          title="Flip a switch"
          line="Screen readers get the label and the state. On a phone you feel a haptic tick."
        >
          <Switches />
        </Card>
      </View>
    </Section>
  )
}
