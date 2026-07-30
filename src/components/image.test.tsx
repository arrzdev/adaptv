import { fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AdaptvImageAsset } from "#adaptv/components/image"
import {
  classifyImageSrc,
  Image,
  unstable_resetImageWarnings,
} from "#adaptv/components/image"

/*
 * The gate `docs/VISION.md` §2.1 asks for, written as a table: every form of
 * `<Image>` reserves a box, in every state, or it does not compile.
 *
 * happy-dom does no layout, so the reservation is asserted as the DECLARATION
 * that produces it (`aspect-ratio` in the root's inline style, which `mergeStyles`
 * puts in the `lockedStyle` tier) rather than as a measured rect. The pixel-level
 * "the rect is identical before and after load" assertion needs a real engine and
 * belongs on the playground — flagged in IMAGE-COMPONENT.md §10.2.
 */

//happy-dom reports every <img> as `complete` with `naturalWidth: 0`, which Image
//correctly reads as a load failure. Pin `complete` false so the element stays in
//the "loading" state the assertions are about.
function withPendingImages<T>(run: () => T): T {
  const spy = vi
    .spyOn(HTMLImageElement.prototype, "complete", "get")
    .mockReturnValue(false)
  try {
    return run()
  } finally {
    spy.mockRestore()
  }
}

const ASSET: AdaptvImageAsset = {
  src: "/assets/hero.a1b2c3.jpg",
  width: 1920,
  height: 1080,
  lqip: "data:image/webp;base64,UklGRg==",
}

function root(ui: React.ReactElement): HTMLElement {
  const { container } = render(ui)
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  unstable_resetImageWarnings()
  vi.restoreAllMocks()
})

describe("Image — the box is reserved in every admitted form", () => {
  it("reserves from a static import with no other props", () => {
    withPendingImages(() => {
      const el = root(<Image src={ASSET} alt="Hero" />)
      expect(el.style.aspectRatio).toBe("1920 / 1080")
      expect(el.hasAttribute("data-image-unreserved")).toBe(false)
    })
  })

  it("reserves from a width/height pair", () => {
    withPendingImages(() => {
      const el = root(
        <Image src="/a.png" alt="a" width={640} height={400} />,
      )
      expect(el.style.aspectRatio).toBe("640 / 400")
    })
  })

  it("reserves from aspectRatio — the remote-image case", () => {
    withPendingImages(() => {
      const el = root(<Image src="/a.png" alt="a" aspectRatio={16 / 9} />)
      //happy-dom normalises a bare ratio to `n / 1`; a browser keeps `n`. Either
      //way it is the same computed value, and the point is that it is DECLARED.
      expect(el.style.aspectRatio).toBe(`${16 / 9} / 1`)
    })
  })

  it("accepts the `w / h` longhand verbatim", () => {
    withPendingImages(() => {
      const el = root(<Image src="/a.png" alt="a" aspectRatio="16 / 9" />)
      expect(el.style.aspectRatio).toBe("16 / 9")
    })
  })

  it("aspectRatio wins over the pair — it is the prop you had to mean", () => {
    withPendingImages(() => {
      const el = root(
        <Image
          src="/a.png"
          alt="a"
          width={10}
          height={10}
          aspectRatio={2}
        />,
      )
      expect(el.style.aspectRatio).toBe("2 / 1")
    })
  })

  it("`fill` reserves nothing itself and says so, but is not `unreserved`", () => {
    withPendingImages(() => {
      const el = root(<Image src="/a.png" alt="a" fill />)
      expect(el.style.aspectRatio).toBe("")
      expect(el.className).toContain("absolute")
      expect(el.hasAttribute("data-image-unreserved")).toBe(false)
    })
  })

  it("reserves before any src exists — the box outlives the URL's absence", () => {
    const el = root(
      <Image src={null} alt="" width={64} height={64}>
        <Image.Invalid>no avatar</Image.Invalid>
      </Image>,
    )
    expect(el.style.aspectRatio).toBe("64 / 64")
  })

  it("keeps the box across every state the component has", () => {
    const { container, rerender } = withPendingImages(() =>
      render(
        <Image src="/a.png" alt="a" width={4} height={3}>
          <Image.Placeholder>loading</Image.Placeholder>
          <Image.Error>broken</Image.Error>
          <Image.Invalid>none</Image.Invalid>
        </Image>,
      ),
    )
    const el = container.firstElementChild as HTMLElement
    const ratios = new Set<string>([el.style.aspectRatio])

    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    ratios.add(el.style.aspectRatio)

    rerender(
      <Image src={null} alt="a" width={4} height={3}>
        <Image.Placeholder>loading</Image.Placeholder>
        <Image.Error>broken</Image.Error>
        <Image.Invalid>none</Image.Invalid>
      </Image>,
    )
    ratios.add(
      (container.firstElementChild as HTMLElement).style.aspectRatio,
    )

    expect([...ratios]).toEqual(["4 / 3"])
  })
})

