import { SwipeableDemo } from "@/components/docs-demos/swipeable-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "swipeable",
  title: "Swipeable",
  summary: "A row that slides sideways to show actions.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Swipeable, useSwipeable } from "adaptv/components"',
  source: "src/components/swipeable.tsx",
  blocks: [
    {
      type: "demo",
      component: SwipeableDemo,
      code: `import { Pressable, Swipeable, View } from "adaptv/components"

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
      text: "Give `Swipeable` up to three direct children. `Swipeable.Content` is the row that slides. `Swipeable.LeftActions` shows on a drag right. `Swipeable.RightActions` shows on a drag left. Omit a slot and the row does not move that way. Size the action buttons yourself, for example `w-20 h-full`. Wrap the rows of one list in `Swipeable.Group` so that opening a row closes the others. A row also closes when its list scrolls, when a button in its panel is clicked, or when a text field raises the keyboard.",
    },
    {
      type: "p",
      text: "A swipe starts after 8px of movement within 30 degrees of horizontal. A steeper move scrolls. A [ScrollView](/docs/scroll-view) of swipeable rows scrolls as normal. An [edge swipe](/docs/app-shell-components) and a [Drawer](/docs/drawer) drag outrank a row swipe. There is no full-swipe action.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "open",
          type: 'false | "left" | "right"',
          description: "Controlled open side. Omit it for an uncontrolled row.",
        },
        {
          name: "onOpen",
          type: '(side: "left" | "right") => void',
          description: "Called when the row starts to open.",
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
          description: "`false` stops new gestures. An open row stays open.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root. Put `rounded-*` here.",
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
      type: "props",
      rows: [
        {
          name: "openThreshold",
          type: "number",
          default: "0.3",
          description:
            "Fraction of the panel width to pass to open on release.",
        },
        {
          name: "closeThreshold",
          type: "number",
          default: "0.25",
          description:
            "Fraction of the open offset to retreat to close on release.",
        },
        {
          name: "velocityThreshold",
          type: "number",
          default: "250",
          description:
            "Release speed in px/s that flicks the row open or closed.",
        },
        {
          name: "directionLockAngle",
          type: "number",
          default: "30",
          description:
            "Largest angle from horizontal, in degrees, that counts as a swipe.",
        },
        {
          name: "overshootFriction",
          type: "number",
          default: "0.4",
          description:
            "Share of finger travel kept past the panel width, 0 to 1.",
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
          description: "Damping while closing.",
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
      text: "The three slots are markers. They render nothing themselves and drop any prop except `children`. Style the element inside the slot. To wrap a slot, set the wrapper `displayName` to the slot name, for example `Swipeable.RightActions`. adaptv reads the wrapper's `children` and never renders the wrapper, so markup the wrapper adds is dropped.",
    },
    { type: "h2", text: "Swipeable.Group" },
    {
      type: "props",
      rows: [
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
      text: "A ref on the group has `closeAll()`, which closes every open row.",
    },
    { type: "h2", text: "useSwipeable" },
    {
      type: "api",
      name: "useSwipeable()",
      signature: "function useSwipeable(): SwipeableContextValue",
      description:
        "Reads the state of the nearest `Swipeable`, from its content or actions. Throws outside a `Swipeable`.",
      returns:
        '`isOpen` (boolean), `openSide` (`false | "left" | "right"`) and `isEnabled` (boolean).',
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "A ref on the row is a `SwipeableHandle`. It has `open` (the live side, read only) and `close()`. To open a row, use the `open` prop.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "`className` and `style` go on the root. It is `position: relative` and `overflow: hidden`. Its radius clips the action panels, so buttons need no radius. Panels are off screen while the row is closed, so the content may be transparent. Past the panel width, the gap takes the colour of the nearest button. Content has `user-select: none`.",
    },
    {
      type: "table",
      head: ["Attribute", "On"],
      rows: [
        ['`data-adaptv="swipeable"`, `data-swipeable-root`', "the root"],
        ["`data-swipeable-content`", "the sliding element"],
        ['`data-swipeable-actions="left"` or `"right"`', "the action panel"],
        ['`data-swipeable-fill="left"` or `"right"`', "the overshoot fill"],
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: "A swipe has no keyboard equivalent. Give each action another route, such as a menu or the detail screen. With reduced motion on, the row jumps with no spring.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Drag with the mouse or a pen.",
        },
        { target: "Mobile web", status: "yes" },
        {
          target: "Installed PWA",
          status: "yes",
          note: "A touch in the edge strip goes to the edge swipe.",
        },
        { target: "iOS", status: "yes", note: "Same edge rule." },
        {
          target: "Android",
          status: "yes",
          note: "The system back gesture takes touches at the very edge.",
        },
      ],
    },
  ],
}
