import { DropdownDemo } from "@/components/docs-demos/dropdown-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "dropdown",
  title: "Dropdown",
  summary: "A menu attached to a button.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Dropdown } from "adaptv/components"',
  source: "src/components/dropdown/dropdown.tsx",
  blocks: [
    {
      type: "demo",
      component: DropdownDemo,
      code: `import { Dropdown } from "adaptv/components"

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
      text: "Put a `Dropdown.Trigger`, a `Dropdown.Content` and `Dropdown.Item` children inside `Dropdown`. Use it for a short list of actions on a button. The panel flips, shifts and limits its height to stay on screen. It closes on an outside press, Escape or back.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The default classes use the theme colours `surface`, `border` and `foreground`. Define them in your `@theme`, or set your own colours with `className`. See [Theming](/docs/theming).",
    },
    { type: "h2", text: "Props" },
    { type: "h3", text: "Dropdown" },
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
          description: "Called when the menu opens or closes.",
        },
        {
          name: "placement",
          type: '"bottom-start" | "bottom-end" | "bottom" | "top-start" | "top-end" | "top"',
          default: '"bottom-start"',
          description:
            "Preferred side and alignment. The side flips when there is no room.",
        },
      ],
    },
    { type: "h3", text: "Dropdown.Trigger" },
    {
      type: "p",
      text: "A button. It accepts only these props.",
    },
    {
      type: "props",
      rows: [
        {
          name: "className",
          type: "string",
          description: "The look of the button.",
        },
        {
          name: "onClick",
          type: "(event: MouseEvent<HTMLButtonElement>) => void",
          description:
            "Runs before the toggle. Call `event.preventDefault()` to stop the toggle.",
        },
        {
          name: "disabled",
          type: "boolean",
          description: "Disables the button.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Name for an icon-only trigger.",
        },
      ],
    },
    { type: "h3", text: "Dropdown.Content" },
    {
      type: "p",
      text: "The panel. It exists only while the menu is open.",
    },
    {
      type: "props",
      rows: [
        {
          name: "className",
          type: "string",
          description:
            "Merged over `min-w-[8rem] rounded-md bg-surface p-1 shadow-lg ring-1 ring-border`.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            "Inline style. Position and size limits cannot be overridden.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Name for the menu.",
        },
      ],
    },
    { type: "h3", text: "Dropdown.Item" },
    {
      type: "props",
      rows: [
        {
          name: "onSelect",
          type: "() => void",
          description: "Called on activation. The menu then closes.",
        },
        {
          name: "onClick",
          type: "(event: MouseEvent<HTMLButtonElement>) => void",
          description:
            "Runs first. Call `event.preventDefault()` to skip `onSelect` and keep the menu open.",
        },
        { name: "disabled", type: "boolean", description: "Disables the row." },
        {
          name: "className",
          type: "string",
          description:
            "Merged over the baseline classes. There is no default hover colour. Add `hover:` classes.",
        },
        {
          name: "aria-label",
          type: "string",
          description: "Name for an icon-only row.",
        },
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Element", "Hook"],
      rows: [
        ["Trigger", '`[data-adaptv="dropdown-trigger"]`, `aria-expanded`'],
        ["Panel", '`[data-adaptv="dropdown"]`, `data-side`, `data-align`'],
        ["Item", '`[data-adaptv="dropdown-item"]`'],
      ],
    },
    {
      type: "p",
      text: "The panel is `position: fixed`, so a scrolling parent does not clip it. Do not put a Dropdown inside an element with `transform`, `filter` or `perspective`. The panel then lands in the wrong place. `data-side` lets an animation grow from the correct edge.",
    },
    { type: "h2", text: "Back and keyboard" },
    {
      type: "p",
      text: "The Android back button and `adaptvBack()` close an open menu before they change the route. The browser Back button navigates. Escape closes the menu and returns focus to the trigger. Arrow keys and type-ahead are not built.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse, Tab and Escape.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "An outside tap closes it.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Safe-area insets are used.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Wire your back control to `adaptvBack()`.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Hardware back closes the menu first.",
        },
      ],
    },
  ],
}