describe("Image — the unreserved backstop", () => {
  //The types make this unrepresentable; the backstop is for the callers who got
  //past them (plain JS, an `as string`, a spread props object).
  const escaped = { src: "/a.png", alt: "a" } as React.ComponentProps<
    typeof Image
  >

  it("marks the root so an unreserved box is greppable in the DOM", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    withPendingImages(() => {
      const el = root(<Image {...escaped} />)
      expect(el.hasAttribute("data-image-unreserved")).toBe(true)
      expect(el.style.aspectRatio).toBe("")
    })
  })

  it("names all four ways out, once", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    withPendingImages(() => {
      render(<Image {...escaped} />)
      render(<Image {...escaped} />)
    })
    expect(spy).toHaveBeenCalledTimes(1)
    const message = String(spy.mock.calls[0]?.[0])
    expect(message).toContain("?adaptv-image")
    expect(message).toContain("width + height")
    expect(message).toContain("aspectRatio")
    expect(message).toContain("fill")
  })
})

describe("Image — the state machine", () => {
  it("starts in loading, with the placeholder slot showing", () => {
    withPendingImages(() => {
      const { container } = render(
        <Image src="/a.png" alt="a" aspectRatio={1}>
          <Image.Placeholder>wait</Image.Placeholder>
        </Image>,
      )
      const el = container.firstElementChild as HTMLElement
      expect(el.hasAttribute("data-image-loading")).toBe(true)
      expect(el.getAttribute("aria-busy")).toBe("true")
      const slot = container.querySelector("[data-part='placeholder']")
      expect(slot?.className).not.toContain("invisible")
    })
  })

  it("a load promotes to loaded and hides the placeholder", () => {
    const { container } = withPendingImages(() =>
      render(
        <Image src="/a.png" alt="a" aspectRatio={1}>
          <Image.Placeholder>wait</Image.Placeholder>
        </Image>,
      ),
    )
    fireEvent.load(container.querySelector("img") as HTMLImageElement)
    const el = container.firstElementChild as HTMLElement
    expect(el.hasAttribute("data-image-loaded")).toBe(true)
    expect(el.hasAttribute("data-image-loading")).toBe(false)
    expect(
      container.querySelector("[data-part='placeholder']")?.className,
    ).toContain("invisible")
  })

  it("a failed load goes to Error, not Invalid, and unmounts the <img>", () => {
    const { container } = withPendingImages(() =>
      render(
        <Image src="/a.png" alt="a" aspectRatio={1}>
          <Image.Error>broken</Image.Error>
          <Image.Invalid>none</Image.Invalid>
        </Image>,
      ),
    )
    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    const el = container.firstElementChild as HTMLElement
    expect(el.hasAttribute("data-image-error")).toBe(true)
    expect(el.hasAttribute("data-image-invalid")).toBe(false)
    expect(container.querySelector("img")).toBeNull()
    expect(
      container.querySelector("[data-part='error']")?.className,
    ).not.toContain("invisible")
  })

  it("no src goes to Invalid, not Error", () => {
    const { container } = render(
      <Image src={null} alt="a" aspectRatio={1}>
        <Image.Error>broken</Image.Error>
        <Image.Invalid>none</Image.Invalid>
      </Image>,
    )
    const el = container.firstElementChild as HTMLElement
    expect(el.hasAttribute("data-image-invalid")).toBe(true)
    expect(el.hasAttribute("data-image-error")).toBe(false)
    expect(container.querySelector("img")).toBeNull()
  })

  it("a non-image data: URL is Invalid — no request is attempted", () => {
    const { container } = render(
      <Image src="data:text/html,<b>x</b>" alt="a" aspectRatio={1} />,
    )
    expect(
      (container.firstElementChild as HTMLElement).hasAttribute(
        "data-image-invalid",
      ),
    ).toBe(true)
  })

  it("resets DURING the render that changes src, not a frame later", () => {
    //The bug this pins: with the reset in a layout effect, React commits the new
    //`src` while `loaded` is still true from the previous image, so for one paint
    //the component claims the NEW image is loaded and the placeholder is gone.
    const { container, rerender } = withPendingImages(() =>
      render(
        <Image src="/a.png" alt="a" aspectRatio={1}>
          <Image.Placeholder>wait</Image.Placeholder>
        </Image>,
      ),
    )
    fireEvent.load(container.querySelector("img") as HTMLImageElement)
    expect(
      (container.firstElementChild as HTMLElement).hasAttribute(
        "data-image-loaded",
      ),
    ).toBe(true)

    withPendingImages(() => {
      rerender(
        <Image src="/b.png" alt="a" aspectRatio={1}>
          <Image.Placeholder>wait</Image.Placeholder>
        </Image>,
      )
    })
    const el = container.firstElementChild as HTMLElement
    expect(el.hasAttribute("data-image-loading")).toBe(true)
    expect(el.hasAttribute("data-image-loaded")).toBe(false)
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/b.png",
    )
  })

  it("an errored image recovers when src changes", () => {
    const { container, rerender } = withPendingImages(() =>
      render(<Image src="/a.png" alt="a" aspectRatio={1} />),
    )
    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    expect(container.querySelector("img")).toBeNull()

    withPendingImages(() => {
      rerender(<Image src="/b.png" alt="a" aspectRatio={1} />)
    })
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/b.png",
    )
  })

  it("the box follows the asset when the asset changes — synchronously", () => {
    const portrait: AdaptvImageAsset = {
      src: "/p.jpg",
      width: 600,
      height: 900,
    }
    const { container, rerender } = render(<Image src={ASSET} alt="a" />)
    expect(
      (container.firstElementChild as HTMLElement).style.aspectRatio,
    ).toBe("1920 / 1080")
    rerender(<Image src={portrait} alt="a" />)
    expect(
      (container.firstElementChild as HTMLElement).style.aspectRatio,
    ).toBe("600 / 900")
  })
})

