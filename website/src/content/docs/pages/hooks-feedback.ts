import { HooksFeedbackDemo } from "@/components/docs-demos/hooks-feedback-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-feedback",
  title: "Input and feedback hooks",
  summary:
    "The on-screen keyboard, haptics, the press engine, taps on canvas surfaces, and freezing the viewport under an overlay.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useKeyboard, useHaptics, useHapticTick, useVibrate, useGestureEngine, useClickFix, useFreezeViewport } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "demo",
      component: HooksFeedbackDemo,
      code: `import { useGestureEngine } from "@arrzdev/adaptv/hooks"

const [state, setState] = useState("idle")

const handlers = useGestureEngine({
  onPressUp: () => console.log("tap"),
  onLongPressDown: () => console.log("long press"),
  onStateChange: setState,
})

<div
  {...handlers}
  role="button"
  tabIndex={0}
  className="rounded-xl bg-gray-100 transition-transform active:scale-95"
>
  {state}
</div>`,
    },

    { type: "h2", text: "useKeyboard" },
    {
      type: "api",
      name: "useKeyboard()",
      signature:
        "function useKeyboard(options?: UseKeyboardOptions): KeyboardState",
      description:
        "The on-screen keyboard: open or closed, and its height. It reports open only while a text field has focus. [AvoidKeyboard](/docs/avoid-keyboard) and [Drawer](/docs/drawer) use it already. Use the hook to lay out around the keyboard yourself. See the [keyboard guide](/docs/keyboard).",
      params: [
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description:
            "`false` removes the listeners. The hook reports closed.",
        },
        {
          name: "visualViewportThreshold",
          type: "number",
          default: "100",
          description:
            "Web only. The smallest viewport shrink, in px, that counts as a keyboard.",
        },
        {
          name: "debounceDelay",
          type: "number",
          default: "50",
          description: "Web only. Settle delay in ms for viewport events.",
        },
        {
          name: "predictFromCache",
          type: "boolean",
          default: "false",
          description:
            "On focus, report the last measured height, so your lift starts on the tap frame. The real value then corrects it. With no keyboard after 800 ms, the guess is withdrawn.",
        },
      ],
      returns:
        "`{ isOpen, height, unpaidHeight, resizesLayoutViewport }`. `height` is in px. `unpaidHeight` is the part of `height` that the layout has not already given up. On Android native the WebView shrinks, so use `unpaidHeight` there. Closed on the server.",
    },
    {
      type: "p",
      text: "While the hook is mounted, `<html>` has `--adaptv-keyboard-height` (`0px` when closed) and `data-keyboard-open` (when open). Use them in CSS.",
    },
    {
      type: "code",
      label: "composer.tsx",
      lang: "tsx",
      code: `const { isOpen, height } = useKeyboard()

<View
  className="fixed inset-x-0 bottom-0 data-keyboard-open:pb-2"
  style={{ transform: \`translateY(-\${height}px)\` }}
>
  <Input placeholder="Message" />
</View>`,
    },
    {
      type: "code",
      label: "tab-bar.css",
      lang: "text",
      code: `.tab-bar {
  padding-bottom: calc(var(--adaptv-keyboard-height) + 8px);
}`,
    },
    { type: "h3", text: "Helpers" },
    {
      type: "props",
      rows: [
        {
          name: "dismissVirtualKeyboard()",
          type: "() => void",
          description: "Blur the focused text field.",
        },
        {
          name: "willOpenVirtualKeyboard(target)",
          type: "(target: Element) => boolean",
          description: "`true` if focusing the element raises a keyboard.",
        },
        {
          name: "getVirtualKeyboardApi()",
          type: "() => VirtualKeyboardApi | null",
          description: "`navigator.virtualKeyboard`, or `null`. Chromium only.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "No on-screen keyboard." },
        {
          target: "Mobile web",
          status: "partial",
          note: "Height is inferred. It trails by a few frames.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as mobile web.",
        },
        { target: "iOS", status: "yes", note: "Exact height from the OS." },
        { target: "Android", status: "yes", note: "Exact height from the OS." },
      ],
    },

    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "iOS browsers have no vibration API, and from iOS 26.5 a script cannot trigger the system tick. Only a real finger on a native switch can. `useHapticTick` and the `haptic` prop on [Button](/docs/button) use that path. For a tap, use the `haptic` prop. For other events, use `useHaptics`.",
    },
    {
      type: "api",
      name: "useHaptics()",
      signature: "function useHaptics(): typeof haptics",
      description:
        "Returns the `haptics` object from [capabilities](/docs/capabilities). The methods never throw.",
      returns: "`{ impact, notify, selection, isSupported }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "impact(weight?)",
          type: '(weight?: "light" | "medium" | "heavy") => void',
          default: '"light"',
          description: "A physical tap. On web: 8, 22 or 26 ms of vibration.",
        },
        {
          name: "notify(type)",
          type: '(type: "success" | "warning" | "error") => void',
          description:
            "Result feedback. On web: one pulse for success, two for the others.",
        },
        {
          name: "selection()",
          type: "() => void",
          description: "A light tick for a picker or segmented control.",
        },
        {
          name: "isSupported()",
          type: "() => boolean",
          description:
            "`true` if a haptic path exists. It is `true` on iOS 26.5+ Safari, where nothing fires.",
        },
      ],
    },
    {
      type: "code",
      label: "upload.tsx",
      lang: "tsx",
      code: `const haptic = useHaptics()

async function upload(file: File) {
  try {
    await send(file)
    haptic.notify("success")
  } catch {
    haptic.notify("error")
  }
}`,
    },
    {
      type: "note",
      tone: "info",
      text: "On web, a pulse within 200 ms of another is dropped.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "No hardware." },
        {
          target: "Mobile web",
          status: "partial",
          note: "Android: vibration. iOS Safari before 26.5: one tick, no weights. iOS 26.5+: nothing.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "A simulator has no engine.",
        },
        { target: "Android", status: "yes" },
      ],
    },
    {
      type: "api",
      name: "useHapticTick()",
      signature:
        "function useHapticTick(enabled?: boolean): (el: HTMLElement | null) => void",
      description:
        "Returns a ref callback. Taps on the element give the iOS system tick in a browser or PWA. It puts an invisible native switch over the element. Your click handler still runs. On native, and where `navigator.vibrate` exists, it attaches nothing.",
      params: [
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "`false` detaches it.",
        },
      ],
      returns: "A ref callback for the tap target.",
    },
    {
      type: "code",
      label: "save-button.tsx",
      lang: "tsx",
      code: `const tickRef = useHapticTick()

<button ref={tickRef} onClick={save}>Save</button>`,
    },
    {
      type: "p",
      text: "It gives one tick, with no weights. It adds one DOM node. The user must turn on System Haptics in iOS settings.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Not tested on a physical iOS 26.5+ device. The overlay is skipped when `navigator.vibrate` exists. The fallback that `useHaptics()` installs on iOS defines it. A target attached after that gets no overlay.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "Attaches nothing." },
        { target: "Mobile web", status: "partial", note: "iOS browsers only." },
        { target: "Installed PWA", status: "partial", note: "iOS only." },
        { target: "iOS", status: "no", note: "Native uses the engine." },
        { target: "Android", status: "no", note: "Native uses the engine." },
      ],
    },
    {
      type: "api",
      name: "useVibrate()",
      signature: "function useVibrate()",
      description:
        "Named shortcuts over `haptics`. Same targets as `useHaptics`.",
      returns: "The members below.",
    },
    {
      type: "props",
      rows: [
        {
          name: "vibrateOk / vibrateCancel",
          type: "() => void",
          description: '`impact("light")`.',
        },
        {
          name: "vibrateImpact",
          type: "() => void",
          description: '`impact("medium")`.',
        },
        {
          name: "vibrateSelection",
          type: "() => void",
          description: "`selection()`.",
        },
        {
          name: "vibrateSuccess / vibrateWarning / vibrateError",
          type: "() => void",
          description:
            '`notify("success")`, `notify("warning")`, `notify("error")`.',
        },
        {
          name: "canVibrate",
          type: "() => boolean",
          description: "`haptics.isSupported()`.",
        },
        {
          name: "hapticPointerHandlers",
          type: '(handler: () => void, kind: "ok" | "success" | "cancel") => { onTouchEnd, onClick }',
          description:
            "Handlers to spread onto an element. A touch fires the haptic on `touchend`. A mouse or pen fires it on click. `handler` runs on click.",
        },
      ],
    },
    {
      type: "code",
      label: "confirm.tsx",
      lang: "tsx",
      code: `const { hapticPointerHandlers } = useVibrate()

<button {...hapticPointerHandlers(confirm, "success")}>Confirm</button>`,
    },

    { type: "h2", text: "useGestureEngine" },
    {
      type: "api",
      name: "useGestureEngine()",
      signature:
        "function useGestureEngine(options: UseGestureEngineOptions): GestureHandlers",
      description:
        "The press engine under [Pressable](/docs/pressable), [Button](/docs/button) and other adaptv controls. The press stays armed while the finger is inside a margin around the element. It ends when the finger leaves and returns when it comes back. A touch that becomes a scroll cancels the press. Use `Pressable` first. Use the hook for an element that `Pressable` cannot render.",
      params: [
        {
          name: "onPressDown",
          type: "(e: GestureEvent) => void",
          description: "Pointer or key down.",
        },
        {
          name: "onPressUp",
          type: "(e: GestureEvent) => void",
          description: "The tap. Enter and Space also fire it.",
        },
        {
          name: "onUnownedClick",
          type: "(e: React.MouseEvent) => void",
          description:
            "A click that no press produced, such as one from an outer `<label>`. Without it, the engine blocks the click.",
        },
        {
          name: "onLongPressDown",
          type: "(e: GestureEvent) => void",
          description:
            "The hold reached `longPressThreshold`. A long press needs one `onLongPress*` callback. Without it, a long hold ends as a tap.",
        },
        {
          name: "onLongPressMove",
          type: "(e: React.PointerEvent) => void",
          description: "The pointer moved after the long press.",
        },
        {
          name: "onLongPressUp",
          type: "(e: GestureEvent) => void",
          description: "Released after a long press.",
        },
        {
          name: "onStateChange",
          type: "(state: GestureState) => void",
          description:
            '`"idle"`, `"pressing"`, `"outside"` (dragged out), `"longpress"` or `"cancelled"` (`onPressUp` does not fire).',
        },
        {
          name: "longPressThreshold",
          type: "number",
          default: "500",
          description: "Hold time in ms for a long press.",
        },
        {
          name: "longPressMaxDistance",
          type: "number",
          default: "10",
          description:
            'Travel in px that cancels a pending long press. Used when `slopMode` is `"distance"`.',
        },
        {
          name: "pressOutset",
          type: "number",
          default: "24 touch, 6 mouse and pen",
          description:
            "Margin in px where the press stays armed. Defaults are exported as `TOUCH_PRESS_OUTSET_PX` and `POINTER_PRESS_OUTSET_PX`.",
        },
        {
          name: "slopMode",
          type: '"distance" | "leave"',
          default: '"distance"',
          description:
            "What cancels a pending long press: travel past `longPressMaxDistance`, or leaving the region.",
        },
        {
          name: "claimPointerOnLongPress",
          type: "boolean",
          default: "true",
          description: "After a long press, block page scroll.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Ignore all input.",
        },
      ],
      returns:
        "Handlers to spread onto the element. `OmitGestureEngineHandlers<T>` removes their keys from a props type.",
    },
    {
      type: "p",
      text: "Style the pressed state with the Tailwind `active:` variant. On an engine element, `active:` follows `data-pressed`, not the browser `:active`. The attribute appears 100 ms after the pointer goes down and stays at least 150 ms. Keyboard activation does not set it.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes" },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },

    { type: "h2", text: "useClickFix" },
    {
      type: "api",
      name: "useClickFix()",
      signature:
        "function useClickFix(onClick: (e: React.PointerEvent<HTMLElement>) => void, options?: UseClickFixOptions): ClickFixHandlers",
      description:
        "Tap detection for a surface with its own hit-testing, such as a canvas. It measures how far the pointer moved, with the press engine's limits. It never calls `preventDefault` or `stopPropagation`.",
      params: [
        {
          name: "onClick",
          type: "(e: React.PointerEvent<HTMLElement>) => void",
          required: true,
          description: "Called on a release within the limits.",
        },
        {
          name: "options.maxTravel",
          type: "number | { touch?: number; pointer?: number }",
          default: "24 touch, 6 mouse and pen",
          description:
            "Travel in px, per axis, above which a release is not a tap. The object form sets one kind and keeps the default for the other.",
        },
        {
          name: "options.maxDuration",
          type: "number",
          description:
            "Longest press in ms that counts as a tap. No limit by default.",
        },
      ],
      returns:
        "`{ onPointerDown, onPointerUp, onPointerCancel }`. Spread them onto the surface.",
    },
    {
      type: "code",
      label: "board.tsx",
      lang: "tsx",
      code: `const handlers = useClickFix(
  (e) => {
    const shape = hitTest(e.clientX, e.clientY)
    if (shape) select(shape)
  },
  { maxTravel: { touch: 12 }, maxDuration: 400 },
)

return <canvas {...handlers} />`,
    },

    { type: "h2", text: "useFreezeViewport" },
    {
      type: "api",
      name: "useFreezeViewport()",
      signature: "function useFreezeViewport(isEnabled?: boolean): void",
      description:
        "Hold the page still while an overlay with a text field is open. It locks document scroll. On Chromium it also keeps the layout height fixed. Nested callers stack. [Drawer](/docs/drawer) already uses it.",
      params: [
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description: "Hold the freeze while `true`.",
        },
      ],
    },
    {
      type: "code",
      label: "chat-composer.tsx",
      lang: "tsx",
      code: `function Composer({ open }: { open: boolean }) {
  useFreezeViewport(open)
  const { height } = useKeyboard({ isEnabled: open })
  // pad your own scroller by \`height\`
}`,
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes", note: "Scroll lock only." },
        {
          target: "Mobile web",
          status: "yes",
          note: "iOS: scroll lock. Android Chrome: scroll lock and keyboard overlay, on a secure origin.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}
