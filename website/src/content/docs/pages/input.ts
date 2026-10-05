import { InputDemo } from "@/components/docs-demos/input-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "input",
  title: "Input and TextArea",
  summary:
    "A single-line field with icon slots and a multiline field that grows with its text.",
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
      text: "`Input` is a native `<input>` and `TextArea` is a native `<textarea>`. Every native attribute passes through, such as `type`, `inputMode`, `enterKeyHint` and `aria-*`. Use them controlled (`value` and `onChange`) or uncontrolled (`defaultValue`). Both start with a neutral grey surface and no padding, radius or border. Add your own with `className`. Use `outline` for a focus or error ring, because a border that changes size moves the text (see [Layout shift](/docs/layout-shift)).",
    },
    {
      type: "note",
      tone: "warn",
      text: "`onSubmitKey` never fires on a touch device. It runs on Enter without Shift, on desktop only. On a phone, use `onKeyDown` or put the field in a `<form>` and use `onSubmit`.",
    },
    { type: "h2", text: "Input props" },
    {
      type: "props",
      rows: [
        {
          name: "onSubmitKey",
          type: "() => void",
          description:
            "Runs on Enter without Shift, on non-touch devices. It stops the keydown, so a surrounding form does not submit. `onKeyDown` still runs after it.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Disable the field. The disabled look is locked.",
        },
        {
          name: "size",
          type: "number",
          default: "20",
          description:
            "Native `size`: the width of a bare field in characters. Use a width class such as `w-full` to fill the parent.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Without slots, it lands on the `<input>`. With slots, it lands on the group `<label>`. Tokens that start with `placeholder:` go to the `<input>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "`Input.Leading` and `Input.Trailing`.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<input>` attribute passes through, including `value`, `defaultValue`, `onChange`, `onBlur` and `id`.",
    },
    { type: "h3", text: "Slots" },
    {
      type: "p",
      text: "With a slot, `Input` renders a `<label>` that holds the slots and a bare `<input>`, so text never runs under an icon. Order is always leading, field, trailing. Each slot takes `children` and `className` for spacing, such as `pe-2` or `ps-2`. An empty slot renders nothing. The group is `w-fit` by default, so add `w-full` or a width. Pressing a button inside a slot does not take focus from the field. `useInput()` returns `{ isGrouped, isDisabled }` inside an `Input`.",
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
            "Grow from `rows` to `maxRows`, then scroll. Set `false` for a fixed height from `className` or the parent.",
        },
        {
          name: "rows",
          type: "number",
          default: "4",
          description:
            "Minimum height in lines. Ignored when `autoResize` is `false`.",
        },
        {
          name: "maxRows",
          type: "number",
          default: "100",
          description:
            "Maximum height in lines. Ignored when `autoResize` is `false`.",
        },
        {
          name: "onSubmitKey",
          type: "() => void",
          description:
            "Runs on Enter without Shift, on non-touch devices, and stops the new line. Shift+Enter adds a line. On touch devices Enter always adds a line.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Disable the field.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the shell `<div>`: padding, radius, ring, colour. Tokens that start with `placeholder:` go to the `<textarea>`.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "`TextArea.Label`, `TextArea.Hint` and `TextArea.Error`, one of each at most.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<textarea>` attribute passes through. The height also stops at a CSS `max-height` on the shell or its parent.",
    },
    { type: "h3", text: "Label, hint and error" },
    {
      type: "p",
      text: 'The parts take `children` and `className` and have no style. `TextArea.Label` is a `<label>` for the field. `TextArea.Hint` is a `<p>`. `TextArea.Error` is a `<p role="alert">`. Their ids join the field\'s `aria-describedby`. With any part, the root is a `<fieldset>` with the order label, field, hint, error. `useTextArea()` returns `{ isDisabled, fieldId, hintId, errorId }`.',
    },
    {
      type: "code",
      label: "notes-field.tsx",
      lang: "tsx",
      code: `<TextArea name="notes" rows={3} className="rounded-lg px-3 py-2">
  <TextArea.Label className="text-sm font-medium">Notes</TextArea.Label>
  {error && <TextArea.Error className="text-sm text-red-600">{error}</TextArea.Error>}
</TextArea>`,
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`Input` has `data-adaptv="input"` on the `<input>`, or on the `<label>` when it has slots. `TextArea` has `data-adaptv="text-area"` on the shell, or on the `<fieldset>` when it has parts. The inner field of a grouped `Input` or a `TextArea` has no padding, border or background, and takes only `placeholder:` tokens. Text colour, size and caret colour inherit from the root. Style focus with `focus-within:` on the root.',
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "`ref` is a handle (`InputHandle`, `TextAreaHandle`), not the DOM node. It has read-only `value` and `disabled`, `focus()` and `clear()`. `Input` also has read-only `grouped`. `clear()` writes to the element and does not call `onChange`. On a controlled field, clear your own state.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: "Give a bare `Input` an `aria-label` or a `<label htmlFor>`. In a grouped `Input` the root is the field label, so slot text joins its name. Mark icons `aria-hidden`. Your own `aria-describedby` on a `TextArea` replaces the generated one.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "`onSubmitKey` fires on desktop only. `enterKeyHint` and `inputMode` shape the keyboard on phones. To keep a field above the keyboard, see [AvoidKeyboard](/docs/avoid-keyboard).",
    },
  ],
}