describe("Image — the <img> attributes", () => {
  it("never puts a placeholder in src (WebKit 237703)", () => {
    withPendingImages(() => {
      const { container } = render(<Image src={ASSET} alt="Hero" />)
      const img = container.querySelector("img") as HTMLImageElement
      expect(img.getAttribute("src")).toBe(ASSET.src)
      expect(img.getAttribute("src")).not.toContain("data:")
      //the LQIP lives on its own layer instead
      const layer = container.querySelector(
        "[data-part='lqip']",
      ) as HTMLElement
      expect(layer.style.backgroundImage).toContain("data:image/webp")
    })
  })

  it("emits width/height alongside the wrapper ratio, not instead of it", () => {
    withPendingImages(() => {
      const { container } = render(<Image src={ASSET} alt="Hero" />)
      const img = container.querySelector("img") as HTMLImageElement
      expect(img.getAttribute("width")).toBe("1920")
      expect(img.getAttribute("height")).toBe("1080")
    })
  })

  it("is lazy by default and eager+high under `priority`", () => {
    withPendingImages(() => {
      const lazy = render(<Image src={ASSET} alt="a" />)
      expect(
        lazy.container.querySelector("img")?.getAttribute("loading"),
      ).toBe("lazy")

      const eager = render(<Image src={ASSET} alt="a" priority />)
      const img = eager.container.querySelector("img") as HTMLImageElement
      expect(img.getAttribute("loading")).toBe("eager")
      expect(img.getAttribute("fetchpriority")).toBe("high")
    })
  })

  it("emits no `decoding` — it is a verified no-op in WebKit", () => {
    withPendingImages(() => {
      const { container } = render(<Image src={ASSET} alt="a" />)
      expect(
        container.querySelector("img")?.hasAttribute("decoding"),
      ).toBe(false)
    })
  })

  it("still lets a consumer pass `decoding` through", () => {
    withPendingImages(() => {
      const { container } = render(
        <Image src={ASSET} alt="a" decoding="sync" />,
      )
      expect(
        container.querySelector("img")?.getAttribute("decoding"),
      ).toBe("sync")
    })
  })

  it("hides the alt text until the image is actually showing", () => {
    withPendingImages(() => {
      const { container } = render(<Image src={ASSET} alt="Hero" />)
      const img = container.querySelector("img") as HTMLImageElement
      expect(img.getAttribute("alt")).toBe("")
      expect(img.getAttribute("aria-hidden")).toBe("true")
    })
    const { container } = withPendingImages(() =>
      render(<Image src={ASSET} alt="Hero" />),
    )
    fireEvent.load(container.querySelector("img") as HTMLImageElement)
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      "Hero",
    )
  })
})

