import { InputDemo } from "@/components/docs-demos/input-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "input",
  title: "Input and TextArea",
  summary:
    "A single-line field with icon slots and a multiline field that grows with its content, both thin layers over the native elements.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Input, TextArea, useInput, useTextArea } from "@arrzdev/adaptv/components"',
  source: "src/components/input.tsx",
  blocks: [
    {
      type: "demo",
      component: InputDemo,
      code: `import { Input, TextArea } from "@arrzdev/adaptv/components"
import { Search, X } from "lucide-react"

const field =
  "w-full rounded-lg bg-white px-3 py-2 outline outline-1 outline-gray-300 focus-within:outline-2 focus-within:outline-blue-500 placeholder:text-gray-400"

const [query, setQuery] = useState("")
const [notes, setNotes] = useState("")

<Input
  type="search"
  enterKeyHint="search"
  aria-label="Search"
  placeholder="Search, then press Enter"
  value={query}
  onChange={(event) => setQuery(event.target.value)}
  onSubmitKey={() => runSearch(query)}
  className={field}
>
  <Input.Leading className="pe-2 text-gray-400">
    <Search size={16} aria-hidden />
  </Input.Leading>
  {query.length > 0 && (
    <Input.Trailing className="ps-2">
      <button type="button" aria-label="Clear" onClick={() => setQuery("")}>
        <X size={16} aria-hidden />
      </button>
    </Input.Trailing>
  )}
</Input>

<TextArea
  rows={2}
  maxRows={5}
  aria-label="Notes"
  placeholder="Type a few lines. It stops growing at five."
  value={notes}
  onChange={(event) => setNotes(event.target.value)}
  className={field}
/>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: '`Input` renders a native `<input>` and `TextArea` renders a native `<textarea>`. Every native attribute passes through: `type`, `inputMode`, `enterKeyHint`, `autoComplete`, `autoCapitalize`, `name`, `required`, `aria-*`. adaptv does not rename or wrap them, so the way to get a numeric keypad is `inputMode="numeric"`, and the way to label the keyboard\'s action key is `enterKeyHint="search"`.',
    },
    {
      type: "p",
      text: "Both work controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). `onChange` is the native React handler and receives the event, so read `event.target.value`.",
    },
    {
      type: "p",
      text: "Both ship a neutral grey surface (`bg-gray-50 text-gray-950`) and nothing else: no padding, no radius, no border. Pass your own through `className`. Use `outline` for a focus or error ring. A border that appears on focus changes the content box, and the text jumps; on a `TextArea` it also changes the height the auto-resize measures. See [Layout shift](/docs/layout-shift).",
    },
    {
      type: "note",
      tone: "warn",
      text: "`onSubmitKey` never fires on a touch device. It is a desktop convenience for Enter without Shift. On a phone, handle the keyboard's action key in `onKeyDown`, or put the field in a `<form>` and use `onSubmit`. A device counts as touch when `ontouchstart` exists or `navigator.maxTouchPoints` is above zero, which includes touchscreen laptops.",
    },
    { type: "h2", text: "Input props" },
    {
      type: "props",
      rows: [
        {
          name: "value",
          type: "string | number | readonly string[]",
          description: "Controlled value. Pair it with `onChange`.",
        },
        {
          name: "defaultValue",
          type: "string | number | readonly string[]",
          description: "Initial value when uncontrolled.",
        },
        {
          name: "onChange",
          type: "(event: ChangeEvent<HTMLInputElement>) => void",
          description: "The native React change handler.",
        },
        {
          name: "onSubmitKey",
          type: "() => void",
          description:
            "Called on Enter without Shift, on non-touch devices only. The keydown is `preventDefault()`ed and stopped from propagating, so a surrounding form does not also submit. `onKeyDown` still runs afterwards.",
        },
        {
          name: "onKeyDown",
          type: "(event: KeyboardEvent<HTMLInputElement>) => void",
          description:
            "Raw keydown. Fires on every device, after `onSubmitKey` when both apply.",
        },
        {
          name: "onBlur",
          type: "(event: FocusEvent<HTMLInputElement>) => void",
          description: "Native blur handler.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Disables the field. The root gets `cursor-not-allowed` and a locked non-interactive class that `className` cannot undo.",
        },
        {
          name: "size",
          type: "number",
          default: "20",
          description:
            "The native `size` attribute: the width of a bare field in characters. The default applies only without slots. Pass a width utility such as `w-full` when the field should fill its parent.",
        },
        {
          name: "id",
          type: "string",
          description:
            "Id of the `<input>`. Generated when omitted; with slots the wrapping `<label>` points at it.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Without slots, lands on the `<input>`. With slots, lands on the group `<label>`, except tokens that start with `placeholder:`, which go to the inner `<input>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "`Input.Leading` and `Input.Trailing` slots. Any child switches the component to the grouped layout.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<input>` attribute passes through to the element.",
    },
    { type: "h2", text: "Slots" },
    {
      type: "p",
      text: "An icon inside a field is usually an absolutely positioned element plus matching padding on the input, and the two drift apart. `Input.Leading` and `Input.Trailing` are real flex children instead: with a slot present, `Input` renders a `<label>` that holds the slots and a chromeless `<input>` between them, so the text can never run under an icon.",
    },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description:
            "Icon, button or text. A slot with no content (`null`, `false`, whitespace) renders nothing.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Gutter and sizing for the slot: `pe-2` on a leading slot, `ps-2` on a trailing one, a fixed width.",
        },
      ],
    },
    {
      type: "ul",
      items: [
        "Visual order is always leading, field, trailing. It is set with locked `order-1` / `order-2` / `order-3` classes, so JSX order does not change it.",
        "Padding on the root `className` (`px-3 py-2`) insets the slots from the edge. The gap between a slot and the text belongs to the slot (`pe-*`, `ps-*`) or to `gap-*` on the root. Pick one.",
        "The grouped root is `w-fit` by default. Pass `w-full` or a fixed width, or the field changes width when a conditional slot mounts.",
        "A `mousedown` on a `button`, `a`, `input`, `select`, `textarea` or `[role='button']` inside a slot is `preventDefault()`ed, so pressing a clear button does not take focus from the field and the keyboard stays up.",
        "Pressing the group's padding while the field is focused keeps the focus where it is. Pressing it while unfocused focuses the field, because the root is the field's `<label>`.",
      ],
    },
    { type: "h3", text: "useInput()" },
    {
      type: "p",
      text: "A design-system wrapper around a slot can read the field's state with `useInput()`. It returns `{ isGrouped, isDisabled }` and throws outside an `<Input>`. Branch on these in `cn()` instead of `has-[:disabled]:` or `group-*` selectors.",
    },
    {
      type: "code",
      label: "search-icon-slot.tsx",
      lang: "tsx",
      code: `function SearchIconSlot() {
  const { isDisabled } = useInput()
  return (
    <Input.Leading className={cn("pe-2 text-gray-400", isDisabled && "opacity-50")}>
      <Search size={16} aria-hidden />
    </Input.Leading>
  )
}`,
    },
    { type: "h2", text: "TextArea props" },
    {
      type: "props",
      rows: [
        {
          name: "autoResize",
          type: "boolean",
          default: "true",
          description:
            "Grow with the content from `rows` up to `maxRows`, then scroll inside. Set `false` for a fixed-height field that fills its container and scrolls.",
        },
        {
          name: "rows",
          type: "number",
          default: "4",
          description:
            "Minimum height in lines while auto-resizing. This is the empty height, so do not add a `min-h-*` class for it. Ignored when `autoResize` is `false`.",
        },
        {
          name: "maxRows",
          type: "number",
          default: "100",
          description:
            "Maximum height in lines before the field scrolls. Ignored when `autoResize` is `false`.",
        },
        {
          name: "value",
          type: "string | number | readonly string[]",
          description:
            "Controlled value. The height is re-measured whenever it changes, including when you clear it from outside.",
        },
        {
          name: "defaultValue",
          type: "string | number | readonly string[]",
          description: "Initial value when uncontrolled.",
        },
        {
          name: "onChange",
          type: "(event: ChangeEvent<HTMLTextAreaElement>) => void",
          description: "The native React change handler.",
        },
        {
          name: "onSubmitKey",
          type: "() => void",
          description:
            "Called on Enter without Shift, on non-touch devices only, and the newline is suppressed. Shift+Enter still inserts a line. On touch devices Enter always inserts a line.",
        },
        {
          name: "onKeyDown",
          type: "(event: KeyboardEvent<HTMLTextAreaElement>) => void",
          description: "Raw keydown. Fires on every device.",
        },
        {
          name: "onBlur",
          type: "(event: FocusEvent<HTMLTextAreaElement>) => void",
          description: "Native blur handler.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Disables the field. With slots, the wrapping `<fieldset>` is disabled too.",
        },
        {
          name: "id",
          type: "string",
          description:
            "Id of the `<textarea>`. Generated when omitted; `TextArea.Label` points at it.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the shell `<div>` around the field: padding, radius, ring, background, text colour and size. Tokens that start with `placeholder:` go to the inner `<textarea>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "`TextArea.Label`, `TextArea.Hint` and `TextArea.Error`, at most one of each. Anything else throws.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<textarea>` attribute passes through to the element.",
    },
    { type: "h3", text: "How the height is decided" },
    {
      type: "p",
      text: "With `autoResize`, the floor is `rows` × the computed line height. The ceiling is the smallest of three numbers: `maxRows` × line height, a CSS `max-height` on the shell (your `className`), and a `max-height` on the shell's parent, measured as the room left under the field and rounded down to whole lines. At the ceiling the field gets `overflow-y: auto` and its scroll padding mirrors the shell's bottom padding, so the last line is not flush against the edge. A `ResizeObserver` on the shell and its parent re-measures when the layout changes.",
    },
    {
      type: "p",
      text: "With `autoResize={false}` the shell becomes an `h-full` flex column and the `<textarea>` fills it. The height comes from your `className` (`h-32`) or from a sized parent. The `rows` prop has no effect in this mode: the native `rows` attribute is always `1`.",
    },
    {
      type: "code",
      label: "fixed-height.tsx",
      lang: "tsx",
      code: `<TextArea
  autoResize={false}
  aria-label="Message"
  className="h-32 rounded-lg px-3 py-2 outline outline-1 outline-gray-300"
/>`,
    },
    { type: "h2", text: "Label, hint and error" },
    {
      type: "p",
      text: 'The three `TextArea` parts take `children` and `className` and render unstyled. `TextArea.Label` is a `<label htmlFor>` wired to the field. `TextArea.Hint` is a `<p>` and `TextArea.Error` is a `<p role="alert">`; the ids of whichever are present are joined into the field\'s `aria-describedby`.',
    },
    {
      type: "code",
      label: "notes-field.tsx",
      lang: "tsx",
      code: `<TextArea name="notes" rows={3} className="rounded-lg px-3 py-2">
  <TextArea.Label className="text-sm font-medium">Notes</TextArea.Label>
  <TextArea.Hint className="text-sm text-gray-500">Optional</TextArea.Hint>
  {error && (
    <TextArea.Error className="text-sm text-red-600">{error}</TextArea.Error>
  )}
</TextArea>`,
    },
    {
      type: "ul",
      items: [
        "With any part present the root becomes a `<fieldset>` laid out as a column with `gap-2`, in a fixed order: label, field, hint, error. JSX order does not change it, and `className` still lands on the field's shell, so the fieldset's own layout is not restylable.",
        "The parts must be direct children. A wrapper component is recognised when its `displayName` is `TextArea.Label`, `TextArea.Hint` or `TextArea.Error`.",
        "`useTextArea()` returns `{ isDisabled, fieldId, hintId, errorId }` inside such a wrapper. It throws when the `TextArea` has no parts, because no context is provided then.",
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Element", "Hook", "What you can change"],
      rows: [
        [
          "Bare `Input`",
          '`[data-adaptv="input"]` on the `<input>`',
          "Everything. `className` merges over the grey baseline.",
        ],
        [
          "Grouped `Input`",
          '`[data-adaptv="input"]` on the `<label>`',
          "The label takes `className`. The inner `<input>` is locked to `border-none bg-transparent p-0 shadow-none text-inherit` and only receives `placeholder:` tokens.",
        ],
        [
          "`TextArea`",
          '`[data-adaptv="text-area"]` on the shell, or on the `<fieldset>` when parts are present',
          "The shell takes `className`. The inner `<textarea>` is locked to no padding, border, background, outline or resize handle, with `leading-normal`, and only receives `placeholder:` tokens.",
        ],
        [
          "Focused field that is moving",
          '`[data-caret-muted="true"]`',
          "Set by the caret patch below while the caret is hidden.",
        ],
      ],
    },
    {
      type: "p",
      text: "Text colour, font size and caret colour set on the root reach the inner field by inheritance (`text-inherit`, and `caret-color` inherits), so `text-base caret-blue-500` on a grouped `Input` or a `TextArea` works as written. Style focus with `focus-within:` on the root, because the root is not the focused element.",
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "`ref` is an imperative handle (`InputHandle`, `TextAreaHandle`), not the DOM node.",
    },
    {
      type: "props",
      rows: [
        {
          name: "value",
          type: "string",
          description: "Live value of the field. Read only.",
        },
        {
          name: "disabled",
          type: "boolean",
          description: "Live disabled state. Read only.",
        },
        {
          name: "grouped",
          type: "boolean",
          description:
            "`Input` only. `true` when slot children are present. Read only.",
        },
        {
          name: "focus()",
          type: "() => void",
          description: "Focuses the underlying field.",
        },
        {
          name: "clear()",
          type: "() => void",
          description:
            "Empties the DOM field and dispatches native `input` and `change` events.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: '`clear()` does not call your React `onChange`: the value is written straight to the element, and React ignores a change event whose value it already knows. On a controlled field, clear your own state (`setValue("")`) and keep `clear()` for uncontrolled fields.',
    },
    { type: "h2", text: "What the app shell does for text fields" },
    {
      type: "p",
      text: "Three behaviours people expect from the field come from the app shell. They apply to every `<input>` and `<textarea>` in the app, including ones that are not adaptv components.",
    },
    {
      type: "ul",
      items: [
        "**Zoom on focus.** iOS Safari zooms the page when a focused field's text is under 16px. `Input` does not set a font size. The app's viewport meta disables zoom by default (`allowZoom: false` in the [config](/docs/config)), which also stops the focus zoom. If you turn `allowZoom` on, give fields `text-base` or larger.",
        '**Ghost caret.** On iOS the caret is drawn by the system on its own layer and does not follow a CSS transform, so a focused field inside a moving [Drawer](/docs/drawer), a scrolling view or a keyboard lift leaves a caret blinking at the old position. The shell hides the caret while the field moves and repaints it once it settles. Default on; opt out with `patches.caretRepaint: false`. The autocorrect popover, the misspelling underline and the selection handles have no such hook and still detach; the only way to avoid them is to set `autoCorrect="off"` and `spellCheck={false}` on the field.',
        "**Text magnifier.** The shell cancels the iOS double-tap loupe over non-editable content (`patches.textMagnifier`, default on). Fields are exempt: inside an `<input>`, `<textarea>`, `<select>` or `contenteditable` host the native loupe and double-tap word selection work as usual.",
      ],
    },
    {
      type: "p",
      text: "Keeping a field above the on-screen keyboard is a separate job. See [AvoidKeyboard](/docs/avoid-keyboard) and the [Keyboard](/docs/keyboard) guide.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "Neither component renders a visible label for you. Give a bare `Input` an `aria-label` or your own `<label htmlFor>` with a matching `id`. A `TextArea` gets one from `TextArea.Label`.",
        "In a grouped `Input` the root is a `<label>` for the field, so the text of a slot becomes part of the field's accessible name unless you also pass `aria-label`. Mark decorative icons `aria-hidden`.",
        "Passing your own `aria-describedby` to a `TextArea` replaces the generated one, so include the hint and error ids yourself (`useTextArea()` has them).",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`onSubmitKey` fires on Enter. No on-screen keyboard, so `enterKeyHint` and `inputMode` have no visible effect.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "`onSubmitKey` does not fire. `enterKeyHint` and `inputMode` shape the keyboard.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as mobile web on a phone, same as desktop web on a computer.",
        },
        {
          target: "iOS",
          status: "partial",
          note: "`onSubmitKey` does not fire. The caret patch exists for this target.",
        },
        {
          target: "Android",
          status: "partial",
          note: "`onSubmitKey` does not fire. `enterKeyHint` changes the action key's glyph most visibly here.",
        },
      ],
    },
  ],
}
