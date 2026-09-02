import { AppLauncher } from "@capacitor/app-launcher"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  composeMail,
  composeSms,
  getComposeSupport,
  mailUrl,
  smsUrl,
} from "#adaptv/capabilities/compose"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

vi.mock("@capacitor/app-launcher", () => ({
  AppLauncher: {
    canOpenUrl: vi.fn(async () => ({ value: true })),
    openUrl: vi.fn(async () => ({ completed: true })),
  },
}))

vi.mock("#adaptv/utils/platform", () => ({
  isIOS: vi.fn(() => false),
  isNativePlatform: vi.fn(() => false),
}))

vi.mock("#adaptv/utils/native-plugins", () => ({
  hasNativePlugin: vi.fn(() => true),
}))

const opened: Array<[string, string | undefined]> = []

beforeEach(() => {
  vi.mocked(isIOS).mockReturnValue(false)
  vi.mocked(isNativePlatform).mockReturnValue(false)
  vi.mocked(hasNativePlugin).mockReturnValue(true)
  vi.mocked(AppLauncher.canOpenUrl).mockResolvedValue({ value: true })
  vi.mocked(AppLauncher.openUrl).mockResolvedValue({ completed: true })
  opened.length = 0
  vi.stubGlobal("open", (url: string, target?: string) => {
    opened.push([url, target])
    return null
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("compose — the URLs", () => {
  it("builds a mailto with every field encoded and joined", () => {
    expect(
      mailUrl({
        to: ["a@b.c", "d@e.f"],
        cc: ["g@h.i"],
        bcc: ["j@k.l"],
        subject: "Hello there & more",
        body: "line 1\nline 2",
      }),
    ).toBe(
      "mailto:a@b.c,d@e.f?cc=g%40h.i&bcc=j%40k.l&subject=Hello%20there%20%26%20more&body=line%201%0Aline%202",
    )
  })

  it("leaves out what the draft did not set", () => {
    expect(mailUrl({})).toBe("mailto:")
    expect(mailUrl({ to: ["a@b.c"], subject: "" })).toBe("mailto:a@b.c")
    expect(mailUrl({ body: "hi" })).toBe("mailto:?body=hi")
  })

  it("puts the SMS body after ? off iOS and after & on iOS", () => {
    expect(smsUrl({ to: ["+15550001"], body: "hi there" })).toBe(
      "sms:+15550001?body=hi%20there",
    )
    vi.mocked(isIOS).mockReturnValue(true)
    expect(smsUrl({ to: ["+15550001", "+15550002"], body: "hi" })).toBe(
      "sms:+15550001,+15550002&body=hi",
    )
    expect(smsUrl({})).toBe("sms:")
  })
})

describe("compose — support", () => {
  it("is unknown on the web, without asking the plugin", async () => {
    expect(await getComposeSupport("mail")).toBe("unknown")
    expect(AppLauncher.canOpenUrl).not.toHaveBeenCalled()
  })

  it("is unknown on a binary without the plugin", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(hasNativePlugin).mockReturnValue(false)
    expect(await getComposeSupport("sms")).toBe("unknown")
    expect(AppLauncher.canOpenUrl).not.toHaveBeenCalled()
  })

  it("asks the OS with a full URL and reads its answer", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    expect(await getComposeSupport("mail")).toBe("available")
    expect(AppLauncher.canOpenUrl).toHaveBeenCalledWith({
      url: "mailto:probe@example.com",
    })
    vi.mocked(AppLauncher.canOpenUrl).mockResolvedValue({ value: false })
    expect(await getComposeSupport("sms")).toBe("no-handler")
    expect(AppLauncher.canOpenUrl).toHaveBeenLastCalledWith({
      url: "sms:0",
    })
  })

  it("is unknown when the bridge rejects", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(AppLauncher.canOpenUrl).mockRejectedValue(
      new Error("no bridge"),
    )
    expect(await getComposeSupport("mail")).toBe("unknown")
  })
})

describe("compose — opening", () => {
  it("on the web hands the URL to the same tab", async () => {
    expect(
      await composeMail({ to: ["a@b.c"], subject: "Hi", body: "x y" }),
    ).toBe("opened")
    expect(opened).toEqual([
      ["mailto:a@b.c?subject=Hi&body=x%20y", "_self"],
    ])
    expect(await composeSms({ to: ["1"], body: "z" })).toBe("opened")
    expect(opened[1]).toEqual(["sms:1?body=z", "_self"])
  })

  it("on native opens through the launcher without asking first", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(AppLauncher.canOpenUrl).mockResolvedValue({ value: false })
    expect(await composeSms({ to: ["+15550001"], body: "hi" })).toBe(
      "opened",
    )
    expect(AppLauncher.canOpenUrl).not.toHaveBeenCalled()
    expect(AppLauncher.openUrl).toHaveBeenCalledWith({
      url: "sms:+15550001?body=hi",
    })
    expect(opened).toEqual([])
  })

  it("reads an open that found nothing as no-handler, and a rejection as failed", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(AppLauncher.openUrl).mockResolvedValue({ completed: false })
    expect(await composeMail({ to: ["a@b.c"] })).toBe("no-handler")
    vi.mocked(AppLauncher.openUrl).mockRejectedValue(new Error("boom"))
    expect(await composeMail({ to: ["a@b.c"] })).toBe("failed")
  })

  it("on a binary without the plugin uses the WebView's own navigation", async () => {
    vi.mocked(isNativePlatform).mockReturnValue(true)
    vi.mocked(hasNativePlugin).mockReturnValue(false)
    expect(await composeMail({ to: ["a@b.c"] })).toBe("opened")
    expect(opened).toEqual([["mailto:a@b.c", "_self"]])
  })
})
