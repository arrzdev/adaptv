# adaptv — browser-chrome auto-hide: why it cannot be had

> 🔒 **REJECTED — with measurements.** The mobile browser's own toolbar cannot be made to auto-hide
> under adaptv's shell, and **forwarding scroll to the document does not fix it**. This entry exists
> so the attempt is not made a second time.
>
> Written up 2026-08-30. The finding was established earlier, on three surfaces, and until now lived
> only in the owner's private notes — which is exactly the failure mode this folder exists to
> prevent: a rejected approach with no record reads to the next person as an obvious untried idea.
>
> ⚠︎ **The full measurement record — the three surfaces named, the engine versions, and the numbers
> — is still in those notes and should be pasted in below.** What follows is the conclusion and the
> mechanism, which is the part that stops the re-attempt.

---

## The want

On a mobile browser, scrolling down normally retracts the URL bar and grows the viewport. It is free
screen real estate and it is what every ordinary web page gets.

## Why adaptv does not get it

adaptv's shell **does not scroll the document.** `src/shell/shell-layout.tsx` puts `h-dvh` and
`overflow-hidden` on the document shell (`DOCUMENT_SHELL_CLASS` is `m-0 h-dvh touch-none
overscroll-none`), and all real scrolling happens in **inner** scrollers — `View scroll="y"`,
`ScrollView`, `List`.

That is not incidental; it is the frame contract (**L5** — the shell owns a full-viewport frame and
stretches its child) and it is what makes edge-to-edge, safe-area insets, and keyboard avoidance
tractable across six targets. **Browser chrome auto-hide is driven by document scroll**, and adaptv
has deliberately given up document scroll to get everything else.

## The two things that were tried, and what was measured

### 1. Forward the inner scroller's scroll to the document — ❌ cannot work

The idea: let the inner scroller scroll as it does now, and mirror its delta onto the document so the
browser sees document scroll and retracts its chrome.

**Measured on three surfaces: it does not work, and the reason is structural rather than a tuning
problem.** Chrome retraction is driven by the browser's own *gesture* pipeline — the compositor's
reading of a touch that scrolls the root scroller — not by the document's `scrollTop` changing.
A programmatic scroll is not a gesture, so the chrome never moves no matter how faithfully the delta
is mirrored. Worse, mirroring introduces a second scroll position to keep in sync, with its own
drift and its own overscroll behaviour.

> ⚠︎ Paste the per-surface results here.

### 2. Make the inner scroller *be* the root scroller — ❌ Chrome does not promote it

The idea: if a single inner scroller fills the viewport, perhaps the engine treats it as the root
scroller and drives chrome from it. Some engines have had a "root scroller" concept for exactly
this.

**Chrome does not promote a viewport-filling inner scroller.** It was measured and it does not
happen. The implicit-root-scroller behaviour that would make this work is not something a page can
rely on.

## The decision

**adaptv keeps the document-locked shell and gives up browser-chrome auto-hide on the mobile web
target.** The trade is deliberate:

| Kept | Given up |
|---|---|
| One frame contract across all six targets | The URL bar retracting on a mobile browser tab |
| Edge-to-edge and safe-area insets that behave | |
| Keyboard avoidance adaptv controls rather than the OS | |
| No second scroll position to keep in sync | |

**It costs nothing on four of the six targets.** An installed PWA and a native build have no browser
toolbar at all, so the loss is confined to targets 2 and 3 (mobile browser tabs) — and those are the
targets where adaptv is least trying to feel native.

## Do not confuse this with chrome *tinting*

Tinting the browser's chrome **does** work and is shipped — `src/capabilities/theme-color.ts`,
`src/shell/route-tints.ts`, `src/hooks/use-chrome-tint.ts`, and the `chromeTint` route option.
Colour is controllable; **geometry is not.** The two questions look adjacent and have opposite
answers. → [`../guides/cookbook.md`](../guides/cookbook.md) recipe 2, and register entries **B17**,
**B29**, **B32**, **B33**.

## What would reopen this

Only new platform behaviour, not a new idea:

- A standardised, reliable way to nominate an element as the root scroller.
- An engine driving chrome retraction from a nominated scroller's gesture rather than the document's.

Both are engine features. Neither is a thing adaptv can do from the page, which is precisely why this
is a locked rejection rather than an open question.
