import { Drawer, View } from "@arrzdev/adaptv/components"
import { useState } from "react"

export function DrawerDemo() {
  const [open, setOpen] = useState(false)
  const [locked, setLocked] = useState(false)
  return (
    <View className="items-center gap-3">
      <Drawer open={open} onOpenChange={setOpen} disableDrag={locked}>
        <Drawer.Trigger className="h-11 cursor-pointer rounded-full bg-foreground px-6 font-medium text-[14px] text-background">
          Open the drawer
        </Drawer.Trigger>
        <Drawer.Portal>
          <Drawer.Overlay className="bg-black/60" />
          <Drawer.Content className="mx-auto max-w-xl rounded-t-[28px] border-border border-t bg-surface text-foreground">
            <Drawer.Handle className="mt-2.5 bg-border-strong" />
            <Drawer.Shell className="gap-3 px-7 pt-4">
              <Drawer.Title className="font-semibold text-[20px] tracking-tight">
                Drag me down
              </Drawer.Title>
              <Drawer.Description className="text-[14px] text-subtle leading-relaxed">
                Grab the handle with the mouse, or drag anywhere on the sheet
                with a finger. Let go past a quarter of its height, or flick it,
                and it closes.
              </Drawer.Description>
              <label className="flex cursor-pointer flex-row items-center gap-2 pt-1 text-[13px] text-muted">
                <input
                  type="checkbox"
                  checked={locked}
                  onChange={(event) => setLocked(event.target.checked)}
                />
                disableDrag
              </label>
            </Drawer.Shell>
            <Drawer.Footer className="px-7 pt-4 pb-7">
              <Drawer.Close className="h-12 cursor-pointer rounded-full bg-sunken font-medium text-[15px] text-foreground">
                Close
              </Drawer.Close>
            </Drawer.Footer>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
      <span className="font-mono text-[13px] text-muted">
        open: {String(open)}
      </span>
    </View>
  )
}