describe("Image — fit and position are one pair on two elements", () => {
  it("keeps the placeholder's background in step with the <img>'s fit", () => {
    withPendingImages(() => {
      const { container } = render(
        <Image src={ASSET} alt="a" fit="contain" position="25% 75%" />,
      )
      const img = container.querySelector("img") as HTMLImageElement
      const layer = container.querySelector(
        "[data-part='lqip']",
      ) as HTMLElement
      expect(img.style.objectFit).toBe("contain")
      expect(layer.style.backgroundSize).toBe("contain")
      //the invariant is that the two AGREE, which is the whole reason `position`
      //is a prop rather than a class on the `<img>`
      expect(img.style.objectPosition).toBe("25% 75%")
      expect(layer.style.backgroundPosition).toBe("25% 75%")
    })
  })

  it("defaults to cover — the same default as React Native and expo-image", () => {
    withPendingImages(() => {
      const { container } = render(<Image src={ASSET} alt="a" />)
      expect(
        (container.querySelector("img") as HTMLImageElement).style
          .objectFit,
      ).toBe("cover")
      expect(
        (container.querySelector("[data-part='lqip']") as HTMLElement)
          .style.backgroundSize,
      ).toBe("cover")
    })
  })

  it("maps every fit onto a background-size", () => {
    const expected: Array<[string, string]> = [
      ["cover", "cover"],
      ["contain", "contain"],
      ["fill", "100% 100%"],
      ["none", "auto"],
      ["scale-down", "contain"],
    ]
    withPendingImages(() => {
      for (const [fit, size] of expected) {
        const { container } = render(
          <Image
            src={ASSET}
            alt="a"
            fit={
              fit as "cover" | "contain" | "fill" | "none" | "scale-down"
            }
          />,
        )
        expect(
          (container.querySelector("[data-part='lqip']") as HTMLElement)
            .style.backgroundSize,
        ).toBe(size)
      }
    })
  })
})

