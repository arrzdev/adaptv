import { HooksFeedbackDemo } from "@/components/docs-demos/hooks-feedback-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-feedback",
  title: "Input and feedback hooks",
  summary:
    "The on-screen keyboard, haptics, the press engine behind every adaptv control, taps on canvas surfaces, and freezing the viewport under an overlay.",
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
        "The on-screen keyboard as state: whether it is up and how tall it is. On native the OS reports an exact height. On web the height is read from the VirtualKeyboard API where it exists and otherwise worked out from `visualViewport` geometry, with the transient readings browsers emit while the keyboard animates filtered out. It reports open only while a text field is focused. Most screens do not need this hook: [AvoidKeyboard](/docs/avoid-keyboard) and [Drawer](/docs/drawer) already use it. Reach for it when you lay out around the keyboard yourself. The [keyboard guide](/docs/keyboard) covers the whole model.",
      params: [
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description:
            "Set `false` to remove the listeners. The hook then reports closed.",
        },
        {
          name: "visualViewportThreshold",
          type: "number",
          default: "100",
          description:
            "Web only. The smallest visual-viewport shrink, in px, treated as a keyboard. Smaller changes are browser chrome moving.",
        },
        {
          name: "debounceDelay",
          type: "number",
          default: "50",
          description:
            "Web only. Settle delay in ms for bursts of viewport resize and scroll events.",
        },
        {
          name: "predictFromCache",
          type: "boolean",
          default: "false",
          description:
            "Report a height the moment a field is focused, taken from what the keyboard measured last time on this device, so a lift can start on the same frame as the tap. The real measurement then confirms or corrects it; if no keyboard appears within 400 ms (a hardware keyboard, a programmatic focus) the prediction is withdrawn. Works on web and native.",
        },
      ],
      returns:
        "`{ isOpen, height }`. `height` is in px and `0` when closed. Closed on the server and until the first keyboard event.",
    },
    {
      type: "p",
      text: "While at least one enabled `useKeyboard` is mounted, the same state is published on `<html>` for CSS: the `--adaptv-keyboard-height` custom property (always defined, `0px` when closed) and the `data-keyboard-open` attribute (present or absent). Chrome that lives outside the focused form, such as a tab bar, can respond without any React state.",
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
    { type: "h3", text: "Helpers exported with it" },
    {
      type: "props",
      rows: [
        {
          name: "dismissVirtualKeyboard()",
          type: "() => void",
          description:
            "Blur the focused text field so the keyboard can close. Does nothing when the focused element is not a text field.",
        },
        {
          name: "willOpenVirtualKeyboard(target)",
          type: "(target: Element) => boolean",
          description:
            "Whether focusing the element raises a keyboard: a text-like `<input>`, a `<textarea>` or a contenteditable. Checkboxes, radios, ranges, colour, file and button inputs do not.",
        },
        {
          name: "getVirtualKeyboardApi()",
          type: "() => VirtualKeyboardApi | null",
          description:
            "`navigator.virtualKeyboard` when it exists and the page is a secure context, else `null`. Chromium only.",
        },
        {
          name: "isSecureContext()",
          type: "() => boolean",
          description: "`window.isSecureContext`, `false` on the server.",
        },
        {
          name: "KEYBOARD_MOCK_EVENT",
          type: '"adaptv:keyboard-mock"',
          description:
            "Test seam. Simulators do not raise a software keyboard for a scripted run, so a test harness can set `window.__adaptvKeyboardMock = { isOpen, height }` before the hook mounts and dispatch this event on `window` after each change. While the mock is set the hook reports it and nothing else.",
        },
        {
          name: "isSuppressibleKeyboardShrink(...)",
          type: "(wasOpen: boolean, committedHeight: number, next: KeyboardState, thresholdPx: number) => boolean",
          description:
            "The pure rule behind the native shrink filter: `true` for a small shrink of an open keyboard, which the hook holds for a moment instead of applying (iOS toggles its password AutoFill bar on and off). Exported for unit tests; an app has no use for it.",
        },
      ],
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No on-screen keyboard. `height` stays `0` and `data-keyboard-open` never appears, which is correct.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "An inferred height from viewport geometry. It trails the keyboard's animation by a few frames; `predictFromCache` closes most of that gap after the first open.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same inference as the mobile browser.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "An exact height from the OS. adaptv turns off the WebView's own resize, so the layout height does not change when the keyboard opens.",
        },
        {
          target: "Android",
          status: "yes",
          note: "An exact height from the OS. Keyboards with and without a suggestion strip differ by 40 to 50 px.",
        },
      ],
    },

    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "There are two ways to fire a haptic and they are not interchangeable. An imperative call (`useHaptics`) reaches the real engine on native and `navigator.vibrate` on Android browsers. iOS browsers have no vibration API, and from iOS 26.5 a script can no longer trigger the system tick at all; only a real finger landing on a native switch element can. That is what the declarative path (`useHapticTick`, and the `haptic` prop on [Button](/docs/button)) does. For feedback on a tap, prefer the `haptic` prop. For feedback that is not a tap (an upload finished, a timer ended), use `useHaptics`.",
    },
    {
      type: "api",
      name: "useHaptics()",
      signature: "function useHaptics(): typeof haptics",
      description:
        "Returns the imperative `haptics` object from [capabilities](/docs/capabilities) and prepares the iOS web fallback on mount, so the first call in a handler fires without delay. Call the methods from event handlers. They return nothing and never throw.",
      returns: "`{ impact, notify, selection, isSupported }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "impact(weight?)",
          type: '(weight?: "light" | "medium" | "heavy") => void',
          default: '"light"',
          description:
            "A physical tap. The three weights are distinct on native; on web they are vibration lengths of 8, 22 and 26 ms.",
        },
        {
          name: "notify(type)",
          type: '(type: "success" | "warning" | "error") => void',
          description:
            "Notification feedback. On web: one 40 ms pulse for success, a double pulse for warning and error.",
        },
        {
          name: "selection()",
          type: "() => void",
          description:
            "A light tick for a picker or segmented control changing value.",
        },
        {
          name: "isSupported()",
          type: "() => boolean",
          description:
            "Whether a haptic path exists here. It is still `true` on iOS 26.5+ Safari, where the call runs and nothing fires: the OS change cannot be detected. Do not gate UI on it for that case.",
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
      text: "On web, pulses closer together than 200 ms are dropped, because rapid vibration reads as noise. Native has no such throttle.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No hardware. The calls do nothing.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Android browsers: vibration patterns. iOS Safari 18 to 26.4: one system tick per call, no weights. iOS 26.5+: nothing.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser it was installed from.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The Taptic Engine, with all three weights and notification types. A simulator has no engine.",
        },
        { target: "Android", status: "yes", note: "The OS haptic constants." },
      ],
    },
    {
      type: "api",
      name: "useHapticTick()",
      signature:
        "function useHapticTick(enabled?: boolean): (el: HTMLElement | null) => void",
      description:
        "Returns a ref callback that makes taps on the element produce the iOS system tick in a browser or installed PWA. It overlays an invisible, non-focusable native switch on the element so the user's finger lands on it; the tap still bubbles to the element, so your click handler runs as normal. On native and on any browser with `navigator.vibrate` it attaches nothing. It is a ref callback, not an effect, so the overlay exists before the first paint.",
      params: [
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "Pass `false` to detach.",
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
      text: "Limits: the system tick only, with no weights or patterns; one extra DOM node per target; the element is given `position: relative` if it has no inline position; and it needs System Haptics switched on in iOS settings, which a page cannot detect.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The tick has not been confirmed on physical iOS 26.5+ hardware yet; simulators produce no haptics. There is also an ordering hazard in the current build: the overlay is skipped whenever `navigator.vibrate` exists, and the iOS fallback that `useHaptics()` and `haptics.*` install defines `navigator.vibrate`. On iOS Safari, a target attached after that fallback is installed gets no overlay.",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "Attaches nothing." },
        {
          target: "Mobile web",
          status: "partial",
          note: "iOS browsers only. Android browsers have `navigator.vibrate`, so nothing is attached.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "The main case: an installed iOS PWA has no other haptic path.",
        },
        {
          target: "iOS",
          status: "no",
          note: "Attaches nothing. The native engine is used instead.",
        },
        {
          target: "Android",
          status: "no",
          note: "Attaches nothing. The native engine is used instead.",
        },
      ],
    },
    {
      type: "api",
      name: "useVibrate()",
      signature: "function useVibrate(): UseVibrateResult",
      description:
        "Named shortcuts over `haptics`, plus a helper that adds tap feedback to an element's handlers. Same targets as `useHaptics`.",
      returns: "The members below. Every function has a stable identity.",
    },
    {
      type: "props",
      rows: [
        {
          name: "vibrateOk",
          type: "() => void",
          description: '`impact("light")`.',
        },
        {
          name: "vibrateCancel",
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
          name: "vibrateSuccess",
          type: "() => void",
          description: '`notify("success")`.',
        },
        {
          name: "vibrateWarning",
          type: "() => void",
          description: '`notify("warning")`.',
        },
        {
          name: "vibrateError",
          type: "() => void",
          description: '`notify("error")`.',
        },
        {
          name: "canVibrate",
          type: "() => boolean",
          description:
            "`haptics.isSupported()`. Also exported on its own from the hooks entry.",
        },
        {
          name: "hapticPointerHandlers",
          type: '(handler: () => void, kind: "ok" | "success" | "cancel") => { onTouchEnd, onClick }',
          description:
            "Handlers to spread onto an element. A touch fires the haptic on `touchend`, ahead of the click; a mouse or pen fires it on click. `handler` runs on click either way.",
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
        "The press engine under [Pressable](/docs/pressable), [Button](/docs/button) and every other adaptv control. It gives an element the press behaviour of a native control: the press stays armed while the finger wanders inside a forgiving region around the element, goes out when it leaves, and comes back when it returns; a touch that turns into a scroll cancels the press and swallows the click; a long press is recognised separately. Use `Pressable` first. Use the hook when you build a control from an element `Pressable` cannot render.",
      params: [
        {
          name: "onPressDown",
          type: "(e: GestureEvent) => void",
          description: "Pointer or key went down on the element.",
        },
        {
          name: "onPressUp",
          type: "(e: GestureEvent) => void",
          description:
            "Released inside the press region with no long press: the tap. Also fired by Enter and Space.",
        },
        {
          name: "onLongPressDown",
          type: "(e: GestureEvent) => void",
          description:
            "The hold reached `longPressThreshold`, while still held.",
        },
        {
          name: "onLongPressMove",
          type: "(e: React.PointerEvent) => void",
          description:
            "The pointer moved after the long press fired: the drag phase.",
        },
        {
          name: "onLongPressUp",
          type: "(e: GestureEvent) => void",
          description: "Released after a long press fired.",
        },
        {
          name: "onStateChange",
          type: "(state: GestureState) => void",
          description:
            '`"idle"`, `"pressing"`, `"outside"` (dragged out, still recoverable), `"longpress"`, or `"cancelled"` (a scroll or another gesture took the pointer; `onPressUp` will not fire).',
        },
        {
          name: "longPressThreshold",
          type: "number",
          default: "500",
          description: "Hold time in ms before a long press is recognised.",
        },
        {
          name: "longPressMaxDistance",
          type: "number",
          default: "10",
          description:
            'Travel in px that abandons a pending long press. The tap is unaffected. Used when `slopMode` is `"distance"`.',
        },
        {
          name: "pressOutset",
          type: "number",
          default: "24 touch, 6 mouse and pen",
          description:
            "Margin in px around the element's frame within which the press stays armed. The defaults are exported as `TOUCH_PRESS_OUTSET_PX` and `POINTER_PRESS_OUTSET_PX`.",
        },
        {
          name: "slopMode",
          type: '"distance" | "leave"',
          default: '"distance"',
          description:
            "What abandons a pending long press: travelling past `longPressMaxDistance`, or leaving the press region.",
        },
        {
          name: "claimPointerOnLongPress",
          type: "boolean",
          default: "true",
          description:
            "Once a long press fires, block page scroll so the hold can own a drag.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Drop every interaction.",
        },
      ],
      returns:
        "A handler bag to spread onto the element: the pointer, key and click handlers plus a `data-press-engine` marker. `OmitGestureEngineHandlers<T>` removes those keys from a props type.",
    },
    {
      type: "p",
      text: "A long press is only recognised when you pass at least one `onLongPress*` callback. Without one, a hold past the threshold still ends as a tap.",
    },
    {
      type: "p",
      text: "Style the pressed state with Tailwind's `active:` variant. On an element carrying the engine's marker, adaptv's stylesheet points `active:` at the engine's `data-pressed` attribute instead of the browser's `:active`, so it goes out when the finger leaves the region and returns when it comes back. The attribute appears 100 ms after the pointer goes down, so a touch that becomes a scroll never lights the control, and stays for at least 150 ms, so a quick tap is still visible. Keyboard activation does not set it.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse, pen and keyboard. Dragging out and back re-arms the press.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The target the engine exists for: the browser's own `:active` cannot be cleared from script and does not come back on re-entry.",
        },
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
        "Tap detection for a surface that does its own hit-testing: a canvas, a map, a diagram. The press engine decides a tap by whether the release landed inside the element, which is always true for a canvas, so a scroll that started on a shape would count as a tap on it. This hook measures how far the pointer travelled instead, with the same budgets the engine uses. It tracks each pointer separately, so a second finger does not disturb the first. It never calls `preventDefault` or `stopPropagation`; do that in your callback once you know what was hit.",
      params: [
        {
          name: "onClick",
          type: "(e: React.PointerEvent<HTMLElement>) => void",
          required: true,
          description: "Called on a release that stayed within the budgets.",
        },
        {
          name: "options.maxTravel",
          type: "number | { touch?: number; pointer?: number }",
          default: "24 touch, 6 mouse and pen",
          description:
            "Travel in px, per axis, past which a release is not a tap. A number applies to every pointer; the object form pins one kind and leaves the other on its default.",
        },
        {
          name: "options.maxDuration",
          type: "number",
          description:
            "Longest press in ms that still counts as a tap. Unbounded by default. Set it when a hold means something else on this surface, such as hold to pan.",
        },
      ],
      returns:
        "`{ onPointerDown, onPointerUp, onPointerCancel }` with stable identities. Spread them onto the surface.",
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
        "Hold the page still while an overlay with a text field is up, so the keyboard covers the overlay's own scroller and the page underneath does not get pushed or scrolled. It applies two things together: a document scroll lock, and on Chromium `virtualKeyboard.overlaysContent`, which keeps the layout height fixed when the keyboard opens. Both are reference-counted, so nested callers stack and the page is released when the last one lets go. [Drawer](/docs/drawer) already holds it while open. Pair it with `useKeyboard` when you build your own overlay.",
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
        {
          target: "Desktop web",
          status: "yes",
          note: "The scroll lock applies. There is no keyboard to account for.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "iOS: the scroll lock does the work, including the touch handling Safari needs. Android Chrome: the keyboard overlay too, on a secure origin.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}
