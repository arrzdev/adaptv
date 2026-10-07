import type { Block } from "./blocks"

export type Post = {
  slug: string
  title: string
  date: string
  kind: "Field note" | "Release"
  summary: string
  /** The byline. */
  author?: string
  blocks: Block[]
}

export const POSTS: Post[] = [
  {
    slug: "ios-ghost-caret",
    title:
      "The ghost caret: a text cursor that stays where the field used to be",
    date: "2026-10-07",
    kind: "Field note",
    author: "adaptv team",
    summary:
      "Slide a drawer or lift a keyboard under a focused input on iOS and the blinking caret stays behind at the old position. Five versions of the fix, and the one trick that makes WebKit redraw it.",
    blocks: [
      {
        type: "p",
        text: "Focus a text field inside a bottom sheet. As the sheet slides up, or as the keyboard lifts it, the text caret keeps blinking where the field used to be. A second caret seems to float in empty space above the keyboard. In the other version of the bug the caret never appears: you switch from one field to another and nothing blinks until you tap again.",
      },
      {
        type: "p",
        text: "Both happen when a focused field is moved by something that is not a layout change: a CSS transform, a drawer tween, a keyboard lift, a scroll. There is no CSS property or attribute that fixes it, and we found no WebKit bug number for it.",
      },
      { type: "h2", text: "Why it detaches" },
      {
        type: "p",
        text: "The explanation in adaptv's source is that on iOS the caret is painted by the system on a separate overlay layer. That layer does not follow a transform in real time. It re-syncs on a layout, selection or scroll event. A field translated by a transform emits none of those, so the caret stays put. This is our reading of the behaviour, built from what the fix needs, not something WebKit documents.",
      },
      { type: "h2", text: "Five versions that came before the one that holds" },
      {
        type: "p",
        text: "The first four are from June and July 2026, in the app adaptv was extracted from. That repository is private, so they are dated and not linked. The last is in the adaptv history.",
      },
      {
        type: "ol",
        items: [
          "**18 June: hide every caret while the drawer is unsettled.** Attributes on `<body>` hid all carets during the slide, and `revert-layer` restored them afterwards.",
          "**19 June: mute only the focused field.** WebKit did not honour `revert-layer` or the `caret-color` transition used to restore the caret. The caret stayed blank until a second tap. The replacement muted only the focused field and repainted once it had settled.",
          "**24 June: one controller for the whole app.** Settling became a quiet window of 120ms after the last movement, because counting still frames made the caret flicker on and off during a momentum scroll. The restore also had to change the selection: removing `caret-color` and asserting the same selection range again does nothing, and WebKit ignores it.",
          "**3 July: mute before the move, not after.** Reacting to movement always leaks a few ghost frames, because the mute needs a paint and a trip to the system's caret view before it takes effect. Things known to move a field, such as drawer tweens and keyboard lifts, now announce it first. A `touchstart` mutes ahead of a finger scroll, the one mover with no advance signal.",
          "**13 August: restore at the end of a known move, not 120ms later.** The quiet window is for movers that cannot say when they finish. A drawer tween can. Waiting the window out after the sheet stopped put a full-viewport paint and a raster pass 120ms late on the profiler timeline, so everything in the sheet was drawn twice. A released hold now restores at once ([9cd1277](https://github.com/arrzdev/adaptv/commit/9cd1277)).",
        ],
      },
      { type: "h2", text: "Mute while it moves, then nudge the selection" },
      {
        type: "p",
        text: "The version that holds does two things. While the field moves, it sets `caret-color: transparent`, so no ghost is visible. When the field has been still, it restores the colour and forces WebKit to recompute where the caret is, by changing the selection to a different offset and back, all in one synchronous step that never paints.",
      },
      {
        type: "code",
        label: "caret repaint, simplified",
        lang: "ts",
        code: `function mute(field: HTMLElement) {
  field.setAttribute("data-caret-muted", "true")
  // Inline and important: it has to beat any caret-* utility class on the field.
  field.style.setProperty("caret-color", "transparent", "important")
}

function restore(field: HTMLInputElement | HTMLTextAreaElement, moved: boolean) {
  field.removeAttribute("data-caret-muted")
  field.style.removeProperty("caret-color")

  // Both reads matter: the reflow, then the rect.
  void field.offsetHeight
  field.getBoundingClientRect()

  // A caret at offset 0 is fixed by the reflow. Once there is text, only a
  // real selection change makes WebKit recompute where the caret is.
  if (!moved || field.selectionStart === null) return
  const { selectionStart, selectionEnd, selectionDirection } = field
  const probe = selectionStart > 0 ? 0 : Math.min(1, field.value.length)
  field.setSelectionRange(probe, probe)
  void field.offsetHeight
  field.setSelectionRange(selectionStart, selectionEnd, selectionDirection ?? undefined)
}`,
      },
      {
        type: "p",
        text: "Around that sit three decisions. Movers that know their end, such as the drawer, bracket the move so the caret is muted before the first moved frame and restored when it ends. Movers that do not, such as a scroll, hand the field to the 120ms quiet window, which every observed movement pushes out. And the frame-by-frame poll that watches the field's rectangle runs only while something might be moving, because each read forces a layout, and polling for as long as a field has focus kept the page busy through the whole time someone filled in a form.",
      },
      {
        type: "p",
        text: "The nudge is skipped during text composition, for input types that cannot report a selection, and when the field has not actually moved, so a plain focus or typing never touches the caret.",
      },
      { type: "h2", text: "In your app" },
      {
        type: "code",
        label: "adaptv.config.ts",
        lang: "ts",
        code: `export default defineApp({
  // On by default.
  patches: { caretRepaint: true },
})`,
      },
      {
        type: "p",
        text: "One field or a whole region can opt out with `data-adaptv-no-caret-repaint` on the element or an ancestor. The `data-caret-muted` attribute is on the field while it is muted, so you can style that state.",
      },
      { type: "h2", text: "What it does not fix" },
      {
        type: "p",
        text: 'The caret is the only iOS text overlay that can be controlled from the web, through `caret-color`. The autocorrect and spelling suggestion popover, the misspelled-word underline, the selection handles, the magnifier and the Cut/Copy/Paste callout are all drawn by the system. They detach on scroll in the same way, and there is no web hook to move, mute or redraw them. The only mitigation is to stop them appearing, with `autocorrect="off"` and `spellcheck={false}` on the field. That costs inline corrections, and setting them after the overlay is already on screen does not dismiss it.',
      },
      { type: "h2", text: "What is still open" },
      {
        type: "ul",
        items: [
          "We did not record which iOS versions show the bug, and we have no WebKit bug to link.",
          "A translation that neither declares itself nor rides a scroll is invisible to the patch, because the poll is off when nothing is expected to move. The contract is stated in the source.",
          "The explanation of why the caret detaches is the authors' reading of the behaviour. It has not been checked against WebKit's source.",
        ],
      },
      {
        type: "note",
        text: "This is a workaround for a platform bug. Re-test it on each major iOS release, on a real device, and remove it once WebKit moves the caret with the field.",
      },
    ],
  },
  {
    slug: "ios-cold-start-launch-height",
    title: "The installed iOS app that launches at the wrong height",
    date: "2026-10-07",
    kind: "Field note",
    author: "adaptv team",
    summary:
      "On a cold launch from the Home Screen, iOS lays the page out against one height, then another. A centred splash jumps, or sits 31pt off. Seven fixes that did not hold, and the head script that does.",
    blocks: [
      {
        type: "p",
        text: "Install a web app to the iOS Home Screen and launch it cold. Within the first half second, whatever is vertically centred moves: a splash mascot slides, or a strip of the wrong colour shows at the top and bottom. In a Safari tab nothing moves. In the Simulator the window is too short to see. On a device it is plain.",
      },
      {
        type: "p",
        text: "adaptv's shell is built around a splash that has to sit still while the app boots, so this had to be fixed at the root. It took seven attempts across three months and two iOS releases, and the last one was needed because iOS 26.1 reversed the direction of the bug.",
      },
      { type: "h2", text: "What the page is told, and when" },
      {
        type: "p",
        text: "An installed app does not get its geometry in one go. The measurements below come from the research notes behind this fix: one Face ID iPhone, dark mode, standalone cold start, iOS version not recorded.",
      },
      {
        type: "table",
        head: ["Time", "What happens", "innerHeight", "safe-area-inset-top"],
        rows: [
          ["~496 ms", "The web view paints its first layout", "812", "0"],
          ["~667 ms", "The real safe-area insets are published", "812", "62"],
          ["~696 ms", "innerHeight and visualViewport catch up", "874", "62"],
        ],
      },
      {
        type: "p",
        text: "A shell sized with `100dvh` or `100vh` is 812 tall for the first two rows and 874 tall for the third. Anything centred in it moves by half the difference, 31pt, which is the jump. The notes read the dark-mode flash as the same event: a shell 812pt tall does not cover the 874pt canvas, and the web view's own background shows through the gap. Our reading is that the initial containing block grows after first paint, and `100vh` follows it.",
      },
      {
        type: "p",
        text: "WebKit has a bug for the delay itself. [Bug 191872](https://bugs.webkit.org/show_bug.cgi?id=191872) reports that a WKWebView does not set `env(safe-area-inset-*)` until some arbitrary time after load. It was filed in November 2018 and is still NEW. Capacitor measured the same thing in [issue 2920](https://github.com/ionic-team/capacitor/issues/2920): a safe-area probe reads without the inset at load and with it about 300ms later. [Bug 274773](https://bugs.webkit.org/show_bug.cgi?id=274773), from May 2024, is a related report that `env(safe-area-inset-*)` returns 0. Those two describe WKWebView and Safari content; the installed-app timeline above is our own measurement, not something they state.",
      },
      { type: "h2", text: "Seven things that did not hold" },
      {
        type: "p",
        text: "The first five are from June 2026, in the app this framework was extracted from, and that repository is private, so they have no links. The last two are in the adaptv history.",
      },
      {
        type: "ol",
        items: [
          "**Wait for stable geometry, then mount.** An animation-frame poll for a steady viewport and safe area, plus toggling `viewport-fit` to make WebKit recompute `env()`. The notes record the result as a black screen that never ended.",
          "**Lock the splash frame to its first-paint size.** The splash stops resizing, but the shell under it still moves, so the splash sits at the wrong place inside it. Removed the next day. No reason was recorded beyond that.",
          "**Render the splash only on the client.** It hides the jump in development, where the page is a browser tab or a client navigation. In production the server-rendered HTML has already painted before React runs, so the jump is on screen first. The notes call it too late, after paint.",
          "**Measure the visual viewport in a head script and size the shell with a custom property.** The property was `--app-height`, and the change was reverted soon after. The commit says only that it was a test of a variation, so the reason is not recorded.",
          "**Give the splash a height of 100lvh.** In a Safari tab `lvh` is taller than what is visible, so it was scoped to the installed app. It did not end the problem.",
          "**Freeze the launch height, as first written for iOS 18.** It held off growth and never followed a shrink, so on iOS 26.1 the frozen value stayed 874 while the view shrank to 812. [ea8828b](https://github.com/arrzdev/adaptv/commit/ea8828b) lets it follow the view down; details below.",
          "**Cover the launches the resize never reaches.** A page reloaded after it had already shrunk gets no resize event ([1b253f5](https://github.com/arrzdev/adaptv/commit/1b253f5)). React then clears the attributes on `<html>` when a client root takes over, and an offline launch lost the height ([b4fa381](https://github.com/arrzdev/adaptv/commit/b4fa381)).",
        ],
      },
      { type: "h2", text: "Freeze the number the splash is centred against" },
      {
        type: "p",
        text: "The fix that held does not try to be right about the final geometry. It makes the splash's height a number that cannot change while the viewport warms up. A blocking script in the head measures what `100vh` resolves to, using a hidden fixed element, and writes it to `--pwa-launch-height` on `<html>`. The splash is `height: var(--pwa-launch-height, 100lvh)`, so it is centred in the same box on every frame until it is revealed.",
      },
      {
        type: "p",
        text: "A brand-coloured `html::before` extends past every edge, so the part of the canvas the shell does not cover is the splash colour, not the web view's default.",
      },
      {
        type: "code",
        label: "launch height script, simplified",
        lang: "ts",
        code: `(function () {
  var root = document.documentElement
  var installed = matchMedia("(display-mode: standalone)").matches
    || navigator.standalone === true
  if (!installed) return // a browser tab has no such shift

  // Read what 100vh resolves to right now, through a hidden fixed element.
  function measure(height) {
    var probe = document.createElement("div")
    probe.style.cssText = "position:fixed;top:0;left:0;width:0;visibility:hidden;height:" + height
    root.appendChild(probe)
    var h = Math.round(probe.getBoundingClientRect().height)
    probe.remove()
    return h
  }

  var height = measure("100vh")
  if (!(height > 0)) return

  var ios = navigator.standalone === true // set by Home Screen apps on iOS only

  // Lower the height to what is on screen. Never raise it.
  function lower() {
    var shown = Math.round(innerHeight) + measure("var(--adaptv-inset-top, 0px)")
    if (innerHeight > 0 && shown < height) height = shown
  }
  function freeze() {
    root.style.setProperty("--pwa-launch-height", height + "px")
    window.__adaptvLaunchHeight = height // restored after React clears <html>
  }

  if (ios) lower()
  freeze()
  if (!ios) return

  addEventListener("resize", function onResize() {
    if (root.hasAttribute("data-adaptv-splash-revealed")) {
      removeEventListener("resize", onResize)
      return
    }
    var before = height
    lower()
    if (height !== before) freeze()
  })
})()`,
      },
      {
        type: "p",
        text: "The version that ships is the same logic, minified, and the script is emitted after the stylesheet link. On the server-rendered document React hoists route stylesheets above it, so the script waits for them; the generated shell places it after the link for the same wait.",
      },
      { type: "h2", text: "iOS 26.1 turned the bug around" },
      {
        type: "p",
        text: "The freeze was written for iOS 18, where the viewport grows after first paint. It holds off growth and never follows it. On an iOS 26.1 simulator (iPhone 17, build 23B86) the splash sat 31pt below the middle of the screen on 44 of 54 cold launches over four rounds, and in the middle on the other ten. The cause: on most launches the script runs while the web view is still the whole 874pt screen. About 120ms later the view shrinks to 812pt below the status bar and fires `resize`, while `100vh` stays 874. The frozen number is now taller than what is on screen.",
      },
      {
        type: "p",
        text: "The change was to let the freeze go down. Until the splash is revealed, a `resize` that leaves less than the frozen height lowers it to `innerHeight` plus the top inset. It reads `innerHeight`, not `100dvh`, because at that event `100dvh` still reads 874 and only settles to 812 later, with no further event. On iOS 18 the page runs under the status bar, so `innerHeight` plus the inset is the whole screen and nothing changes. The shrink is lowered only in an iOS Home Screen app, because it was not measured anywhere else.",
      },
      {
        type: "p",
        text: "A static page with no adaptv in it reads the same way on iOS 26.1. The installed app also could not scroll to the last 62pt of a page: the shell was `h-screen`, 874, inside an 812 viewport. The shell is now `min(100vh, 100dvh + the top inset)` ([c9366b2](https://github.com/arrzdev/adaptv/commit/c9366b2)), which is 812 on 26.1 and the whole screen on 18.0.",
      },
      { type: "h2", text: "What is still open" },
      {
        type: "ul",
        items: [
          "A rotation before the splash is revealed lowers the height and does not raise it back.",
          "The 44-of-54 figure is from a simulator. The offline-launch check (the splash mascot at 368pt without the script, 337pt online, a 31pt gap) was recorded on 2026-09-14 on the same iPhone 17 and iOS 26.1 build, and the record does not say if it was a device or the simulator. The Safari-tab and deploy rows were not re-run on 26.1.",
          "The explanation that the initial containing block expands after first paint is the authors' reading of the behaviour. We have not confirmed it in WebKit's source.",
          "Both WebKit bugs above were still NEW when this was written.",
        ],
      },
      {
        type: "note",
        text: "This is a workaround for a platform bug. Re-test it on each major iOS release, on a real device, with a cold launch in dark mode, and remove it if WebKit publishes the geometry before first paint.",
      },
    ],
  },
  {
    slug: "the-loupe",
    title: "The loupe: a bug CSS cannot reach",
    date: "2026-10-07",
    kind: "Field note",
    author: "adaptv team",
    summary:
      "Double-tap a button in an iOS web view and a text magnifier appears over it. No CSS property turns it off. Here is what does — and the three versions of the fix that broke scrolling first.",
    blocks: [
      {
        type: "p",
        text: "Tap, then tap-and-hold, almost anywhere in an iOS web view. A magnifier bubble — the text-selection loupe — pops up under your finger. It appears over buttons, over links, over text you marked as non-selectable, over empty space. It is the single fastest way to tell that an app is a web page.",
      },
      { type: "h2", text: "Nothing in CSS governs it" },
      {
        type: "p",
        text: 'The instinct is to reach for user-select: none, or -webkit-touch-callout, or touch-action. Those control selection, the long-press callout menu, and panning — three different things. The loupe is none of them. This is [WebKit bug 231161](https://bugs.webkit.org/show_bug.cgi?id=231161), “REGRESSION (iOS 15): Safari shows zoom callout even if -webkit-user-select is none”. It was marked fixed for iOS 15.2. In July 2025 someone on the bug reported that `-webkit-user-select` no longer disables the loupe, and a new bug was opened for it: [bug 296492](https://bugs.webkit.org/show_bug.cgi?id=296492), "REGRESSION: Safari loupe can\'t be disabled with CSS".',
      },
      { type: "h2", text: "What actually arms it" },
      {
        type: "p",
        text: "The loupe is armed by the second touchstart of a double-tap. So the only thing that stops it is a non-passive touchstart listener that calls preventDefault() on exactly that second tap.",
      },
      {
        type: "p",
        text: "“Exactly” is the whole problem. preventDefault() on a touchstart cancels the entire gesture that touch would have started — including a scroll. A suppressor that fires on any quick second touch also kills fast scroll flicks, and chains across rapid tapping until the page feels frozen. The naive fix trades one visible bug for a worse invisible one.",
      },
      { type: "h2", text: "Three attempts in three days" },
      {
        type: "p",
        text: "The suppressor was written in June 2026, in the app adaptv was extracted from. That repository is private, so the attempts are dated rather than linked.",
      },
      {
        type: "ol",
        items: [
          "**24 June: cancel any second touch within 500ms.** A non-passive `touchstart` listener that called `preventDefault()` on a touch that came less than 500ms after the last one, skipping editable fields. It froze list scrolling. A quick flick right after a tap counted as the second tap, and `preventDefault()` on a `touchstart` cancels the whole gesture, so the list did not move.",
          "**24 June, the same day: add a radius and track movement.** The second touch had to land within 28px of the first, and the first had to stay within 10px of where it started. Scrolling and rapid tapping still froze. The code that replaced it names the tap-spam freeze as the thing it fixes: a cancelled touch could pair with the next one, so `preventDefault()` chained across every rapid tap.",
          "**27 June: rework it.** The version below. It records a first tap only when the touch ends as a clean tap, and a touch the suppressor consumed never becomes one.",
        ],
      },
      {
        type: "note",
        text: "The cause of the second failure is read from the code comments of the version that replaced it. The commit messages name only the symptoms: scroll and tap-spam still froze.",
      },
      { type: "h2", text: "The shape that works" },
      {
        type: "p",
        text: "adaptv only treats a touch as the second tap of a double-tap when all of these hold:",
      },
      {
        type: "ul",
        items: [
          "It follows a completed, stationary, single-finger tap: it ended within 700ms and moved less than 10px. A scroll flick moves, so it never records as a first tap — scrolling is safe by construction, not by threshold tuning.",
          "It arrives inside the OS's own double-tap window, about 350ms. Past that, iOS arms no loupe, so there is nothing to suppress.",
          "It lands within 28px of the first tap.",
          "It is one finger. A second finger is a pinch.",
          "Its target is not editable text, and not inside an element marked `data-adaptv-no-text-magnifier`. Inputs keep their native loupe and double-tap-to-select-word, because there it is a feature.",
        ],
      },
      {
        type: "p",
        text: "After a suppression the anchor is cleared, so a third rapid tap starts a fresh pair instead of chaining. And the listener never stops propagation — pointer events, gesture handling and drag-and-drop libraries still see every touch. Only the browser's default is cut.",
      },
      { type: "h2", text: "Why buttons are not exempt" },
      {
        type: "p",
        text: "An earlier version skipped interactive controls, on the theory that you should not interfere with a button's touch events. That is precisely where the loupe kept appearing. It turns out to be safe to suppress there: adaptv's controls activate from pointer events, which a preventDefault() on touchstart does not touch.",
      },
      { type: "h2", text: "In your app" },
      {
        type: "code",
        label: "adaptv.config.ts",
        lang: "ts",
        code: `export default defineApp({
  // On by default. This is the whole API.
  patches: { textMagnifier: true },
})`,
      },
      {
        type: "note",
        text: "This is a workaround for a platform bug, and it carries its own removal instructions in the source: re-test on each major iOS release, on a real device — the Simulator does not reliably reproduce the loupe — and delete it the day WebKit fixes it for good.",
      },
    ],
  },
]
