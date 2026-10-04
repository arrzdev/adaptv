import { PressableDemo } from "@/components/docs-demos/pressable-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "pressable",
  title: "Pressable",
  summary:
    "adaptv's press engine on any element: a card, a row or a tile that responds to a finger the way a native control does.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Pressable } from "@arrzdev/adaptv/components"',
  source: "src/components/pressable.tsx",
  blocks: [
    {
      type: "demo",
      component: PressableDemo,
      code: `import { Pressable } from "@arrzdev/adaptv/components"

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
      text: "A DOM `click` is a poor fit for touch. It fires after a scroll that barely moved, `:active` stays lit while the finger wanders off, and nothing comes back when the finger returns. `Pressable` replaces it with the press tracking a native control has:",
    },
    {
      type: "ul",
      items: [
        "**`onPress` fires on release inside the press region.** Release outside and nothing happens.",
        "**The press is reentrant.** Drag off and the pressed state drops; slide back on and it returns.",
        "**A scroll cancels it.** When the browser takes the gesture for scrolling, the press ends, `onPress` does not fire and the pressed style never shows.",
        "**The release region is forgiving.** The press stays armed a little past the element's frame, because a fingertip rolls as it lifts.",
      ],
    },
    {
      type: "p",
      text: "[Button](/docs/button) uses the same engine. Reach for `Pressable` when the thing being pressed is not a control: a card that opens a detail screen, a row in a list, a tile in a grid.",
    },
    {
      type: "note",
      tone: "warn",
      text: "`Pressable` renders a bare `<div>`: no `display: flex`, no padding. Add `flex` yourself if you want its children laid out the way they are in a [View](/docs/view).",
    },
    { type: "h3", text: "Mechanics, not semantics" },
    {
      type: "p",
      text: "A `<div>` that reacts to a tap is not a button. It cannot be focused, a screen reader does not announce it, and Space and Enter never reach it. If the thing is a control, use [Button](/docs/button). If it navigates, use [Link](/docs/link). Otherwise give `Pressable` the semantics yourself, with `render` or with `role` and `tabIndex`:",
    },
    {
      type: "code",
      label: "semantics.tsx",
      lang: "tsx",
      code: `// a real <button>, keeping the press engine
<Pressable render={<button type="button" />} onPress={toggle}>
  {label}
</Pressable>

// or the ARIA way: focusable, announced, and Space/Enter now fire onPress
<Pressable role="button" tabIndex={0} onPress={open}>
  <Card />
</Pressable>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onPress",
          type: "(event: GestureEvent) => void",
          description:
            "The activation. Fired on pointer release inside the press region, and on Space or Enter key-up when the element is focusable. The event is the React pointer or keyboard event that ended the press.",
        },
        {
          name: "onPressDown",
          type: "(event: GestureEvent) => void",
          description:
            "The moment of contact: pointer down, or Space or Enter key-down. It fires before adaptv knows whether the gesture will become a press or a scroll, so use it for feedback, not for actions.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Drop every gesture. Sets `data-disabled` and `aria-disabled`. If it turns on mid-press, the press is cancelled. A scroll that starts on a disabled `Pressable` still scrolls.",
        },
        {
          name: "pressOutset",
          type: "number",
          default: "24 touch, 6 mouse and pen",
          description:
            "Margin in pixels around the element's frame inside which the press stays armed. Raise it for small targets; `Button` uses `48`.",
        },
        {
          name: "render",
          type: "ReactElement | ((props, state) => ReactNode)",
          description:
            "Render something other than a `<div>`. Pass an element to clone, or a function that receives the props to spread and `{ disabled }`.",
        },
        {
          name: "className",
          type: "string",
          description:
            "All of the look. Merged after any `className` on a `render` element. The three `touch-action` classes the engine needs are locked, so a `touch-none` here has no effect.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute passes through, `ref` included. The handlers the engine owns are removed from the type: `onClick`, `onClickCapture`, `onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`, `onLostPointerCapture`, `onKeyDown` and `onKeyUp`.",
    },
    {
      type: "note",
      text: "There is no `onClick` because it would never fire: the engine cancels the browser's click on the element and stops it from propagating. For the same reason, a click handler on an ancestor does not see presses that happen inside a `Pressable`.",
    },
    { type: "h2", text: "The render prop" },
    {
      type: "p",
      text: "With an element, `Pressable` clones it with the engine's handlers, the merged `className` and `style`, and your children. The element's own `className` and `style` are merged first and `Pressable`'s own win a conflict.",
    },
    {
      type: "code",
      label: "render-element.tsx",
      lang: "tsx",
      code: `<ul>
  {options.map((option) => (
    <Pressable
      key={option.id}
      render={<li className="flex items-center px-4 py-3" />}
      onPress={() => select(option)}
      className="active:bg-gray-100"
    >
      {option.label}
    </Pressable>
  ))}
</ul>`,
    },
    {
      type: "p",
      text: "With a function, you get the props to spread and the state. Spread the props onto the element you return, or the engine is not attached to anything. The props are typed against `HTMLElement`, so they spread onto a `<button>`, an `<a>` or an `<li>`.",
    },
    {
      type: "code",
      label: "render-function.tsx",
      lang: "tsx",
      code: `<Pressable
  disabled={locked}
  onPress={open}
  render={(props, state) => (
    <article {...props}>
      <Cover />
      {state.disabled ? <LockIcon /> : <ChevronIcon />}
    </article>
  )}
/>`,
    },
    {
      type: "p",
      text: "`state` is `{ disabled }`. It has no `pressed` field on purpose: see the next section.",
    },
    { type: "h2", text: "Press state" },
    {
      type: "p",
      text: "The pressed state is a DOM attribute, `data-pressed`, that the engine sets and removes with `setAttribute`. It is never React state, so pressing a row in a long list re-renders nothing.",
    },
    {
      type: "table",
      head: ["Timing", "Value", "Why"],
      rows: [
        [
          "Shows after",
          "`100ms`",
          "A touch that becomes a scroll is cancelled before then, so a finger laid down to swipe never lights the element up.",
        ],
        [
          "Stays at least",
          "`150ms`",
          "A tap shorter than the delay still shows feedback.",
        ],
        [
          "Leaves the region",
          "Immediately",
          "Dragging out drops it at once; sliding back in starts the delay again.",
        ],
      ],
    },
    {
      type: "p",
      text: "It is pointer-only. Activating with the keyboard fires `onPress` without setting `data-pressed`, so Space does not play a press animation.",
    },
    { type: "h3", text: "Write active:, as usual" },
    {
      type: "p",
      text: "You style the state with Tailwind's ordinary `active:` variant. adaptv's stylesheet redefines that variant with two branches:",
    },
    {
      type: "code",
      label: "What active: compiles to",
      lang: "text",
      code: `.active\\:scale-95[data-pressed]                        /* an element the press engine drives */
.active\\:scale-95:active:not([data-press-engine])      /* everything else: stock behaviour */`,
    },
    {
      type: "p",
      text: "The engine marks every element it is attached to with `data-press-engine`. On those elements `active:` follows `data-pressed` and ignores the native `:active` state, which cannot be cleared from JavaScript and does not come back when a finger re-enters. On a plain `<button>` or `<a>` of your own, `active:` is unchanged. This applies to `Pressable`, [Button](/docs/button), [Link](/docs/link) and every other adaptv component built on the engine.",
    },
    {
      type: "p",
      text: 'Tailwind\'s attribute variant works too: `data-pressed:bg-gray-100`. From plain CSS, select `[data-adaptv="pressable"][data-pressed]`. The redefinition ships in `@arrzdev/adaptv/styles.css`; see [Styling](/docs/styling).',
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Attribute", "When"],
      rows: [
        ['`data-adaptv="pressable"`', "Always, whatever `render` produced."],
        ["`data-press-engine`", "Always. The marker `active:` keys on."],
        ["`data-pressed`", "A pointer is down inside the press region."],
        [
          "`data-disabled`",
          "`disabled` is set. Style it with `data-disabled:opacity-50`.",
        ],
      ],
    },
    {
      type: "p",
      text: "`Pressable` adds no look of its own: no background, no cursor, no padding. Add `cursor-pointer` yourself for desktop. The only classes it applies are the locked `touch-pan-x touch-pan-y touch-pinch-zoom`, plus `select-none` when disabled. Those three together are what keep iOS delivering `pointercancel` when a scroll takes over, which is how the engine learns the press is off.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "By default the element has no role, is not in the tab order and cannot be activated from the keyboard. Add `role` and `tabIndex={0}`, or render a `<button>`.",
        "Once it is focusable, Space and Enter fire `onPressDown` on key-down and `onPress` on key-up. A held key does not repeat.",
        "`disabled` sets `aria-disabled`. It does not remove the element from the tab order; when you add `tabIndex`, make it `-1` while disabled.",
        "Keyboard focus gets adaptv's default `:focus-visible` outline.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "A mouse gets the same reentrant tracking, with a `6px` outset. Only the primary button presses.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The target the engine exists for: native `:active` on iOS does not re-light when the finger returns.",
        },
        {
          target: "Android",
          status: "yes",
          note: "A scroll that starts on the element cancels the press.",
        },
      ],
    },
  ],
}
