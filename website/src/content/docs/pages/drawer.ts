import { DrawerDemo } from "@/components/docs-demos/drawer-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "drawer",
  title: "Drawer",
  summary: "A bottom sheet you can drag down to close.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Drawer, useDrawer } from "adaptv/components"',
  source: "src/components/drawer/drawer.tsx",
  blocks: [
    {
      type: "demo",
      component: DrawerDemo,
      code: `import { Drawer } from "adaptv/components"

const [open, setOpen] = useState(false)

<Drawer open={open} onOpenChange={setOpen}>
  <Drawer.Trigger className="rounded-full bg-black px-6 py-3 text-white">
    Open the drawer
  </Drawer.Trigger>
  <Drawer.Portal>
    <Drawer.Overlay className="bg-black/60" />
    <Drawer.Content className="mx-auto max-w-xl rounded-t-3xl bg-white">
      <Drawer.Handle className="mt-2.5 bg-gray-300" />
      <Drawer.Shell className="gap-3 px-7 pt-4">
        <Drawer.Title className="text-xl font-semibold">Drag me down</Drawer.Title>
        <Drawer.Description className="text-sm text-gray-600">
          Let go past a quarter of the height, or flick it, and it closes.
        </Drawer.Description>
      </Drawer.Shell>
      <Drawer.Footer className="px-7 pt-4 pb-7">
        <Drawer.Close className="h-12 rounded-full bg-gray-100">Close</Drawer.Close>
      </Drawer.Footer>
    </Drawer.Content>
  </Drawer.Portal>
</Drawer>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`Drawer` is a compound component. Put `Drawer.Trigger` in place. Put `Drawer.Overlay` and `Drawer.Content` inside `Drawer.Portal`, which renders into `document.body` while the drawer is open. Your `className` on each part wins over the neutral baseline. A drawer closes on a drag down, a fast flick, a press on the overlay, `Drawer.Close`, `hide()` and the Android back button.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Limit the height with the `maxHeight` prop on `Drawer.Content`. The `max-h-*`, `h-*` and `min-h-*` classes do nothing there.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "open",
          type: "boolean",
          description: "Controlled open state.",
        },
        {
          name: "defaultOpen",
          type: "boolean",
          default: "false",
          description: "Initial state when uncontrolled.",
        },
        {
          name: "onOpenChange",
          type: "(open: boolean) => void",
          description:
            "Called on every open or close. In controlled mode it can run twice with `false`. Make the handler safe for that.",
        },
        {
          name: "onAnimationEnd",
          type: "(open: boolean) => void",
          description: "Called when the open or close animation ends.",
        },
        {
          name: "avoidKeyboard",
          type: "boolean",
          default: "true",
          description:
            "Grow the sheet when the on-screen keyboard opens for a field inside it.",
        },
        {
          name: "blurInputs",
          type: "boolean",
          default: "true",
          description: "On open, blur the focused field outside the drawer.",
        },
        {
          name: "disableDrag",
          type: "boolean",
          default: "false",
          description: "Turn off dragging. Everything else still works.",
        },
      ],
    },
    { type: "h2", text: "Parts" },
    {
      type: "table",
      head: ["Part", "Renders", "Use"],
      rows: [
        [
          "`Drawer.Trigger`",
          "`button`",
          "Opens the drawer. Put it outside the portal.",
        ],
        ["`Drawer.Portal`", "nothing", "Holds the sheet parts."],
        [
          "`Drawer.Overlay`",
          "`button`",
          "The dim layer. A press closes the drawer. `Drawer.Backdrop` is the same part.",
        ],
        ["`Drawer.Content`", '`div role="dialog"`', "The sheet."],
        [
          "`Drawer.Handle`",
          "`span`",
          "The grabber. A default one shows if you omit it.",
        ],
        [
          "`Drawer.Shell`",
          "`div`",
          "Body layout. Carries your padding and gap.",
        ],
        [
          "`Drawer.Footer`",
          "`div`",
          "An area pinned below the scrolling body.",
        ],
        ["`Drawer.Title`", "`h2`", "The heading."],
        ["`Drawer.Description`", "`p`", "Supporting text."],
        ["`Drawer.Close`", "`button`", "Closes the drawer."],
        [
          "`Drawer.Nested`",
          "same as `Drawer`",
          "A root for a drawer opened inside another.",
        ],
      ],
    },
    { type: "h3", text: "Drawer.Content" },
    {
      type: "props",
      rows: [
        {
          name: "maxHeight",
          type: "string | number",
          description:
            'The tallest the sheet may grow. A CSS length such as `"60dvh"`, or pixels. It can only lower the built-in limit.',
        },
        {
          name: "scrollClassName",
          type: "string",
          description:
            "Classes for the inner scroll container. Put bottom padding here.",
        },
        {
          name: "shell",
          type: "boolean",
          default: "true",
          description: "Wrap the body in a `Drawer.Shell`.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Paint for the panel: background, radius, border, shadow.",
        },
      ],
    },
    { type: "h3", text: "Drawer.Overlay" },
    {
      type: "props",
      rows: [
        {
          name: "onTap",
          type: "() => void",
          description:
            "Runs just before a press on the overlay closes the drawer.",
        },
        {
          name: "onClick",
          type: "MouseEventHandler<HTMLButtonElement>",
          description:
            "Runs first. Call `event.preventDefault()` to keep the drawer open.",
        },
        {
          name: "className",
          type: "string",
          description: "The dim colour. The default is `bg-black/40`.",
        },
      ],
    },
    {
      type: "p",
      text: "`Drawer.Trigger` and `Drawer.Close` call your `onClick` first. They skip their action after `event.preventDefault()`. A wrapper around `Drawer.Handle`, `Drawer.Footer` or `Drawer.Portal` must set `displayName` to the same name. If not, `Drawer.Content` treats it as plain content.",
    },
    { type: "h2", text: "useDrawer" },
    {
      type: "api",
      name: "useDrawer()",
      signature:
        "function useDrawer(): { isOpen: boolean; avoidKeyboard: boolean; isKeyboardOpen: boolean }",
      description:
        "Reads the state of the nearest `Drawer`. Throws outside a `Drawer`. `isKeyboardOpen` is true while the keyboard is up for a field inside this drawer.",
      returns: "The three fields above.",
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "The root forwards a ref of type `DrawerHandle`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "open",
          type: "boolean",
          description: "Live open state. Read only.",
        },
        {
          name: "show()",
          type: "() => void",
          description: "Opens the drawer.",
        },
        {
          name: "hide()",
          type: "() => void",
          description: "Closes the drawer.",
        },
        {
          name: "focus()",
          type: "() => void",
          description: "Focuses the trigger, or the first button in the root.",
        },
      ],
    },
    { type: "h2", text: "Dragging" },
    {
      type: "ul",
      items: [
        "A finger drags from anywhere on the sheet. A mouse drags from the handle area only.",
        "The sheet closes when you release past a quarter of its height, or faster than 0.4 px/ms. Otherwise it springs back.",
        "A drag that starts on scrollable content scrolls it. The sheet moves only if the content was at the top when the touch began.",
        "Mark an element `data-drawer-no-drag` to stop drags that start inside it.",
      ],
    },
    { type: "h2", text: "Keyboard" },
    {
      type: "p",
      text: "With `avoidKeyboard` on, the sheet grows by the keyboard height, up to its limit. Content that no longer fits scrolls. Put `autoFocus` and `data-autofocus` on a field to open the drawer with the keyboard up. Do not put an [AvoidKeyboard](/docs/avoid-keyboard) inside a drawer. See the [keyboard guide](/docs/keyboard).",
    },
    { type: "h2", text: "Back button" },
    {
      type: "p",
      text: "An open drawer closes on the Android back button and on `adaptvBack()`. It does this before the route changes. With two drawers open, the last one opened closes first. The browser Back button does not use this chain.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Part", "`className` lands on", "Locked"],
      rows: [
        ["`Drawer.Overlay`", "the overlay button", "`fixed inset-0`, `z-[50]`"],
        [
          "`Drawer.Content`",
          "the panel",
          "`fixed inset-x-0`, `z-[51]`, `flex flex-col`, height classes, inline `transform` and `bottom`",
        ],
        [
          "`scrollClassName`",
          "the scroll container",
          "`overflow-y-auto overflow-x-hidden overscroll-y-none`",
        ],
        ["`Drawer.Shell`", "the wrapper", "`flex flex-col`"],
        ["`Drawer.Footer`", "the footer", "`shrink-0`"],
      ],
    },
    {
      type: "p",
      text: "Data attributes: `data-open` on the panel, `data-state` (`open` or `closed`) and `data-dragging` on the overlay. Leave `will-change: transform` on the panel.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: 'The panel has `role="dialog"` and `aria-modal="true"`. Pass `aria-labelledby` and `aria-describedby` to `Drawer.Content` yourself. Escape does not close the drawer, and focus is not trapped.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Drag the handle with the mouse. Use `max-w-*` and `mx-auto` on wide screens.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "The keyboard height is estimated, so it settles over a frame.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "The sheet may grow to the viewport minus the top safe area.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Exact keyboard height. Wire an edge swipe to `adaptvBack()`.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Exact keyboard height. The back button closes the drawer.",
        },
      ],
    },
  ],
}