describe("Image — the placeholder prop", () => {
  it("`false` paints no LQIP layer at all", () => {
    withPendingImages(() => {
      const { container } = render(
        <Image src={ASSET} alt="a" placeholder={false} />,
      )
      expect(
        container.querySelector("[data-part='placeholder']"),
      ).toBeNull()
    })
  })

  it("a caller-supplied data URL replaces the build's", () => {
    withPendingImages(() => {
      const custom = "data:image/png;base64,iVBOR"
      const { container } = render(
        <Image src={ASSET} alt="a" placeholder={custom} />,
      )
      const layer = container.querySelector(
        "[data-part='lqip']",
      ) as HTMLElement
      expect(layer.style.backgroundImage).toContain(custom)
      expect(layer.style.backgroundImage).not.toContain("UklGRg==")
    })
  })

  it("rejects a BlurHash string in dev, naming the reason", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    withPendingImages(() => {
      render(
        <Image src={ASSET} alt="a" placeholder="LEHV6nWB2yk8pyo0adR*" />,
      )
    })
    expect(String(spy.mock.calls[0]?.[0])).toContain("data:image/*")
  })

  it("shows the neutral surface when there is nothing to paint", () => {
    withPendingImages(() => {
      const el = root(<Image src="/a.png" alt="a" aspectRatio={1} />)
      expect(el.className).toContain("bg-gray-50")
    })
  })
})

/* =============================================================================
 * THE COMPILE-LEVEL ASSERTION
 *
 * This is the real mechanism, and it is checked by `pnpm typecheck` rather than
 * by vitest — `src/**\/*.tsx` is in the tsconfig `include`, so a `@ts-expect-error`
 * that stops erroring FAILS the typecheck. `VISION.md` principle 1: the wrong
 * thing does not become a warning, it becomes impossible.
 * ============================================================================= */

const REMOTE: string = "/remote.png"

function UnreservableCalls() {
  return (
    <>
      {/* @ts-expect-error a string src with no reservation reserves no box */}
      <Image src={REMOTE} alt="a" />
      {/* @ts-expect-error width without height is only half a ratio */}
      <Image src={REMOTE} alt="a" width={640} />
      {/* @ts-expect-error no src and no reservation is not "an empty box" */}
      <Image alt="a" />
      {/* @ts-expect-error `fill` is opt-in; `false` reserves nothing */}
      <Image src={REMOTE} alt="a" fill={false} />
    </>
  )
}

function ReservableCalls() {
  return (
    <div className="relative h-40">
      <Image src={ASSET} alt="a" />
      <Image src={REMOTE} alt="a" width={640} height={400} />
      <Image src={REMOTE} alt="a" aspectRatio={16 / 9} />
      <Image src={REMOTE} alt="a" fill />
      <Image src={null} alt="a" width={64} height={64} />
    </div>
  )
}

describe("Image — the sizing union", () => {
  it("admits four forms, and every one of them reserves", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    withPendingImages(() => {
      const { container } = render(<ReservableCalls />)
      const roots = container.querySelectorAll("[data-adaptv='image']")
      expect(roots).toHaveLength(5)
      for (const el of roots) {
        expect(el.hasAttribute("data-image-unreserved")).toBe(false)
      }
    })
    //the rejected forms are asserted by the `@ts-expect-error` markers above,
    //which only `pnpm typecheck` can evaluate — this keeps the fixture reachable
    expect(UnreservableCalls).toBeTypeOf("function")
  })
})

describe("classifyImageSrc — three facts, no heuristic", () => {
  it("treats missing and whitespace-only as invalid", () => {
    expect(classifyImageSrc(undefined).invalid).toBe(true)
    expect(classifyImageSrc("   ").invalid).toBe(true)
  })

  it("rejects only NON-image data URLs", () => {
    expect(classifyImageSrc("data:text/html,x").invalid).toBe(true)
    expect(classifyImageSrc("data:image/webp;base64,AA").invalid).toBe(
      false,
    )
  })

  it("hands everything else to the network", () => {
    //the regex triple this replaced rejected the last of these and accepted the
    //two before it as if they were meaningful — wrong in both directions
    for (const src of [
      "not.a.url",
      "a/b",
      "?v=2",
      "//cdn/x.png",
      "x.png",
    ]) {
      expect(classifyImageSrc(src).invalid).toBe(false)
    }
  })
})
