# adaptv's default icon set

The mark an app wears when it has **no usable art of its own** — no `icons` directory, an empty
one, or one with nothing readable in it. Before this existed, such an app shipped Capacitor's
stock icon on the home screen: someone else's logo, on the owner's phone, with nothing in the
output saying so.

Every consumer reaches it the same way it reaches the app's own set — through `resolveIconSet`
in [`src/vite/icon-set.ts`](../../src/vite/icon-set.ts), which returns `source: "default"` and
these files. The native launcher icons are branded from `icon.png` / `icon-maskable.png`; the
web manifest and head are served from `/adaptv-icons/*` by the `adaptv:icons` plugin.

The dev is still told (`CLI-UX.md` R5 — an app wearing someone else's logo is not "handled"):

```
! no icons in ./public/favicons — shipping adaptv's default mark
```

## Regenerating

These files are **committed, not built** — a `dev web` run must not pay to rasterize them, and
they have to exist in the published package. They are produced by adaptv's own generator, from
[`../adaptv-mark.svg`](../adaptv-mark.svg), which is the only file to edit:

```bash
adaptv gen icons --input ../adaptv-mark.svg --yes
```

Run it from a scratch app whose `icons` points at a temp directory, then copy the output here —
`gen icons` writes into an *app's* icon directory, and pointing it at the framework's own
`assets/` would mean the framework depended on being an app. Committing the copy is the seam.

The mark is **full bleed on a flat colour**, and both halves are deliberate. Full bleed because
every platform applies its own mask and art with its own rounded background gets rounded twice.
Flat because that is what lets `measureArtwork` see the mark: it reads the border ring, finds
one colour, lifts the mark off it and scales it until it clears the mask. A gradient — which this
file used to have — is unclassifiable, so the mark would be left where it was drawn and cropped.
The reference art should demonstrate the path that works, and it generates with no warnings.
