import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "keyboard",
  title: "The software keyboard",
  summary:
    "One keyboard signal on every target, a wrapper that keeps the focused field visible, and the iOS text-input fixes adaptv applies for you.",
  blocks: [
    {
      type: "p",
      text: "The on-screen keyboard is where the targets disagree most. A native app is told the exact height by the OS. A mobile browser tells the page nothing and the height has to be inferred from viewport geometry. Desktop has no keyboard at all. adaptv folds all of that into one signal with one shape, and builds keyboard avoidance on top of it.",
    },
    { type: "h2", text: "The rule: the keyboard never resizes your layout" },
    {
      type: "p",
      text: "By default the shell freezes the layout viewport. The keyboard opens over the page and the page does not reflow, scroll or shrink behind your back. On iOS native the WebView's own resize is switched off; in Chromium the virtual keyboard is set to overlay content; on iOS Safari the document is scroll-locked. The consequence is that you opt content into avoiding the keyboard, and nothing moves unless you asked it to.",
    },
    {
      type: "ul",
      items: [
        "A form inside a [Drawer](/docs/drawer) needs nothing. The drawer handles the keyboard itself.",
        "A full-screen form wraps its scroller in [AvoidKeyboard](/docs/avoid-keyboard).",
        "App chrome (a tab bar, a docked composer) reacts through the CSS variable and attribute on `<html>`.",
        "Anything else reads `useKeyboard()`.",
      ],
    },
    {
      type: "note",
      text: "The freeze is the `patches.viewportFreeze` key in `adaptv.config.ts` and defaults to `true`. Set it to `false` and the browser's default behaviour returns, along with the layout shift it causes. See [Config](/docs/config).",
    },
    { type: "h2", text: "The keyboard signal" },
    {
      type: "api",
      name: "useKeyboard()",
      signature:
        "function useKeyboard(options?: UseKeyboardOptions): { isOpen: boolean; height: number }",
      description:
        "The live keyboard state. `isOpen` is `true` only while a text field is focused and the on-screen keyboard is up. `height` is in px and `0` when closed. While at least one enabled `useKeyboard` is mounted it also publishes the state on `<html>` for CSS.",
      params: [
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description:
            "Turn the listeners off. A disabled observer reports closed and publishes nothing.",
        },
        {
          name: "predictFromCache",
          type: "boolean",
          default: "false",
          description:
            "Seed the height from the last height learned on this device the moment a field is focused, so a consumer can start moving on the same frame as the tap. The real measurement confirms or corrects it, and a prediction no keyboard confirms is retracted after about 400ms.",
        },
        {
          name: "visualViewportThreshold",
          type: "number",
          default: "100",
          description:
            "Web only. The smallest visual-viewport change, in px, treated as a keyboard.",
        },
        {
          name: "debounceDelay",
          type: "number",
          default: "50",
          description:
            "Web only. Settle delay in ms for bursts of viewport resize and scroll events.",
        },
      ],
      returns: "A `KeyboardState`: `{ isOpen, height }`.",
    },
    {
      type: "code",
      label: "composer.tsx",
      lang: "tsx",
      code: `import { useKeyboard } from "@arrzdev/adaptv/hooks"

function Composer() {
  const { isOpen, height } = useKeyboard()

  return (
    <View
      row
      className="absolute inset-x-0 bottom-0 gap-2 px-3 pt-2"
      // Sit on top of the keyboard when it is up, on the home indicator when it is not.
      style={{ paddingBottom: isOpen ? height + 8 : undefined }}
    >
      <Input placeholder="Message" className="flex-1" />
      <SendButton />
    </View>
  )
}`,
    },
    { type: "h3", text: "Reacting from CSS" },
    {
      type: "p",
      text: "Two hooks are published on `<html>`, so chrome anywhere in the app can respond with no React state of its own.",
    },
    {
      type: "table",
      head: ["Hook", "Value", "Use"],
      rows: [
        [
          "`--adaptv-keyboard-height`",
          "The live height as a length. Always defined: `0px` while the keyboard is down.",
          "`pb-[calc(0.5rem+var(--adaptv-keyboard-height))]`",
        ],
        [
          "`data-keyboard-open`",
          'Present while the keyboard is up, absent otherwise. Never `="false"`.',
          "`[html[data-keyboard-open]_&]:hidden`",
        ],
      ],
    },
    {
      type: "p",
      text: "The attribute lives on `<html>`, so a bare `data-keyboard-open:` variant on some inner element matches nothing. Scope it to the root as in the table. Inside `AvoidKeyboard` the bare form does work, because that component mirrors both hooks onto its own element.",
    },
    { type: "h3", text: "Where the signal comes from" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No on-screen keyboard. `height` stays `0` and `data-keyboard-open` never appears, which is the correct answer.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Inferred. The VirtualKeyboard API is used where the browser has it (Chromium, secure origins); otherwise the height is derived from `visualViewport` geometry, which lags the keyboard's animation. adaptv filters the transient readings iOS emits while switching fields.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same inference as mobile web. A wrong height is most visible here, because there is no browser chrome to absorb it.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The exact height from the OS on will-show. The WebView is not resized. The ~45px password AutoFill bar toggling on and off is held for a moment instead of bouncing your layout.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The exact height from the OS. Android has no resize mode to switch off, so the window height can still change under the keyboard; size things from the signal, not from `window.innerHeight`.",
        },
      ],
    },
    {
      type: "p",
      text: "On native the OS listeners are attached once, at app start. That matters for a sheet with an `autoFocus` field: the keyboard raises in the same frame the sheet mounts, and a listener registered lazily would miss the event.",
    },
    { type: "h2", text: "Keeping a form above the keyboard" },
    {
      type: "p",
      text: "`AvoidKeyboard` is the counterpart of React Native's `KeyboardAvoidingView`. It reserves room at the bottom of its element for the keyboard and scrolls the focused field into view above it. The reservation is applied instantly; the scroll eases, or jumps under reduced motion.",
    },
    {
      type: "code",
      label: "edit-profile.page.tsx",
      lang: "tsx",
      code: `import { AvoidKeyboard, Input, View } from "@arrzdev/adaptv/components"

export function EditProfilePage() {
  return (
    <View>
      <Header />
      <AvoidKeyboard className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom px-4 pb-2 pt-safe-offset-2">
        <Input name="name" placeholder="Name" />
        <Input name="email" type="email" placeholder="Email" />
        <Input name="bio" placeholder="Bio" />
      </AvoidKeyboard>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: "Two things people get wrong:",
    },
    {
      type: "ul",
      items: [
        "**`AvoidKeyboard` must be the scroller.** The reserved space lands on this element. With a separate scroller inside it, the padding shrinks that scroller instead of extending its content, and the focused field never clears the keyboard. Put the overflow and touch classes on `AvoidKeyboard` itself, as above.",
        "**Leave `pb-safe` off it.** It reserves the larger of the keyboard and the bottom [safe area](/docs/safe-areas) by itself, on top of whatever bottom padding you gave it. Give it only your design gap. The top inset is yours to keep.",
      ],
    },
    {
      type: "p",
      text: '`behavior="margin"` reserves `margin-bottom` instead of padding, which is what a bottom-docked bar wants. `scrollBuffer` (default `24`) is the gap in px kept between the field and the keyboard. The full prop list is on the [AvoidKeyboard](/docs/avoid-keyboard) page.',
    },
    { type: "h2", text: "How Drawer rides the keyboard" },
    {
      type: "p",
      text: "A [Drawer](/docs/drawer) answers the keyboard by growing, not by sliding up. The sheet grows toward its maximum height and holds the keyboard's height as empty room under its content. The content that was visible stays visible, the actions end up just above the keyboard, and once the sheet is at its cap the inner scroller absorbs the rest. A plain upward translate would push a tall form's top edge off the screen and still leave its footer buried.",
    },
    {
      type: "ul",
      items: [
        "It is on by default. `avoidKeyboard={false}` on `Drawer` turns it off.",
        "`useDrawer().isKeyboardOpen` tells a component inside the sheet that the keyboard is up for one of its fields.",
        "Do not wrap drawer content in `AvoidKeyboard`. The drawer already does the work, and the two would reserve the space twice.",
        "When focusing a field also collapses a picker in the same frame, the sheet pins its height until the keyboard height is known, so it moves once.",
      ],
    },
    { type: "h2", text: "The caret and the text magnifier" },
    {
      type: "p",
      text: "Two iOS WebKit behaviours make a web form feel wrong in a way CSS cannot fix. adaptv patches both app-wide; each has an opt-out under `patches` in `adaptv.config.ts`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "patches.caretRepaint",
          type: "boolean",
          default: "true",
          description:
            "iOS paints the text caret on a separate system layer that does not follow a CSS transform or a scripted scroll. A focused field that moves (a sheet sliding, the keyboard lift, a scroll) leaves a ghost caret blinking at its old position. adaptv hides the caret while the field moves and forces a repaint once it is still.",
        },
        {
          name: "patches.textMagnifier",
          type: "boolean",
          default: "true",
          description:
            "A double-tap-and-hold on iOS raises the text-selection magnifier over any content, including buttons and empty space. `user-select`, `-webkit-touch-callout` and `touch-action` do not control it (WebKit bug 231161). adaptv cancels exactly the second tap of a double-tap, and only outside editable fields, so inputs keep their native loupe and double-tap word selection, and scrolling is unaffected.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: 'The caret is the only iOS text overlay a page can control. The autocorrect popover, the misspelling underline, selection handles and the Cut/Copy/Paste callout are drawn by the system and detach from a moving field the same way. The only mitigation is to stop them appearing: set `autoCorrect="off"` and `spellCheck={false}` statically on fields that move a lot. Toggling them at runtime does not dismiss an overlay that is already showing.',
    },
    { type: "h2", text: "Input zoom" },
    {
      type: "p",
      text: "iOS Safari zooms the page when a field with a font size under 16px takes focus. adaptv's generated viewport meta fixes the scale (`user-scalable=no`, `maximum-scale=1`), which removes the focus zoom and gives the app a fixed, native-feeling scale. The cost is pinch-zoom. Set `allowZoom: true` in `adaptv.config.ts` to restore it, which is the accessible choice under WCAG 1.4.4; if you do, keep input text at 16px or larger so focus does not zoom.",
    },
    { type: "h2", text: "Dismissing and predicting" },
    {
      type: "api",
      name: "dismissVirtualKeyboard()",
      signature: "function dismissVirtualKeyboard(): void",
      description:
        "Blurs the focused field so the keyboard can close. Use it for a Done button or when a gesture should put the keyboard away.",
    },
    {
      type: "api",
      name: "willOpenVirtualKeyboard()",
      signature: "function willOpenVirtualKeyboard(target: Element): boolean",
      description:
        "Whether focusing `target` would raise the on-screen keyboard. `true` for text inputs and textareas, `false` for checkboxes, buttons and the like.",
    },
    {
      type: "p",
      text: "Both are exported from `@arrzdev/adaptv/hooks`. `hasNativeKeyboard()` and `subscribeNativeKeyboard()` from `@arrzdev/adaptv/capabilities` expose the raw native source, and are no-ops off native. Prefer `useKeyboard`, which already picks the right source.",
    },
    { type: "h2", text: "Testing it" },
    {
      type: "ul",
      items: [
        'The iOS Simulator raises no software keyboard while **I/O ▸ Keyboard ▸ Connect Hardware Keyboard** is on. Most "device-only" keyboard bugs are this setting.',
        "An Android emulator needs `hw.keyboard=no` in its AVD config for the same reason.",
        "A page served over plain `http://` on a LAN address is not a secure context, so Chromium exposes no VirtualKeyboard API and adaptv falls back to viewport geometry. Behaviour there differs slightly from the same page on `https://`.",
      ],
    },
    { type: "h2", text: "What is still open" },
    {
      type: "note",
      text: "The native signal carries the keyboard's **height only**. The OS also reports the animation's duration and easing curve, and adaptv does not pass them through yet, so a sheet and the keyboard start together and can arrive a few frames apart. Widening the signal with the duration is agreed and unbuilt. iOS's keyboard curve is a private value with no exact CSS equivalent, so the first step will match the arrival time, not the shape. Per-frame following of the Android keyboard (API 30+) is designed and also unbuilt. The web has no timing information at all and will keep adaptv's own constants.",
    },
  ],
}
