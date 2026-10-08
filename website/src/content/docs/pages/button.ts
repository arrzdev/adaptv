import { ButtonDemo } from "@/components/docs-demos/button-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "button",
  title: "Button",
  summary:
    "A real `<button>` with the press engine, optional haptics and icon slots.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Button, useButton, type ButtonHandle } from "adaptv/components"',
  source: "src/components/button.tsx",
  blocks: [
    {
      type: "demo",
      component: ButtonDemo,
      code: `import { Button } from "adaptv/components"

<Button
  haptic
  disabled={pending}
  aria-busy={pending}
  onClick={save}
  className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition-transform active:scale-95 disabled:opacity-70"
>
  {pending && (
    <Button.Leading className="pe-2">
      <Spinner />
    </Button.Leading>
  )}
  <Button.Text>{pending ? "Saving" : "Save"}</Button.Text>
</Button>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: '`Button` is a `<button type="button">` with adaptv\'s press engine. A scroll never fires it. Release outside cancels it. The press region reaches `48px` past the frame. Build the content from `Button.Text`, `Button.Leading` and `Button.Trailing`, in order. The handler is `onClick`.',
    },
    {
      type: "note",
      tone: "warn",
      text: "`Button` does not submit a form. Call `form.requestSubmit()` from `onClick`.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onClick",
          type: "(event) => void",
          description:
            "Runs on release inside the press region, and on Space or Enter key-up.",
        },
        {
          name: "haptic",
          type: 'boolean | "light" | "medium" | "heavy"',
          default: "false",
          description:
            'Fire a haptic on first contact. `true` means `"light"`.',
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Set the native `disabled`, ignore gestures and turn off the haptic.",
        },
        {
          name: "className",
          type: "string",
          description:
            "All of the look. There are no variants. A width utility such as `w-full` switches to fixed-width mode.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "The slots below.",
        },
        {
          name: "ref",
          type: "Ref<ButtonHandle>",
          description:
            "A handle with read-only `disabled` and `focus()`. It is not the DOM node.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<button>` attributes pass through, except `type` and the pointer and key handlers.",
    },
    { type: "h3", text: "Slots" },
    {
      type: "p",
      text: "Slots must be direct children of `Button`. `Button.Text` takes `children` and `className` for type and truncation. `Button.Leading` and `Button.Trailing` take `children` (an icon or spinner) and `className` for spacing, such as `pe-2` or `ps-2`. An empty slot renders nothing. `Button.Leading` and `Button.Trailing` are `aria-hidden`, so an icon-only button needs `aria-label`.",
    },
    {
      type: "p",
      text: "Without a width utility, the button tweens to its new width over `200ms` when a slot or the label changes. Put icon spacing on the slot, not as `gap-*` on the root.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'The baseline is neutral and `className` overrides it, including the cursor. Only the `touch-action` classes are locked. Use `active:` for the press state, as on [Pressable](/docs/pressable). Other hooks are `data-adaptv="button"`, `disabled:`, and `focus-visible:` (set `--adaptv-ring` on `:root` to colour the default ring). A border that appears in some states moves the label, so use `outline` for toggled emphasis. Inside a `Button`, `useButton()` returns `{ isDisabled, hasFixedWidth }`.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "Everything is the same on every target except `haptic`.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "No vibration hardware." },
        {
          target: "Mobile web",
          status: "partial",
          note: "Android Chrome vibrates. iOS Safari gets one system tick.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "As mobile web. iOS ignores the weight.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The three weights feel different.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}
