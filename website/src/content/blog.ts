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
    slug: "ios-26-browser-bar-tint",
    title: "iOS 26 stopped reading theme-color. Here is what it reads instead",
    date: "2026-10-07",
    kind: "Field note",
    author: "adaptv team",
    summary:
      "In Safari on iOS 26 the meta tag does nothing, and each browser bar takes its colour from whatever fixed element touches its edge. Six attempts to tint it, the WebKit rules behind them, and the 12px strip that makes it work.",
    blocks: [
      {
        type: "p",
        text: "On iOS 26 the colour of Safari's top bar and bottom toolbar no longer follows `<meta name=\"theme-color\">`. A route that asks for a green bar gets none. A theme switch tints nothing. A drawer that dims the page reaches the top bar as a single step instead of a fade, and a tall bottom sheet leaves the bottom toolbar in the page colour instead of the sheet's.",
      },
      {
        type: "p",
        text: "iOS 18 Safari and Android Chrome still read the meta tag. So an app has to drive two mechanisms at once, and the new one is not documented. The rules below come from reading WebKit's source, then checking them against recordings.",
      },
      { type: "h2", text: "What the tag does now" },
      {
        type: "p",
        text: "caniuse lists `theme-color` in iOS 26 as supported but not used for any colour. A WebKit engineer confirmed the new model in [bug 301756](https://bugs.webkit.org/show_bug.cgi?id=301756): a solid tint extension is only needed where a fixed or sticky element sits near an edge of the viewport. The bug is a question from a developer whose bar matched their page background, and the answer is that this is intended.",
      },
      {
        type: "p",
        text: "adaptv checked it on an iOS 26.1 simulator (build 23B86) with a probe page painting three different colours, on `html`, on `body` and on the app's content, and the meta tag set to a fourth that appeared nowhere else.",
      },
      {
        type: "table",
        head: ["Surface", "iOS 18", "iOS 26.1"],
        rows: [
          [
            "meta `theme-color`",
            "Drives the top bar",
            "Inert. The colour never appears on screen",
          ],
          [
            "`html` and `body` background",
            "Anti-flash only",
            "Drives both the status bar band and the bottom band",
          ],
          [
            "Content painted to the edge",
            "Covered by the solid bar",
            "Wins. The bars take the content's own edge pixels",
          ],
        ],
      },
      {
        type: "p",
        text: "One more trap: Safari 26 reports `CPU iPhone OS 18_7` in its user agent. A check for iOS 26 or later is always false on the web. The first version of the fix gated on it and produced nothing anywhere.",
      },
      { type: "h2", text: "Six attempts that did not hold" },
      {
        type: "ol",
        items: [
          "**Write the meta tag.** The original approach, in place since June. It is inert on iOS 26 and was found out in July ([60cbf63](https://github.com/arrzdev/adaptv/commit/60cbf63)).",
          "**Paint only the root element.** Added on 29 August ([1155586](https://github.com/arrzdev/adaptv/commit/1155586)). It loses to a `body` that paints its own background. A static probe with `html` green under a light `body` left both bands light, and with a transparent `body` both turned green. The first frame of a cold launch in iOS 26.1 Safari still showed the theme colour. The cause is probable, not proven.",
          "**Animate the tint through the page background.** Declined. Writing a background colour on `html` or `body` every frame repaints the whole page, which is held to 60 Hz on iOS.",
          "**Animate the backdrop's colour alpha instead of its opacity,** in case Safari reads the declared colour each frame. On a static probe the top band froze at the colour of the layer's first painted frame, between 1 and 16% of the full dim, for the whole 2.5 seconds the layer was open. That is worse than the step.",
          "**Twelve static variants.** A CSS `opacity` transition on the scrim is read only at its end. A per-frame `background-color`, `transform`, layout change or re-append on the dimming layer all latch at the first read. A recording of the tree as of 2 September matched main frame for frame, so this was never a regression.",
          "**Let the sheet's panel include its hidden tail.** The drawer answered the keyboard by growing ([c031177](https://github.com/arrzdev/adaptv/commit/c031177), reworked in [9cd1277](https://github.com/arrzdev/adaptv/commit/9cd1277)) with `bottom: -excess` and a spacer of 55% of the viewport. A form-sized sheet then measured about 1.3 viewports, and Safari's bottom bar fell back to the page colour.",
        ],
      },
      { type: "h2", text: "How iOS 26 picks a band's colour" },
      {
        type: "p",
        text: "These rules were read from `LocalFrameView::fixedContainerEdges` and `Page::updateFixedContainerEdges` in WebKit's main branch on 21 September. We have not seen WebKit document them.",
      },
      {
        type: "ul",
        items: [
          "For each edge, WebKit hit-tests the midpoint of that edge, 4px in, and walks up from the element it hits to the first ancestor that is `position: fixed` or `sticky` and has a layer.",
          "That ancestor is skipped if it is narrower than 90% of the viewport, or taller than 1.05 viewports unless it is a dimming layer.",
          "A viewport-sized box with no children and a transparent or translucent background is a dimming layer. A viewport-sized or dimming container keeps the colour already recorded for that edge, so a backdrop's colour is read once, on its first visible frame.",
          "The colour is the first visible `background-color` found on the way up, and a box with alpha under 0.1 is skipped as nearly transparent. Alpha under 0.75, or a dimming layer's colour, is blended over the page background.",
          "With no fixed container at an edge, Safari shows the page background colour, live.",
        ],
      },
      {
        type: "p",
        text: "Those rules explain both failures. The backdrop is read once, so the top band steps. The sheet was too tall, so WebKit walked past it to `body`.",
      },
      { type: "h2", text: "Fix one: a strip at the top that is read live" },
      {
        type: "p",
        text: 'A full-width fixed strip at the top edge is not viewport-sized on the other axis, so it counts as an ordinary candidate and its colour is re-read. A repaint of a fixed, composited layer also schedules a re-read. So adaptv keeps a 12px strip, fixed at `top: 0`, full width, with `pointer-events: none`, at the top of the stacking order, and writes its `background-color` every frame next to the meta tag. It is a "band donor" ([836e13c](https://github.com/arrzdev/adaptv/commit/836e13c)).',
      },
      {
        type: "p",
        text: "It is invisible on the page because it is set to 12% opacity. WebKit reads the element's `background-color`, not its composited pixels, and skips a box only when the alpha is under 0.1. The strip does not move the layout viewport: `innerHeight`, `visualViewport.height`, `clientHeight`, `svh`, `lvh`, `dvh` and `scrollY` read the same with and without it. With the real drawer on the iOS 26.1 simulator the top band follows the scrim across the whole 297 ms open with no dropped frames, and trails the close by at most 48 ms, where it used to hold for about 140 ms.",
      },
      {
        type: "code",
        label: "band donor, simplified",
        lang: "ts",
        code: `// Every tint write goes to the meta tag and to the donor.
function paintTint(color: string) {
  meta.setAttribute("content", color)
  const strip = bandDonor() // created on the first paint that has an audience
  if (strip) strip.style.backgroundColor = color
}

function bandDonor(): HTMLElement | null {
  if (donor?.isConnected) return donor
  if (!(isIOS() && !isInstalledApp())) return null // Safari tab only
  donor = document.createElement("div")
  donor.setAttribute("data-adaptv-band-donor", "")
  donor.setAttribute("aria-hidden", "true")
  donor.style.cssText =
    "position:fixed;top:0;left:0;right:0;height:12px;" +
    "pointer-events:none;opacity:.12;z-index:2147483647"
  document.body.appendChild(donor)
  return donor
}`,
      },
      {
        type: "p",
        text: "The strip is created only in a Safari tab. An installed web app or a Capacitor shell has no browser bar to feed, and Android reads the meta tag. It is not gated on the iOS version, for the reason above, so iOS 18 Safari gets it too, harmlessly.",
      },
      { type: "h2", text: "Fix two: keep the panel under 1.05 viewports" },
      {
        type: "p",
        text: "The bottom bar needed the sheet to stay inside WebKit's size limit. The panel now sits at `bottom: 0`, and the hidden tail below the fold is an absolutely positioned child at `top: 100%` that inherits the panel's background ([e02415c](https://github.com/arrzdev/adaptv/commit/e02415c)). The panel's own box stays under 1.05 viewports. A static probe reproduced it exactly: a 571px fixed sheet with `bottom: -314px` gave a white band, and the same sheet with the tail as a child gave the sheet's colour. After the change the Create-task drawer's band read the sheet's colour at both edges.",
      },
      {
        type: "h2",
        text: "Fix three: a scrim that stays after the OS switches theme",
      },
      {
        type: "p",
        text: "In an installed iOS 26.1 app, switching the OS from light to dark while the app is open left the top band at `#010101` instead of the dark theme's `#0a0a0c`, 13 seconds later and still there. It is the right page colour under a scrim of about 90% black. It appeared whenever the page was light at the moment of the switch, and not when it was already dark. A probe page with none of adaptv's code reproduces it. When the page follows the OS, a same-document navigation clears it, and so does painting the whole page dark for 300 ms, but that is a 600 ms black flash and was rejected.",
      },
      {
        type: "p",
        text: "The fix runs inside the `prefers-color-scheme` change handler: it calls `replaceState` to a new hash and straight back, in the same task ([7b6d6c3](https://github.com/arrzdev/adaptv/commit/7b6d6c3)). That was clean in 3 of 3 live switches and 3 of 3 switches while the app was in the background, against 2 of 2 banded without it. Why it works is inferred; it has not been traced in WebKit.",
      },
      { type: "h2", text: "The meta tag still matters elsewhere" },
      {
        type: "p",
        text: "On iOS 18 Safari and Android Chrome the bar follows the meta tag, but the tag is read one process hop after it is written. adaptv samples the tint half a measured frame ahead of its curve ([1155586](https://github.com/arrzdev/adaptv/commit/1155586)), which brought the bar within −5 to +1.3 ms of the scrim. A stack of scrims keeps stacked drawers from handing the bar back early ([5c5e2cf](https://github.com/arrzdev/adaptv/commit/5c5e2cf)).",
      },
      { type: "h2", text: "What is still open" },
      {
        type: "ul",
        items: [
          "All of this was measured on iOS simulators, from 60 fps recordings. The installed app and a physical iPhone were not measured for the donor strip.",
          "On a route whose tint differs from the page background, the 12% strip leaves a faint 12px of that colour over the first rows. That was not measured.",
          "The cause of the latched scrim is inferred. The replaceState fix is empirical.",
          "The WebKit rules are from one reading of the source on one date. They can change.",
          "[WebKit bug 301756](https://bugs.webkit.org/show_bug.cgi?id=301756) is the only bug we cite, and it is a clarification, not a defect.",
        ],
      },
      {
        type: "note",
        text: "This is a workaround for undocumented platform behaviour. Re-test it on every iOS release with a recording, because the rules above are not a contract.",
      },
    ],
  },
  {
    slug: "ios-keyboard-viewport-freeze",
    title: "Freezing the iOS viewport when the keyboard opens",
    date: "2026-10-07",
    kind: "Field note",
    author: "adaptv team",
    summary:
      "Focus a field in a bottom sheet on iOS and WebKit scrolls the document and shrinks the viewport under your fixed UI. Six attempts, the scroll lock with its two carve-outs, and the offscreen trick that raises the keyboard without a jump.",
    blocks: [
      {
        type: "p",
        text: "Focus a text field inside a bottom sheet or a chat composer on iOS. WebKit scrolls the document to bring the field into view and shrinks the visible viewport to make room for the keyboard. Fixed UI jumps up. When the keyboard closes, a gap or a shoved page can be left behind. If you stop it with a prevented tap and a script that calls `focus()`, the keyboard may not rise at all.",
      },
      {
        type: "p",
        text: "adaptv wants the opposite: the page holds still, and only the sheet's own scroller makes room for the keyboard. That is a viewport freeze, and it has two halves. One keeps the document from moving. The other gets the keyboard up without the move that normally comes with it.",
      },
      { type: "h2", text: "What each platform does" },
      {
        type: "table",
        head: ["Browser", "How the viewport is held"],
        rows: [
          [
            "iOS Safari and installed iOS app",
            "A scroll pin on the document, described below.",
          ],
          [
            "Chromium, in a secure context",
            "`navigator.virtualKeyboard.overlaysContent = true`, so the keyboard overlays the page and the layout height does not change.",
          ],
          [
            "Everything else",
            "`overflow: hidden` on the root element, with padding for the scrollbar width.",
          ],
        ],
      },
      {
        type: "p",
        text: "The scroll lock and the keyboard overlay are both reference counted. An app can hold the freeze for the whole session, an opening drawer reinforces the same lock, and a drawer in an app that never froze globally holds it alone.",
      },
      { type: "h2", text: "Six attempts that did not hold" },
      {
        type: "p",
        text: "Five of these are from June 2026, in the app adaptv was extracted from. That repository is private, so they are dated and not linked. The last is in the adaptv history.",
      },
      {
        type: "ol",
        items: [
          "**9 June: size the shell from the visual viewport.** A head script wrote the visual viewport's height to a custom property and the shell used it. It was reverted soon after, and the commit gives no reason. A height that follows the viewport also follows it when the keyboard opens, which is the movement a frozen shell is meant to ignore. That second part is our inference.",
          "**9 June: lift fixed elements by the keyboard's height.** The offset was `innerHeight` minus the visual viewport's height, applied as a translate to every fixed bottom element, together with the drawer library's own input repositioning. It was gone by the shell rewrite a week later. The shortfall was never written down.",
          "**18 June: pad the sheet's scroller.** Padding on the inner scroller, plus a lift for the hidden excess. Removed on 22 June. A note from the same week says `overflow: hidden` on the body is not enough, because WebKit scrolls the focused field into view on its own.",
          "**A fixed offscreen nudge.** The focus trick below first moved the field up by a constant 2000px, which fell short on a tall viewport. On 19 June it became the viewport height plus 200px.",
          "**Cancel touches at the scroller's edges.** Calling `preventDefault()` when a touch reached the end of an inner scroller killed pull-to-overscroll, caused flicker from layout reads on every `touchmove`, and swallowed the system's edge swipe. The fix on 27 June was `overscroll-behavior: contain` on scrollers and a 24px strip at each screen edge that the lock leaves alone.",
          "**Taps that were scrolls.** A drag that ended over a field focused it and raised the keyboard. On 23 June a 10px travel limit separated taps from drags. In September, [cd3e1b6](https://github.com/arrzdev/adaptv/commit/cd3e1b6) fixed the other half: the walk that finds the scroller a touch would move skipped the scroller's own box, so a drag that began on its padding was treated as a drag on the document and cancelled. It was checked in Playwright's WebKit with the iPad Pro 11 profile, over 3,383 grid points on each of six test pages.",
        ],
      },
      { type: "h2", text: "Half one: pin the document" },
      {
        type: "p",
        text: "On iOS the lock sets `overflow: hidden` on `<html>`, gives `<body>` a negative top margin equal to the current scroll position, scrolls the window to the top, and scrolls it back to the top on every `scroll` event. It also cancels `touchmove` with `preventDefault()`, but only for touches that would move the document itself. A touch that lands on an inner scroller is left alone, so the scroller still scrolls and bounces.",
      },
      {
        type: "p",
        text: "Two carve-outs came from the failed attempts. A touch that starts within 24px of the left or right screen edge is never cancelled, so the system's back and forward swipe survives. And the scroller a touch would move is found starting from the touched element itself, not its parent, so a finger on a scroller's padding or between its rows is not mistaken for a finger on the page. Bounce is contained by `overscroll-behavior: contain` on the scroller itself. WebKit has a [bug open since 2022](https://bugs.webkit.org/show_bug.cgi?id=243452) where that property does nothing on a box that does not overflow, and Chrome 144 and Firefox 150 have fixed it for themselves.",
      },
      { type: "h2", text: "Half two: raise the keyboard from offscreen" },
      {
        type: "p",
        text: "The lock stops the page from scrolling, but WebKit still runs its own scroll-into-view when a field takes focus. So adaptv takes the focus away from the tap. On `touchend` over a field that would open the keyboard, it cancels the tap, moves the field a viewport height and 200px up with a transform, calls `focus()`, and clears the transform on the next frame. WebKit does its scroll-into-view against the offscreen position and has nothing to scroll. Our reading is that this is why the page then stays put; we have not confirmed it in WebKit's source.",
      },
      {
        type: "code",
        label: "keyboard without a jump, simplified",
        lang: "ts",
        code: `const MARGIN = 200
const offscreen = () =>
  \`translateY(-\${Math.ceil(visualViewport?.height ?? innerHeight) + MARGIN}px)\`

document.addEventListener("touchend", (event) => {
  if (touchMoved) return // a scroll that ends over a field must not focus it

  const field = event.composedPath()[0]
  if (field instanceof HTMLElement && willOpenKeyboard(field) && field !== document.activeElement) {
    event.preventDefault()
    field.style.transform = offscreen()
    field.focus()
    requestAnimationFrame(() => { field.style.transform = "" })
  }
}, { passive: false, capture: true })

// A field focused some other way gets the same nudge.
document.addEventListener("focus", (event) => {
  const field = event.composedPath()[0]
  if (field instanceof HTMLElement && willOpenKeyboard(field)) {
    field.style.transform = offscreen()
    requestAnimationFrame(() => { field.style.transform = "" })
  }
}, true)`,
      },
      { type: "h2", text: "In your app" },
      {
        type: "code",
        label: "adaptv.config.ts",
        lang: "ts",
        code: `export default defineApp({
  // On by default.
  patches: { viewportFreeze: true },
})`,
      },
      {
        type: "p",
        text: "A subtree can opt out with `data-adaptv-no-viewport-freeze`. A touch that begins inside it is neither pinned nor nudged. The freeze is also a hook, `useFreezeViewport`, that drawers call while they are open.",
      },
      { type: "h2", text: "Why not something declarative" },
      {
        type: "p",
        text: "adaptv looked for a way to drop the script. The `<dialog>` element's `showModal()` does not stop the page scrolling: the HTML spec's blocking covers hit-testing and focus, and the proposal to block scroll, [whatwg/html#7732](https://github.com/whatwg/html/issues/7732), is still open. And there is a WebKit regression, [bug 299084](https://bugs.webkit.org/show_bug.cgi?id=299084), reported in September 2025: in Safari 26, `overflow: hidden` on the body or the root stopped disabling scroll. A commenter reproduced it on iOS 26.0 and found it apparently fixed in 26.1, though a WebKit engineer replied that there are still plenty of bugs here. adaptv does not rely on `overflow: hidden` alone on iOS.",
      },
      { type: "h2", text: "What is still open" },
      {
        type: "ul",
        items: [
          "We did not record which iOS versions show each symptom.",
          "The reason the offscreen move prevents the scroll is the authors' reading of the behaviour.",
          "The commits for five of the six failed attempts are in a private repository, so only the sixth links.",
          "Both WebKit bugs above were still NEW when this was written.",
        ],
      },
      {
        type: "note",
        text: "This is a workaround for platform behaviour. Re-test it on each major iOS release, on a real device, with a sheet that has a text field in it, and remove the parts WebKit makes unnecessary.",
      },
    ],
  },
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
          "**Freeze the launch height, as first written for iOS 18.** It held off growth and never followed a shrink, so on iOS 26.1 the frozen value stayed 874 while the view shrank to 812. [dfd7f54](https://github.com/arrzdev/adaptv/commit/dfd7f54) lets it follow the view down; details below.",
          "**Cover the launches the resize never reaches.** A page reloaded after it had already shrunk gets no resize event ([5addaf0](https://github.com/arrzdev/adaptv/commit/5addaf0)). React then clears the attributes on `<html>` when a client root takes over, and an offline launch lost the height ([cd09067](https://github.com/arrzdev/adaptv/commit/cd09067)).",
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
        text: "A static page with no adaptv in it reads the same way on iOS 26.1. The installed app also could not scroll to the last 62pt of a page: the shell was `h-screen`, 874, inside an 812 viewport. The shell is now `min(100vh, 100dvh + the top inset)` ([2b15810](https://github.com/arrzdev/adaptv/commit/2b15810)), which is 812 on 26.1 and the whole screen on 18.0.",
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
