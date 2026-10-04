import { DrawerDemo } from "@/components/docs-demos/drawer-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "drawer",
  title: "Drawer",
  summary:
    "A bottom sheet that drags, flings, scrolls inside itself and makes room for the on-screen keyboard.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Drawer, useDrawer } from "@arrzdev/adaptv/components"',
  source: "src/components/drawer/drawer.tsx",
  blocks: [
    {
      type: "demo",
      component: DrawerDemo,
      code: `import { Drawer } from "@arrzdev/adaptv/components"

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
      text: "`Drawer` is a compound component. The root holds the open state and renders no box of its own (`display: contents`). Everything you put inside `Drawer.Portal` is rendered into `document.body` while the drawer is open or animating, and unmounted as soon as the close animation ends. Everything outside `Drawer.Portal`, such as a `Drawer.Trigger`, renders in place.",
    },
    {
      type: "p",
      text: "The drawer ships a neutral baseline (a white rounded panel, a 40% black overlay, a grey grabber). Your classes go on each part through `className` and win over that baseline. Build one wrapper per app that carries your colours, radius and padding, and use that everywhere. The wrapper under **Closing on the back button** is the usual shape.",
    },
    {
      type: "p",
      text: "There are four ways out of an open drawer: dragging it down, flicking it down, pressing the overlay, and `Drawer.Close` (or `hide()` from the ref). A fifth, the Android back button, is one hook call that you add yourself, shown under **Closing on the back button** below.",
    },
    {
      type: "note",
      tone: "warn",
      text: "To limit how tall the sheet grows, use the `maxHeight` prop on `Drawer.Content`. A `max-h-*`, `h-*` or `min-h-*` class on `Drawer.Content` does nothing: the element that takes `className` is the sheet plus a hidden tail below the screen edge, so those three utilities are locked.",
    },
    { type: "h3", text: "Controlled and uncontrolled" },
    {
      type: "p",
      text: "Pass `open` and `onOpenChange` to own the state, or leave both out and let `Drawer.Trigger`, `Drawer.Close` and the ref drive it, optionally starting from `defaultOpen`. In controlled mode `onOpenChange` is also called when the drawer follows a change you made to `open`, and it is called with `false` a second time when the close animation settles. Pass a state setter, or make your handler safe to call twice with the same value.",
    },
    {
      type: "code",
      label: "uncontrolled.tsx",
      lang: "tsx",
      code: `<Drawer onOpenChange={(open) => console.log(open)}>
  <Drawer.Trigger>Filters</Drawer.Trigger>
  <Drawer.Portal>
    <Drawer.Overlay />
    <Drawer.Content>
      <Drawer.Title>Filters</Drawer.Title>
      <Drawer.Close>Done</Drawer.Close>
    </Drawer.Content>
  </Drawer.Portal>
</Drawer>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "open",
          type: "boolean",
          description:
            "Controlled open state. When set, the drawer follows this value.",
        },
        {
          name: "defaultOpen",
          type: "boolean",
          default: "false",
          description: "Initial open state when uncontrolled.",
        },
        {
          name: "onOpenChange",
          type: "(open: boolean) => void",
          description:
            "Called when the drawer opens or closes for any reason: the trigger, the close button, the overlay, a drag, the ref.",
        },
        {
          name: "onAnimationEnd",
          type: "(open: boolean) => void",
          description:
            "Called when the open (`true`) or close (`false`) animation settles. Use it to reset a form after the sheet has left the screen.",
        },
        {
          name: "avoidKeyboard",
          type: "boolean",
          default: "true",
          description:
            "Make room for the on-screen keyboard when a field inside the drawer is focused. The **Keyboard** section below describes how.",
        },
        {
          name: "blurInputs",
          type: "boolean",
          default: "true",
          description:
            "On open, blur whatever is focused outside the drawer. Fields inside the panel are never blurred, so it is safe to leave on with an autofocused field.",
        },
        {
          name: "disableDrag",
          type: "boolean",
          default: "false",
          description:
            "Turn off the user's drag: the handle and the whole-sheet swipe. `show()`, `hide()`, the overlay, `Drawer.Close` and keyboard avoidance still work. It can be toggled while the drawer is open, for example while a hold-to-confirm button inside the panel is held.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "A `Drawer.Portal`, plus anything that should render in place (usually a `Drawer.Trigger`).",
        },
      ],
    },
    { type: "h2", text: "Parts" },
    {
      type: "table",
      head: ["Part", "Renders", "What it is for"],
      rows: [
        [
          "`Drawer.Trigger`",
          '`<button type="button">`',
          "Opens the drawer on click. Place it outside `Drawer.Portal`.",
        ],
        [
          "`Drawer.Portal`",
          "nothing",
          "Marks the children that belong to the sheet. They render into `document.body` only while the drawer is mounted.",
        ],
        [
          "`Drawer.Overlay`",
          "`<button>`",
          "The dim layer behind the sheet. Pressing it closes the drawer. `Drawer.Backdrop` is the same component under another name.",
        ],
        [
          "`Drawer.Content`",
          '`<div role="dialog" aria-modal="true">`',
          "The sheet. Holds the handle region, the scroll container and the footer.",
        ],
        [
          "`Drawer.Handle`",
          "`<span aria-hidden>`",
          "The grabber pill. A direct child of `Drawer.Content`. Leave it out and a default grabber is drawn.",
        ],
        [
          "`Drawer.Shell`",
          "`<div>` (flex column)",
          "Layout wrapper for the body. Carries your horizontal padding and gap.",
        ],
        [
          "`Drawer.Footer`",
          "`<div>` (flex column)",
          "An action area pinned below the scroll container. A direct child of `Drawer.Content`.",
        ],
        ["`Drawer.Title`", "`<h2>`", "The heading. No styles of its own."],
        [
          "`Drawer.Description`",
          "`<p>`",
          "Supporting text. No styles of its own.",
        ],
        [
          "`Drawer.Close`",
          '`<button type="button">`',
          "Closes the drawer on click.",
        ],
        [
          "`Drawer.Nested`",
          "same as `Drawer`",
          "A root for a drawer opened from inside another. Today it behaves exactly like `Drawer`.",
        ],
      ],
    },
    { type: "h3", text: "Drawer.Content" },
    {
      type: "p",
      text: "`Drawer.Content` sorts its direct children into three regions. A `Drawer.Handle` goes into the drag region at the top. A `Drawer.Footer` goes below the scroll container, where it stays visible. Everything else goes inside the scroll container. When the content is taller than the sheet is allowed to be, the scroll container scrolls and fades the edge that hides more content; the handle and footer stay put.",
    },
    {
      type: "props",
      rows: [
        {
          name: "maxHeight",
          type: "string | number",
          description:
            'The tallest the visible sheet may grow: a CSS length (`"60dvh"`, `"32rem"`) or a number of pixels. Content past it scrolls inside the sheet. It can only lower the ceiling. adaptv\'s own cap still applies: `97dvh` in a browser tab, and the viewport minus the top safe area when installed.',
        },
        {
          name: "scrollClassName",
          type: "string",
          description:
            "Classes for the inner scroll container. This is where bottom padding for the content belongs, including the bottom safe-area inset when there is no footer.",
        },
        {
          name: "shell",
          type: "boolean",
          default: "true",
          description:
            "Wrap the body in a `Drawer.Shell` automatically. If you place your own `Drawer.Shell` it is nested inside that one, which is harmless. Pass `false` to have your children sit directly in the scroll container.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Paint for the panel: background, radius, border, shadow, text colour, `max-w-*` with `mx-auto` on wide screens.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute passes through to the panel. `role`, `aria-modal`, `aria-hidden` and the engine's inline `transform` are owned by the component.",
    },
    { type: "h3", text: "Drawer.Overlay" },
    {
      type: "props",
      rows: [
        {
          name: "onTap",
          type: "() => void",
          description:
            "Runs just before the drawer closes from a press on the overlay.",
        },
        {
          name: "className",
          type: "string",
          description:
            "The dim colour, for example `bg-black/60`. The default is `bg-black/40`.",
        },
        {
          name: "onClick",
          type: "MouseEventHandler<HTMLButtonElement>",
          description:
            "Runs first. Call `event.preventDefault()` to stop the press from closing the drawer.",
        },
      ],
    },
    {
      type: "p",
      text: "The overlay only closes the drawer for a press that started on the overlay. The click that opened the drawer can land on the overlay a moment later when the trigger sits underneath it; that click is ignored.",
    },
    {
      type: "h3",
      text: "Trigger, Close, Handle, Shell, Footer, Title, Description",
    },
    {
      type: "p",
      text: "These take the attributes of the element they render plus `className`. `Drawer.Trigger` and `Drawer.Close` call your `onClick` first and skip their own action if you call `event.preventDefault()`. `Drawer.Handle` with children renders those children in place of the pill, so you can draw your own grabber. Both `Drawer.Trigger` and `Drawer.Close` must be rendered inside a `Drawer`.",
    },
    { type: "h2", text: "useDrawer" },
    {
      type: "api",
      name: "useDrawer()",
      signature: "function useDrawer(): DrawerContextValue",
      description:
        "Reads the state of the nearest `Drawer`. Use it in a part wrapper that paints differently while the drawer is open or while the keyboard is up, for example dropping the bottom safe-area padding when the keyboard covers it. It throws when called outside a `Drawer`.",
      returns:
        "An object with the fields below. It carries no actions; use the ref, `Drawer.Trigger` or `Drawer.Close` to open and close.",
    },
    {
      type: "props",
      rows: [
        {
          name: "isOpen",
          type: "boolean",
          description: "Whether the drawer is open.",
        },
        {
          name: "avoidKeyboard",
          type: "boolean",
          description: "The root's `avoidKeyboard` prop.",
        },
        {
          name: "isKeyboardOpen",
          type: "boolean",
          description:
            "`true` while the on-screen keyboard is up for a field inside this drawer.",
        },
      ],
    },
    {
      type: "code",
      label: "drawer-footer.tsx",
      lang: "tsx",
      code: `function SheetFooter({ children }: { children: ReactNode }) {
  const { isKeyboardOpen } = useDrawer()
  return (
    <Drawer.Footer className={cn("px-6 pt-3", isKeyboardOpen ? "pb-3" : "pb-safe-offset-2")}>
      {children}
    </Drawer.Footer>
  )
}
SheetFooter.displayName = "Drawer.Footer"`,
    },
    {
      type: "note",
      text: '`Drawer.Content` finds its handle and footer by display name. A wrapper around `Drawer.Handle` or `Drawer.Footer` must set `displayName` to `"Drawer.Handle"` or `"Drawer.Footer"`, and a wrapper around `Drawer.Portal` must set `"Drawer.Portal"`, or the part is treated as ordinary content.',
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "The root forwards a ref to an imperative handle. The type is exported as `DrawerHandle` (and as `DrawerRootHandle`).",
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
          description: "Closes the drawer with the normal animation.",
        },
        {
          name: "focus()",
          type: "() => void",
          description:
            "Focuses the drawer's `Drawer.Trigger`, or failing that the first button rendered in place inside the root.",
        },
      ],
    },
    { type: "h2", text: "Dragging" },
    {
      type: "p",
      text: "With a finger, the whole sheet is the drag surface. With a mouse, only the handle region at the top is, so text inside the sheet stays selectable on desktop.",
    },
    {
      type: "ul",
      items: [
        "The sheet follows the pointer one to one on the way down, and the overlay fades with it. In a mobile browser tab the browser toolbar is tinted along with the overlay.",
        "Release after dragging a quarter of the sheet's height, or faster than 0.4 px/ms at any distance, and it closes. Otherwise it springs back open.",
        "Pulling up past the resting position is resisted from the first pixel and never travels more than 40px.",
        "A drag that starts on scrollable content scrolls that content. The sheet only takes over a downward drag when the content was already at the top when the touch began. Scrolling to the top and continuing to pull does not dismiss; lift and swipe again.",
        "A touch that moves more sideways than down in its first 4px is left to the content for its whole life, so a carousel inside a drawer keeps working.",
        "A drag does not start while text is selected, or from inside an element marked `data-drawer-no-drag`.",
        "With the keyboard up, pulling down from the top of the content dismisses the keyboard and drags the sheet in the same gesture.",
      ],
    },
    {
      type: "code",
      label: "no-drag.tsx",
      lang: "tsx",
      code: `{/* a signature pad, a map, a slider: the sheet must not move under it */}
<div data-drawer-no-drag>
  <SignaturePad />
</div>`,
    },
    {
      type: "p",
      text: "The sheet opens over 380ms and closes over 220ms. A drawer drag competes with other gestures through adaptv's shared arbiter: an [edge swipe](/docs/app-shell-components) outranks it, and it outranks a [Swipeable](/docs/swipeable) row and a scroll.",
    },
    { type: "h2", text: "Keyboard" },
    {
      type: "p",
      text: "While a drawer is open the layout viewport is frozen, so the on-screen keyboard covers the bottom of the screen and the page does not resize. With `avoidKeyboard` on, the sheet answers a keyboard by growing: it holds the keyboard's height as empty room under its content and gets taller by the same amount, up to its height cap. What was visible stays visible. Whatever no longer fits scrolls inside the sheet, and the footer rides up with the panel.",
    },
    {
      type: "ul",
      items: [
        "Put `autoFocus` on a field to open the drawer with the keyboard up. Also give that field `data-autofocus`: a quick close and reopen reuses the mounted panel, React's `autoFocus` does not fire again, and the drawer refocuses the `[data-autofocus]` field itself.",
        "On iOS an autofocus only raises the keyboard when the drawer is rendered inside a route component. A drawer mounted in an app-wide provider focuses the field without raising the keyboard.",
        "Do not put an [AvoidKeyboard](/docs/avoid-keyboard) inside a drawer. The drawer does its own avoidance and the two fight.",
        "Swap padding on keyboard state with `useDrawer().isKeyboardOpen`. Padding changes on the scroll container are animated on the same curve as the sheet.",
      ],
    },
    {
      type: "p",
      text: "The [keyboard guide](/docs/keyboard) explains where the keyboard height comes from on each target.",
    },
    { type: "h2", text: "Closing on the back button" },
    {
      type: "p",
      text: "`Drawer` does not register itself for the back button. Without the wiring below, pressing back on Android navigates away and leaves the route underneath an open sheet. Register a handler at `BackPriority.Overlay`, which runs before router navigation. Return `false` when the drawer is closed so the press falls through to the next handler.",
    },
    {
      type: "code",
      label: "components/ui/drawer.tsx",
      lang: "tsx",
      code: `import { BackPriority } from "@arrzdev/adaptv/capabilities"
import type {
  DrawerContentProps,
  DrawerHandle,
  DrawerRootProps,
} from "@arrzdev/adaptv/components"
import { Drawer as BaseDrawer } from "@arrzdev/adaptv/components"
import { useBackHandler } from "@arrzdev/adaptv/hooks"
import { cn } from "@arrzdev/adaptv/utils"
import { forwardRef, useCallback, useRef } from "react"

const Root = forwardRef<DrawerHandle, DrawerRootProps>(function AppDrawer(props, forwardedRef) {
  // keep the handle so the back handler can read \`open\` and call \`hide()\`
  const handleRef = useRef<DrawerHandle | null>(null)
  const setRef = useCallback(
    (node: DrawerHandle | null) => {
      handleRef.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  useBackHandler(() => {
    if (!handleRef.current?.open) return false
    handleRef.current.hide()
    return true
  }, BackPriority.Overlay)

  return <BaseDrawer ref={setRef} {...props} />
})

function Content({ className, ...props }: DrawerContentProps) {
  return (
    <BaseDrawer.Content
      className={cn("rounded-t-3xl border-t border-gray-200 bg-white", className)}
      {...props}
    />
  )
}
Content.displayName = "Drawer.Content"

export const AppDrawer = Object.assign(Root, {
  Trigger: BaseDrawer.Trigger,
  Portal: BaseDrawer.Portal,
  Overlay: BaseDrawer.Overlay,
  Content,
  Handle: BaseDrawer.Handle,
  Shell: BaseDrawer.Shell,
  Footer: BaseDrawer.Footer,
  Title: BaseDrawer.Title,
  Description: BaseDrawer.Description,
  Close: BaseDrawer.Close,
})`,
    },
    {
      type: "p",
      text: "Handlers in the same priority band run newest first, so with two drawers open the one mounted last closes first. The chain is walked by the Android hardware back button and by `adaptvBack()`, which is what an in-app back button or an [edge swipe](/docs/app-shell-components) should call. A browser's own Back button does not walk it. `useBackHandler` is covered in [lifecycle hooks](/docs/hooks-lifecycle) and `BackPriority` in [capabilities](/docs/capabilities).",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Part", "`className` lands on", "Locked"],
      rows: [
        [
          "`Drawer.Overlay`",
          "the overlay button",
          "`fixed inset-0`, `z-[50]`, and the fade duration",
        ],
        [
          "`Drawer.Content`",
          "the panel",
          "`fixed inset-x-0`, `z-[51]`, `flex flex-col`, `h-auto min-h-0 max-h-[none]`, and the inline `transform` and `bottom`",
        ],
        [
          "`Drawer.Content` `scrollClassName`",
          "the scroll container",
          "`min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-none`, and the edge-fade mask",
        ],
        ["`Drawer.Shell`", "the wrapper", "`flex flex-col`"],
        ["`Drawer.Footer`", "the footer", "`shrink-0`"],
        [
          "`Drawer.Handle`, `Trigger`, `Close`, `Title`, `Description`",
          "the element",
          "nothing",
        ],
      ],
    },
    {
      type: "p",
      text: "The scroll container only scrolls vertically. A child that needs to scroll sideways brings its own horizontal [ScrollView](/docs/scroll-view). The panel is promoted to its own compositor layer with `will-change: transform`; leave that in place, since removing it makes text re-rasterise as the sheet lands.",
    },
    {
      type: "table",
      head: ["Attribute", "On", "Values"],
      rows: [
        ["`data-pwa-drawer`", "panel", "present"],
        ["`data-open`", "panel", '`"true"` or `"false"`'],
        ["`data-pwa-drawer-overlay`", "overlay", "present"],
        ["`data-state`", "overlay", '`"open"` or `"closed"`'],
        [
          "`data-dragging`",
          "overlay",
          '`"true"` while a drag or a drag-driven close is running',
        ],
        ["`data-drawer-trigger`", "trigger", "present"],
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        'The panel is `role="dialog"` with `aria-modal="true"`. The overlay is a button labelled "Close drawer".',
        "`Drawer.Title` and `Drawer.Description` are a plain `<h2>` and `<p>`. They are not linked to the dialog with `aria-labelledby` or `aria-describedby`; pass those attributes to `Drawer.Content` yourself if you need them.",
        "Focus is not trapped inside the panel and it is not moved into the panel on open, apart from an autofocused field.",
        "The Escape key does not close the drawer. Add a `keydown` listener that calls `hide()` if your desktop users expect it.",
      ],
    },
    {
      type: "note",
      text: "The last three points are gaps in the pre-alpha, written down so you can cover them in your wrapper.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Drag the handle with the mouse. There is no on-screen keyboard, so keyboard avoidance has nothing to do. On wide screens give `Drawer.Content` a `max-w-*` and `mx-auto`.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "The keyboard height is inferred from the visual viewport, so expect a frame of settling. The browser toolbar is tinted with the overlay. On a plain-`http` LAN address in Chrome the keyboard resizes the viewport instead, and the sheet caps itself to the visible height.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Same as mobile web. The sheet may grow to the viewport minus the top safe area.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Exact keyboard height from the OS. There is no system back gesture in the native shell; wire an edge swipe to `adaptvBack()` to close the drawer from the left edge.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Exact keyboard height from the OS. The hardware and gesture back button closes the drawer once you add the `useBackHandler` wiring above.",
        },
      ],
    },
  ],
}
