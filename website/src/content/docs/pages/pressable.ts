import { PressableDemo } from "@/components/docs-demos/pressable-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "pressable",
  title: "Pressable",
  summary:
    "Press handling for any element: a card, row or tile that reacts like a native control.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Pressable } from "adaptv/components"',
  source: "src/components/pressable.tsx",
  blocks: [
    {
      type: "demo",
      component: PressableDemo,
      code: `import { Pressable } from "adaptv/components"

const [presses, setPresses] = useState(0)

<Pressable
  onPress={() => setPresses((count) => count + 1)}
  className="flex flex-col gap-1 rounded-2xl bg-white p-4 transition-transform active:scale-95 active:bg-gray-100"
>
  <span className="font-medium">Press and hold</span>
  <span className="text-sm text-gray-500">
    Drag off the card and back on. Release inside to fire onPress.
  </span>
</Pressable>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "Use `Pressable` for a card, row or tile that people press. `onPress` fires when the pointer is released inside the press region. Release outside and nothing happens. Drag off and back on and the press returns. A scroll cancels the press. [Button](/docs/button) uses the same engine.",
    },
    {
      type: "note",
      tone: "warn",
      text: '`Pressable` is a bare `<div>`. It has no flex, no focus and no role. Add `flex` yourself. For a control, use [Button](/docs/button). For navigation, use [Link](/docs/link). Or add semantics with `render={<button type="button" />}`, or with `role="button"` and `tabIndex={0}`.',
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onPress",
          type: "(event: GestureEvent) => void",
          description:
            "Runs on release inside the press region, and on Space or Enter key-up when the element can take focus.",
        },
        {
          name: "onPressDown",
          type: "(event: GestureEvent) => void",
          description:
            "Runs at first contact, before the press is known. Use it for feedback, not for actions.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Ignore gestures. Sets `data-disabled` and `aria-disabled`.",
        },
        {
          name: "pressOutset",
          type: "number",
          default: "24 touch, 6 mouse and pen",
          description: "Pixels around the element where the press stays armed.",
        },
        {
          name: "render",
          type: "ReactElement | ((props, state) => ReactNode)",
          description:
            "Render another element. A function gets the props to spread and `{ disabled }`. You must spread them.",
        },
        {
          name: "className",
          type: "string",
          description: "All of the look.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<div>` attributes pass through, including `ref`. There is no `onClick`: the engine cancels the browser click, so the type refuses it.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "The engine sets `data-pressed` while a pointer is down inside the press region. It shows after `100ms`, so a scroll never flashes it, and stays for at least `150ms`. It is never React state. Style it with `active:`, which adaptv points at `data-pressed` on engine elements, or with `data-pressed:`. Keyboard presses do not set it.",
    },
    {
      type: "table",
      head: ["Attribute", "When"],
      rows: [
        ['`data-adaptv="pressable"`', "Always."],
        ["`data-press-engine`", "Always."],
        ["`data-pressed`", "A pointer is down in the press region."],
        ["`data-disabled`", "`disabled` is set."],
      ],
    },
    {
      type: "p",
      text: "`Pressable` adds no look. Add `cursor-pointer` yourself. The `touch-action` classes are locked.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "Everywhere. On iOS it fixes native `:active`, which does not light again when the finger returns.",
    },
  ],
}
