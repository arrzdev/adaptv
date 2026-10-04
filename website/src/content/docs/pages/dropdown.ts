import { DropdownDemo } from "@/components/docs-demos/dropdown-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "dropdown",
  title: "Dropdown",
  summary:
    "An anchored menu that flips, shifts and caps its height to stay on screen, and closes on an outside press, Escape or the back button.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Dropdown } from "@arrzdev/adaptv/components"',
  source: "src/components/dropdown/dropdown.tsx",
  blocks: [
    {
      type: "demo",
      component: DropdownDemo,
      code: `import { Dropdown } from "@arrzdev/adaptv/components"

<Dropdown placement="bottom-start">
  <Dropdown.Trigger
    aria-label="File actions"
    className="rounded-lg bg-white px-3 py-2 text-sm font-medium outline outline-1 outline-gray-300"
  >
    Actions
  </Dropdown.Trigger>
  <Dropdown.Content
    aria-label="File actions"
    className="min-w-44 rounded-lg bg-white ring-gray-200"
  >
    <Dropdown.Item onSelect={() => rename(file)} className="hover:bg-gray-100">
      Rename
    </Dropdown.Item>
    <Dropdown.Item onSelect={() => duplicate(file)} className="hover:bg-gray-100">
      Duplicate
    </Dropdown.Item>
    <Dropdown.Item disabled>Move to…</Dropdown.Item>
    <Dropdown.Item onSelect={() => remove(file)} className="text-red-600 hover:bg-gray-100">
      Delete
    </Dropdown.Item>
  </Dropdown.Content>
</Dropdown>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "Compose three parts inside `Dropdown`: a `Dropdown.Trigger`, a `Dropdown.Content`, and `Dropdown.Item` children. It works uncontrolled with no props at all, or controlled with `open` and `onOpenChange`. The root renders no element of its own; it only shares state between the parts.",
    },
    {
      type: "p",
      text: "Reach for it for a short list of actions attached to a button: a row's overflow menu, a sort order, an account menu. For a long or form-like choice on a phone, a [Drawer](/docs/drawer) is the better surface.",
    },
    {
      type: "p",
      text: "The panel is `position: fixed` and placed from the trigger's live viewport rectangle. That is deliberate: a fixed panel is not clipped by an `overflow: hidden` or scrolling ancestor, so a trigger inside a horizontal carousel still opens a full menu over the page. The panel is rendered in place, without a portal.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The default panel and item classes use the theme colours `surface`, `border` and `foreground` (`bg-surface`, `ring-border`, `text-foreground`). Define them in your Tailwind `@theme`, or pass your own background, ring and text colour through `className`. Without either, the panel has a shadow and no background. See [Theming](/docs/theming).",
    },
    { type: "h2", text: "Dropdown props" },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The trigger and the content.",
        },
        {
          name: "open",
          type: "boolean",
          description: "Controlled open state. Pair it with `onOpenChange`.",
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
            "Fired whenever the menu asks to open or close: a trigger press, an item activation, an outside press, Escape, or back.",
        },
        {
          name: "placement",
          type: '"bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top"',
          default: '"bottom-start"',
          description:
            "Preferred side and alignment. The side may flip and the panel may shift; this is where it goes when there is room.",
        },
      ],
    },
    { type: "h2", text: "Dropdown.Trigger" },
    {
      type: "p",
      text: 'A `<button type="button">` with `aria-haspopup="menu"` and a live `aria-expanded`. It has no styles of its own. A press toggles the menu.',
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The button's content.",
        },
        {
          name: "className",
          type: "string",
          description: "All of the button's look.",
        },
        {
          name: "onClick",
          type: "(event: MouseEvent<HTMLButtonElement>) => void",
          description:
            "Runs before the toggle. Call `event.preventDefault()` to stop the menu from toggling.",
        },
        {
          name: "disabled",
          type: "boolean",
          description: "Disables the button.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Accessible name for an icon-only trigger.",
        },
      ],
    },
    {
      type: "p",
      text: "These are the only props the trigger accepts. It always renders its own `<button>`; there is no way to hand it a different element, so style this one instead of nesting a `Button` inside it.",
    },
    { type: "h2", text: "Dropdown.Content" },
    {
      type: "p",
      text: 'The panel: a `<div role="menu">`. It is mounted only while the menu is open, so there is no closed state to style and no exit animation to run.',
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description:
            "`Dropdown.Item` elements, and anything else you want in the panel.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Merged over the baseline `min-w-[8rem] rounded-md bg-surface p-1 shadow-lg ring-1 ring-border`.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            "Inline style. `position`, `left`, `top`, `maxHeight`, `maxWidth` and `visibility` are owned by the positioning and cannot be overridden.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Accessible name for the menu.",
        },
      ],
    },
    { type: "h2", text: "Dropdown.Item" },
    {
      type: "p",
      text: 'A full-width `<button type="button" role="menuitem">`. Activating it calls `onSelect`, then closes the menu.',
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The row's content.",
        },
        {
          name: "onSelect",
          type: "() => void",
          description: "Fired on activation, before the menu closes.",
        },
        {
          name: "onClick",
          type: "(event: MouseEvent<HTMLButtonElement>) => void",
          description:
            "Runs first. Call `event.preventDefault()` to skip `onSelect` and keep the menu open, for example on a row that toggles a setting.",
        },
        {
          name: "disabled",
          type: "boolean",
          description:
            "Disables the row. It dims to `opacity-40` and shows `cursor-not-allowed`, and the menu still scrolls when a finger starts on it.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Merged over the baseline `flex w-full items-center rounded-sm px-3 py-2 text-sm text-foreground disabled:opacity-40 cursor-pointer`. There is no default hover or focus colour; add `hover:` and `focus-visible:` classes here.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Accessible name for an icon-only row.",
        },
      ],
    },
    { type: "h2", text: "Positioning" },
    {
      type: "p",
      text: "The position is computed before the first paint, so the panel never flashes in the wrong place, and again on every scroll of any ancestor and on window resize, so the panel follows its trigger. The steps, in order:",
    },
    {
      type: "ol",
      items: [
        "**Side.** Open on the preferred side, 6px from the trigger. If the content does not fit there and fits on the other side, flip. If it fits on neither, use the side with more room.",
        "**Height.** Cap the panel to the room on that side and let it scroll inside. The cap never goes below 96px, so a menu in a tight spot stays usable and overlaps its trigger if it has to.",
        "**Alignment.** `start` lines the panel's left edge up with the trigger's left edge, `end` lines up the right edges, and a placement with no suffix centres it. Alignment is physical: it does not mirror in a right-to-left layout.",
        "**Shift.** Slide the panel horizontally and vertically so it stays 8px inside the viewport, measured from the safe-area insets. A menu near the bottom of a phone clears the home indicator. This holds even when the trigger is scrolled partly off screen.",
      ],
    },
    {
      type: "p",
      text: "The side and alignment actually used are exposed as `data-side` and `data-align` on the panel, so an entrance animation can grow from the correct edge.",
    },
    {
      type: "code",
      label: "origin-follows-the-flip.tsx",
      lang: "tsx",
      code: `<Dropdown.Content className="data-[side=bottom]:origin-top data-[side=top]:origin-bottom">
  …
</Dropdown.Content>`,
    },
    {
      type: "note",
      text: "The panel is measured when it opens, when something scrolls and when the window resizes. It is not re-measured when its own content changes size while open. Also, `position: fixed` resolves against the nearest ancestor that has a `transform`, `filter` or `perspective`, so a Dropdown rendered inside such an element is placed relative to it and lands in the wrong spot.",
    },
    { type: "h2", text: "Dismissal" },
    {
      type: "table",
      head: ["What happens", "Result"],
      rows: [
        ["An item is activated", "`onSelect` runs, then the menu closes."],
        ["The trigger is pressed again", "The menu closes."],
        [
          "A press anywhere outside the panel and the trigger",
          "The menu closes on `pointerdown`. The press is not swallowed: whatever was under it also receives it.",
        ],
        [
          "Escape",
          "The menu closes, the event stops propagating so nothing behind it also closes, and focus returns to the trigger.",
        ],
        ["Back", "The menu closes and the route stays where it is."],
      ],
    },
    { type: "h3", text: "Back-button behaviour" },
    {
      type: "p",
      text: "While open, the menu registers a handler on adaptv's back chain at `BackPriority.Transient`. The chain runs highest priority first and stops at the first handler that consumes the press, so an open menu closes before the router navigates. An open [Drawer](/docs/drawer) sits one band higher (`BackPriority.Overlay`): with a menu open over a drawer's page, back closes the drawer first.",
    },
    {
      type: "p",
      text: "The chain is run by the Android hardware back button and back gesture in a native build, and by `adaptvBack()`, which is what an in-app back button should call. The browser's own Back button does not go through the chain: it navigates, and the menu unmounts with the page. See [useBackHandler](/docs/hooks-lifecycle) for registering your own handlers.",
    },
    { type: "h2", text: "Keyboard" },
    {
      type: "ul",
      items: [
        "The trigger and the items are native buttons: Tab reaches them, and Enter or Space activates them.",
        "Escape closes the menu and returns focus to the trigger.",
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: 'That is all of it today. Opening the menu does not move focus into it, the arrow keys do not move between items, there is no type-ahead, and focus is not returned to the trigger when the menu closes any other way than Escape. The panel has `role="menu"` and the items `role="menuitem"`, so a screen reader announces a menu, but the full menu keyboard pattern is not built yet. Because the panel renders in place, right after the trigger in the DOM, Tab from the trigger lands on the first item.',
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Element", "Hook", "Locked"],
      rows: [
        [
          "Trigger",
          '`[data-adaptv="dropdown-trigger"]`, `aria-expanded`',
          "Nothing. Branch on the open state with `aria-expanded:` variants or from your controlled `open`.",
        ],
        [
          "Panel",
          '`[data-adaptv="dropdown"]`, `data-side`, `data-align`',
          "`z-50 overflow-y-auto overscroll-contain` and the inline position. The panel is the scroll container for a capped menu, and its overscroll is contained so a fling inside it never scrolls the page.",
        ],
        [
          "Item",
          '`[data-adaptv="dropdown-item"]`, `:disabled`',
          "`text-start` and the `touch-action` classes. A `touch-none` on an item would make every row a dead zone for scrolling the menu, so it is dropped. The cursor is yours: `cursor-wait` on a pending item wins.",
        ],
      ],
    },
    { type: "h2", text: "What is not here" },
    {
      type: "p",
      text: "There are no separators, group labels, checkbox or radio items, submenus, left or right placements, or collision boundaries other than the viewport. A separator is a `<div>` you put between items; the rest is unbuilt.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse, Tab and Escape. The browser's Back button navigates; it does not close the menu first.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Outside tap closes it. The browser's back gesture navigates.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "The safe-area insets are folded into the placement. An in-app back button that calls `adaptvBack()` closes the menu first.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "No hardware back. A back affordance or edge swipe closes the menu first when it is wired to `adaptvBack()`.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Hardware back and the system back gesture close the menu before they pop the route.",
        },
      ],
    },
  ],
}
