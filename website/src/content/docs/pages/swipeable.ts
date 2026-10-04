import { SwipeableDemo } from "@/components/docs-demos/swipeable-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "swipeable",
  title: "Swipeable",
  summary:
    "A list row that slides sideways to reveal actions, and leaves a vertical scroll alone.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Swipeable, useSwipeable } from "@arrzdev/adaptv/components"',
  source: "src/components/swipeable.tsx",
  blocks: [
    {
      type: "demo",
      component: SwipeableDemo,
      code: `import { Pressable, Swipeable, View } from "@arrzdev/adaptv/components"

<Swipeable.Group>
  {notes.map((note) => (
    <Swipeable key={note.id} className="rounded-xl">
      <Swipeable.Content>
        <View className="bg-white px-4 py-3.5">{note.title}</View>
      </Swipeable.Content>
      <Swipeable.LeftActions>
        <Pressable
          onPress={() => pin(note.id)}
          className="flex h-full w-20 items-center justify-center bg-blue-500 text-white"
        >
          Pin
        </Pressable>
      </Swipeable.LeftActions>
      <Swipeable.RightActions>
        <Pressable
          onPress={() => remove(note.id)}
          className="flex h-full w-20 items-center justify-center bg-red-500 text-white"
        >
          Delete
        </Pressable>
      </Swipeable.RightActions>
    </Swipeable>
  ))}
</Swipeable.Group>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "A `Swipeable` takes up to three slots as direct children. `Swipeable.Content` is the row that slides. `Swipeable.LeftActions` sits behind the row's left edge and is revealed by dragging right. `Swipeable.RightActions` sits behind the right edge and is revealed by dragging left. Leave a slot out and the row cannot be dragged in that direction.",
    },
    {
      type: "p",
      text: "The action panel is as wide as its content, so size the buttons (`w-20`) and give them `h-full`. Put any number of buttons in one panel; wrap them in a `<View row>` to lay them out. The buttons are ordinary elements: use [Pressable](/docs/pressable) or [Button](/docs/button) with your own handler. A horizontal swipe cancels a press that started on the row, so a drag never fires the row's `onPress`.",
    },
    {
      type: "p",
      text: "Wrap the rows of one list in `Swipeable.Group` so that opening a row closes the others. Without a group every row opens and closes on its own.",
    },
    {
      type: "note",
      text: "There is no full-swipe action. Dragging a row all the way across opens the panel; it does not run the first button. Deleting on a long swipe is something you build from `onOpen`.",
    },
    { type: "h3", text: "When a row closes by itself" },
    {
      type: "ul",
      items: [
        "Another row in the same `Swipeable.Group` opens.",
        "The nearest scrollable ancestor scrolls.",
        "A pointer is released anywhere outside the row.",
        "A button inside one of its action panels is clicked. Your handler runs first, then the row closes.",
        "A text field anywhere on the page takes focus and is about to raise the on-screen keyboard. This closes every open row.",
      ],
    },
    { type: "h3", text: "Vertical scrolling" },
    {
      type: "p",
      text: "A row decides what a gesture is after 8px of movement. Within 30 degrees of horizontal it is a swipe: the row takes the pointer and holds the page still for the rest of the touch. Anything steeper is a scroll, and the row ignores the gesture until the finger lifts. The content element sets `touch-action: pan-y`, so the browser keeps handling vertical pans natively. A list of swipeable rows inside a [ScrollView](/docs/scroll-view) scrolls as if the rows were plain.",
    },
    {
      type: "p",
      text: "A row swipe goes through the same gesture arbiter as the rest of adaptv. An [edge swipe](/docs/app-shell-components) and a [Drawer](/docs/drawer) drag both outrank it: a touch that starts in the screen's edge strip never opens a row, and a row that loses the pointer mid-swipe springs back. [PullToRefresh](/docs/pull-to-refresh) ignores touches that start on a row.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description:
            "`Swipeable.Content`, and one or both of `Swipeable.LeftActions` and `Swipeable.RightActions`. Other children are ignored.",
        },
        {
          name: "open",
          type: 'false | "left" | "right"',
          description:
            "Controlled open side. Omit it for an uncontrolled row. Once you have passed a value, passing `undefined` later closes the row, the same as `false`.",
        },
        {
          name: "onOpen",
          type: '(side: "left" | "right") => void',
          description:
            "Called when the row commits to opening, at the start of the spring.",
        },
        {
          name: "onClose",
          type: "() => void",
          description: "Called when the row has finished closing.",
        },
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description:
            "When `false` a new gesture does not start. It does not close a row that is already open.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the root. Put the radius here: the root is the only clipping surface.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "Inline style for the root.",
        },
      ],
    },
    { type: "h3", text: "Tuning" },
    {
      type: "p",
      text: "The release thresholds and the spring are props on the root too. The defaults are tuned to feel like a native mail list; change them per row only when you have a reason.",
    },
    {
      type: "props",
      rows: [
        {
          name: "openThreshold",
          type: "number",
          default: "0.3",
          description:
            "Fraction of the action panel's width the row must pass to open on release.",
        },
        {
          name: "closeThreshold",
          type: "number",
          default: "0.25",
          description:
            "Fraction of the open offset an open row must retreat to close on release.",
        },
        {
          name: "velocityThreshold",
          type: "number",
          default: "250",
          description:
            "Release speed in px/s that flicks the row open or closed regardless of position. A flick on an open row that carries it past closed and into the other side opens that side.",
        },
        {
          name: "directionLockAngle",
          type: "number",
          default: "30",
          description:
            "Largest angle from horizontal, in degrees, still treated as a swipe.",
        },
        {
          name: "overshootFriction",
          type: "number",
          default: "0.4",
          description:
            "How much of the finger's travel the row keeps once it is past the panel's width, from 0 to 1. Overshoot never exceeds half the panel's width.",
        },
        {
          name: "springStiffness",
          type: "number",
          default: "500",
          description: "Stiffness of the settle spring.",
        },
        {
          name: "springDamping",
          type: "number",
          default: "40",
          description: "Damping while opening.",
        },
        {
          name: "springDampingClose",
          type: "number",
          default: "55",
          description:
            "Damping while closing. Heavier, so the row does not bounce back open.",
        },
        {
          name: "springMass",
          type: "number",
          default: "0.8",
          description: "Mass of the settle spring.",
        },
      ],
    },
    { type: "h2", text: "Slots" },
    {
      type: "p",
      text: "`Swipeable.Content`, `Swipeable.LeftActions` and `Swipeable.RightActions` are markers. The root reads their `children` and renders them into its own elements; the slot components never render, and any other prop you give them is dropped. Style the element you put inside the slot.",
    },
    {
      type: "p",
      text: "To wrap a slot in your own component, give the wrapper the matching display name (`Swipeable.Content`, `Swipeable.LeftActions`, `Swipeable.RightActions`) and have it return the adaptv slot with your markup inside. The root recognises a slot by identity, by that display name, or by the exported symbols `SWIPEABLE_CONTENT_SLOT`, `SWIPEABLE_LEFT_ACTIONS_SLOT` and `SWIPEABLE_RIGHT_ACTIONS_SLOT` set to `true` on the component.",
    },
    {
      type: "code",
      label: "components/ui/swipeable.tsx",
      lang: "tsx",
      code: `function RightActions({ children }: { children: ReactNode }) {
  return (
    <Swipeable.RightActions>
      <View row className="h-full items-stretch">
        {children}
      </View>
    </Swipeable.RightActions>
  )
}
RightActions.displayName = "Swipeable.RightActions"`,
    },
    { type: "h2", text: "Swipeable.Group" },
    {
      type: "p",
      text: "Renders no element. Rows anywhere below it register themselves, however deeply nested.",
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The list.",
        },
        {
          name: "closeOnOpen",
          type: "boolean",
          default: "true",
          description: "Close the other rows when one opens.",
        },
      ],
    },
    {
      type: "p",
      text: "A ref on the group gives a `SwipeableGroupHandle`:",
    },
    {
      type: "props",
      rows: [
        {
          name: "closeAll()",
          type: "() => void",
          description:
            "Animates every open row in the group closed. Call it before entering an edit mode or navigating away.",
        },
      ],
    },
    { type: "h2", text: "useSwipeable" },
    {
      type: "api",
      name: "useSwipeable()",
      signature: "function useSwipeable(): SwipeableContextValue",
      description:
        "Reads the state of the nearest `Swipeable` from inside its content or its actions. Use it to paint a row differently while it is open. It throws when called outside a `Swipeable`.",
      returns: "An object with the fields below.",
    },
    {
      type: "props",
      rows: [
        {
          name: "isOpen",
          type: "boolean",
          description: "Whether either side is open.",
        },
        {
          name: "openSide",
          type: 'false | "left" | "right"',
          description: "Which side is open.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          description: "The root's `enabled` prop.",
        },
      ],
    },
    {
      type: "code",
      label: "row-card.tsx",
      lang: "tsx",
      code: `function RowCard({ children }: { children: ReactNode }) {
  const { isOpen } = useSwipeable()
  return (
    <View className={cn("bg-white px-4 py-3", isOpen && "bg-gray-50")}>
      {children}
    </View>
  )
}

<Swipeable>
  <Swipeable.Content>
    <RowCard>Groceries</RowCard>
  </Swipeable.Content>
  <Swipeable.RightActions>…</Swipeable.RightActions>
</Swipeable>`,
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "A ref on the row gives a `SwipeableHandle`. There is no imperative `open`; use the `open` prop for that.",
    },
    {
      type: "props",
      rows: [
        {
          name: "open",
          type: 'false | "left" | "right"',
          description: "Live open side. Read only.",
        },
        {
          name: "close()",
          type: "() => void",
          description:
            "Animates the row closed. Does nothing when it is closed.",
        },
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "`className` and `style` land on the root, which is `position: relative`, `overflow: hidden` and its own stacking context. Give the root your `rounded-*`. The action panels sit flush behind the content and the root's clip rounds their outer corners, so the buttons need no radius of their own. The root's radius is mirrored to a `clip-path`, which is what keeps a moving row inside rounded corners on iOS.",
    },
    {
      type: "p",
      text: "The panels and the overshoot fill are parked off screen while the row is closed, so nothing is drawn behind the content and the content may be transparent. When you drag past the panel's width, the gap is filled with the background colour of the button nearest the content, read from the DOM when the panel is measured.",
    },
    {
      type: "p",
      text: "The content element sets `user-select: none`, so pressing on a label and dragging swipes the row and does not select text. All structural rules live in a low-priority cascade layer, so an ordinary rule of yours overrides any of them.",
    },
    {
      type: "table",
      head: ["Attribute", "On"],
      rows: [
        ['`data-adaptv="swipeable"`, `data-swipeable-root`', "the root"],
        ["`data-swipeable-content`", "the sliding element around your content"],
        [
          '`data-swipeable-actions="left"` / `"right"`',
          "the panel around your actions",
        ],
        ['`data-swipeable-fill="left"` / `"right"`', "the overshoot fill"],
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: "Swiping is a pointer gesture with no keyboard equivalent, and the action buttons are in the DOM but off screen while the row is closed. Give every action another route: a context menu, an edit mode, or buttons on the detail screen. With reduced motion on, the row jumps to its open or closed position with no spring.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Drag with the left mouse button or a pen.",
        },
        { target: "Mobile web", status: "yes" },
        {
          target: "Installed PWA",
          status: "yes",
          note: "With [EdgeSwipeGestures](/docs/app-shell-components) mounted, a touch that starts in the edge strip goes to the edge swipe and never opens a row.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Same edge rule as the installed PWA.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Under gesture navigation the system claims a touch that starts at the very edge of the screen for its own back gesture, so that touch never reaches the row.",
        },
      ],
    },
  ],
}
