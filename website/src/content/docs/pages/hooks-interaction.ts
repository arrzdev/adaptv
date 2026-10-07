import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-interaction",
  title: "Interaction hooks",
  summary:
    "Open the mail and SMS composers, show and schedule notifications, print, speak text aloud and hide the app from screenshots.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useCompose, useNotifications, useNotificationOpened, usePrint, useSpeech, usePrivacyScreen } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "p",
      text: "These hooks start something outside the page: another app, the OS or the user's attention. Each call resolves an outcome and never rejects. Check the outcome, because a call that did nothing looks the same as one that worked. Outside a component, use the matching function from [capabilities](/docs/capabilities). Call them from a click or a tap.",
    },

    { type: "h2", text: "useCompose" },
    {
      type: "api",
      name: "useCompose()",
      signature: "function useCompose(): UseComposeResult",
      description:
        "Open the OS mail or SMS composer with a draft. The hook builds a `mailto:` or `sms:` URL and hands it to the OS.",
      returns: "`{ mail, sms, composeMail, composeSms, last, lastUrl }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "mail",
          type: "ComposeSupport | null",
          description:
            '`null` while the probe runs. `"available"`, `"no-handler"` or `"unknown"`.',
        },
        {
          name: "sms",
          type: "ComposeSupport | null",
          description: "Same as `mail`, for SMS.",
        },
        {
          name: "composeMail",
          type: "(draft: MailDraft) => Promise<ComposeOutcome>",
          description: "Open the mail composer.",
        },
        {
          name: "composeSms",
          type: "(draft: SmsDraft) => Promise<ComposeOutcome>",
          description: "Open the SMS composer.",
        },
        {
          name: "last",
          type: "ComposeOutcome | null",
          description:
            "Outcome of the latest compose. `null` before the first.",
        },
        {
          name: "lastUrl",
          type: "string | null",
          description: "The URL the latest compose built.",
        },
      ],
    },
    { type: "h3", text: "MailDraft and SmsDraft" },
    {
      type: "props",
      rows: [
        {
          name: "to",
          type: "readonly string[]",
          description: "Recipients. Both drafts.",
        },
        {
          name: "cc, bcc",
          type: "readonly string[]",
          description: "Mail only.",
        },
        { name: "subject", type: "string", description: "Mail only." },
        { name: "body", type: "string", description: "Both drafts." },
      ],
    },
    {
      type: "table",
      head: ["Value", "Meaning"],
      rows: [
        [
          '`mail` / `sms`: `"available"`',
          "The OS reports a handler for the scheme.",
        ],
        [
          '`mail` / `sms`: `"no-handler"`',
          "The OS reports none. Say so on the button.",
        ],
        [
          '`mail` / `sms`: `"unknown"`',
          "Nothing can be asked: the web, or a binary built without the plugin.",
        ],
        ['`"opened"`', "The composer got the draft."],
        ['`"no-handler"`', "The OS reported that nothing took the draft."],
        ['`"failed"`', "The open rejected, or there is no window."],
      ],
    },
    {
      type: "code",
      label: "contact.tsx",
      lang: "tsx",
      code: `const { mail, composeMail, last } = useCompose()

<Button
  disabled={mail === "no-handler"}
  onClick={() =>
    composeMail({
      to: ["help@example.com"],
      subject: "Order 1042",
      body: "Hi,",
    })
  }
>
  Email support
</Button>
{last === "no-handler" && <Text>No mail app is set up.</Text>}`,
    },
    {
      type: "p",
      text: 'The support value labels a button. It does not gate the call. On the web the draft opens with `window.open(url, "_self")` and the outcome is `"opened"`, because the browser does not say whether a mail app took it. The URL builders `mailUrl(draft)` and `smsUrl(draft)` are public too. The SMS body separator is `&` on iOS and `?` elsewhere. Spaces in SMS numbers are dropped.',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Opens the `mailto:` or `sms:` URL in the page. Support is `"unknown"`.',
        },
        { target: "Mobile web", status: "partial", note: "Same as desktop." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as desktop.",
        },
        {
          target: "iOS",
          status: "yes",
          note: 'Support is probed. The simulator has no Mail, so `mail` reads `"no-handler"` there.',
        },
        {
          target: "Android",
          status: "yes",
          note: "Support is probed. The native shell declares `mailto` and `sms` so Android 11+ can see the handlers.",
        },
      ],
    },

    { type: "h2", text: "useNotifications" },
    {
      type: "api",
      name: "useNotifications()",
      signature: "function useNotifications(): UseNotificationsResult",
      description:
        "Local notifications: ask for permission, show one now, schedule one for later and cancel. The permission is read after mount, so the server and the first render show `null`.",
      returns:
        "`{ permission, caveat, pending, request, notify, schedule, cancel, refresh }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "permission",
          type: "NotifyPermission | null",
          description:
            '`null` until the first read. Then `"granted"`, `"denied"`, `"prompt"` or `"unavailable"`. `"unavailable"` means a prompt will not help.',
        },
        {
          name: "caveat",
          type: "string | null",
          description: "What is withheld even when granted, or `null`.",
        },
        {
          name: "pending",
          type: "ScheduledNotification[]",
          description:
            "Notifications the OS still holds, as `{ id, title, body, at }`. Refreshed after each call that changes them. Always empty on the web.",
        },
        {
          name: "request",
          type: "() => Promise<NotifyPermission>",
          description: "Ask the user. Resolves the state afterwards.",
        },
        {
          name: "notify",
          type: "(options: NotifyOptions) => Promise<NotifyOutcome>",
          description: "Show one now.",
        },
        {
          name: "schedule",
          type: "(options: ScheduleOptions) => Promise<ScheduleOutcome>",
          description: "Ask the OS to show one later.",
        },
        {
          name: "cancel",
          type: "(id: number) => Promise<void>",
          description:
            "Native: cancel the alarm. Web: close a banner that is still on screen.",
        },
        {
          name: "refresh",
          type: "() => Promise<void>",
          description: "Re-read `pending`.",
        },
      ],
    },
    { type: "h3", text: "NotifyOptions and ScheduleOptions" },
    {
      type: "props",
      rows: [
        {
          name: "title",
          type: "string",
          required: true,
          description: "The heading.",
        },
        {
          name: "body",
          type: "string",
          required: true,
          description: "The text.",
        },
        {
          name: "id",
          type: "number",
          description:
            "A stable id so `cancel` can name it. Default: a fresh random one.",
        },
        {
          name: "data",
          type: "Record<string, string>",
          description:
            "Handed back when the notification is tapped. Strings only.",
        },
        {
          name: "at",
          type: "Date",
          required: true,
          description:
            "`schedule` only. When it fires. A time in the past fires at once.",
        },
      ],
    },
    {
      type: "table",
      head: ["Call", "Outcomes"],
      rows: [
        [
          "`notify`",
          '`"shown"`, `"prompt"` (never asked, call `request`), `"denied"` (only settings can help), `"unavailable"`.',
        ],
        [
          "`schedule`",
          '`"scheduled"`, `"prompt"`, `"denied"`, `"unsupported"` (the target cannot schedule).',
        ],
      ],
    },
    {
      type: "code",
      label: "reminder.tsx",
      lang: "tsx",
      code: `const { permission, request, schedule } = useNotifications()

async function remindTomorrow() {
  if (permission !== "granted" && (await request()) !== "granted") return
  const at = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await schedule({
    title: "Order shipped",
    body: "Track order 1042",
    at,
    data: { route: "/orders/1042" },
  })
}`,
    },
    {
      type: "note",
      tone: "info",
      text: 'A browser cannot schedule a notification. `schedule` resolves `"unsupported"` there instead of starting a timer that works only while the page is open. On the web, `notify` goes through the app\'s own service worker, and `permission` reads `"unavailable"` until one is registered. On Android a scheduled notification is inexact and can arrive late while the device dozes. Read `caveat` for the sentence for the current target.',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`notify` works through the service worker. No scheduling.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop. On iOS a browser tab cannot show one. Install the page to the home screen first.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "`notify` works. No scheduling.",
        },
        { target: "iOS", status: "yes" },
        {
          target: "Android",
          status: "partial",
          note: "Scheduled notifications can arrive a little late.",
        },
      ],
    },

    { type: "h2", text: "useNotificationOpened" },
    {
      type: "api",
      name: "useNotificationOpened()",
      signature:
        "function useNotificationOpened(handler: (opened: OpenedNotification) => void): void",
      description:
        "Run a function when the user taps a notification. It is a handler, not state, so a tap does not run again on every later render. The latest handler is always used, so an inline function does not resubscribe.",
      params: [
        {
          name: "handler",
          type: "(opened: OpenedNotification) => void",
          required: true,
          description:
            "Called with `{ id, data }`. `data` is what `notify` or `schedule` was given, or `{}`.",
        },
      ],
    },
    {
      type: "code",
      label: "app.tsx",
      lang: "tsx",
      code: `useNotificationOpened(({ data }) => {
  if (data.route) navigate({ to: data.route })
})`,
    },
    {
      type: "p",
      text: "On the web the tap can arrive when no page was open. It is what started the app, and the hook asks the service worker for the held tap when it mounts. Mount it once, high in the tree. Outside React, use `onNotificationOpened(handler)`, which returns an unsubscribe. A target that cannot deliver a tap never calls back.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Through the service worker.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Through the service worker.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Through the service worker.",
        },
        { target: "iOS", status: "yes", note: "Through the native bridge." },
        {
          target: "Android",
          status: "yes",
          note: "Through the native bridge.",
        },
      ],
    },

    { type: "h2", text: "usePrint" },
    {
      type: "api",
      name: "usePrint()",
      signature: "function usePrint(): UsePrintResult",
      description:
        'Open the browser print dialog for the current page. `status` is `"unsupported"` on the server, so a print button can hide itself.',
      returns: "`{ status, printing, last, print }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "status",
          type: '"available" | "unsupported"',
          description:
            '`"unsupported"` when there is no `window.print` and in a native app, whose WebView swallows it.',
        },
        {
          name: "printing",
          type: "boolean",
          description: "`true` between the call and its outcome.",
        },
        {
          name: "last",
          type: "PrintOutcome | null",
          description: "Outcome of the latest print.",
        },
        {
          name: "print",
          type: "(options?: PrintOptions) => Promise<PrintOutcome>",
          description:
            "Open the dialog. A second call while one is open shares its outcome.",
        },
      ],
    },
    {
      type: "table",
      head: ["Option or outcome", "Meaning"],
      rows: [
        [
          "`silentAfterMs`",
          "Option. How long to wait for `beforeprint` before the call counts as silent. Default 1500.",
        ],
        [
          '`"opened"`',
          "The dialog opened and closed. The web cannot say whether the user printed or cancelled.",
        ],
        ['`"silent"`', "The call returned and no print event followed."],
        ['`"unsupported"`', "Nothing was called."],
        ['`"failed"`', "`window.print()` threw."],
      ],
    },
    {
      type: "code",
      label: "receipt.tsx",
      lang: "tsx",
      code: `const { status, printing, print } = usePrint()

if (status !== "available") return null
return (
  <Button disabled={printing} onClick={() => print()}>
    Print receipt
  </Button>
)`,
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes" },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "no", note: 'Resolves `"unsupported"`.' },
        { target: "Android", status: "no", note: 'Resolves `"unsupported"`.' },
      ],
    },

    { type: "h2", text: "useSpeech" },
    {
      type: "api",
      name: "useSpeech()",
      signature: "function useSpeech(): UseSpeechResult",
      description:
        "Text to speech with the engine's `speechSynthesis`. It speaks to every user, whether or not they use a screen reader. To reach a screen reader, use `announce` from [useScreenReader](/docs/hooks-system).",
      returns: "`{ status, voices, speaking, last, reason, speak, stop }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "status",
          type: '"unsupported" | "loading" | "ready" | "no-voices"',
          description:
            '`"loading"` is Chromium before its voice list arrives. The hook re-renders on its own when it does. `"unsupported"` on the server.',
        },
        {
          name: "voices",
          type: "readonly SpeechVoice[]",
          description:
            "`{ id, name, lang, isDefault, isLocal }`. `id` is stable for the session, not across engines.",
        },
        {
          name: "speaking",
          type: "boolean",
          description: "An utterance started and has not ended.",
        },
        {
          name: "last",
          type: "SpeechOutcome | null",
          description: "Outcome of the latest `speak`.",
        },
        {
          name: "reason",
          type: "string | null",
          description: 'The engine\'s error code when `last` is `"failed"`.',
        },
        {
          name: "speak",
          type: "(text: string, options?: SpeakOptions) => Promise<SpeechOutcome>",
          description:
            "Speak. Resolves when the utterance ends. A call made while another speaks waits its turn.",
        },
        {
          name: "stop",
          type: "() => void",
          description: "Stop everything spoken and queued.",
        },
      ],
    },
    { type: "h3", text: "SpeakOptions" },
    {
      type: "props",
      rows: [
        {
          name: "voiceId",
          type: "string",
          description:
            "A `SpeechVoice` id. The engine's default when omitted or unknown.",
        },
        {
          name: "lang",
          type: "string",
          description: "A BCP 47 tag, used when no voice is named.",
        },
        {
          name: "rate",
          type: "number",
          description: "0.1 to 10. The engine clamps it.",
        },
        { name: "pitch", type: "number", description: "0 to 2." },
        { name: "volume", type: "number", description: "0 to 1." },
        {
          name: "silentAfterMs",
          type: "number",
          default: "2000",
          description: "How long to wait for the engine to start.",
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"spoke"`', "The engine started and ended."],
        [
          '`"cancelled"`',
          "`stop`, or a newer utterance interrupted it. `stop` cancels every queued utterance too.",
        ],
        [
          '`"silent"`',
          "The engine did not start within the window. The API exists and did nothing.",
        ],
        ['`"failed"`', "The engine reported an error. See `reason`."],
      ],
    },
    {
      type: "code",
      label: "read-aloud.tsx",
      lang: "tsx",
      code: `const { status, speaking, speak, stop } = useSpeech()

if (status === "unsupported" || status === "no-voices") return null
return (
  <Button onClick={() => (speaking ? stop() : speak(article.text, { lang: "en-GB" }))}>
    {speaking ? "Stop" : "Read aloud"}
  </Button>
)`,
    },
    {
      type: "p",
      text: "Outside React, use `speak(text, options)`, which returns `{ done, reason, cancel }`, plus `stopSpeech()`, `getSpeechStatus()`, `getVoices()`, `listVoices()`, `isSpeaking()` and `subscribeSpeech(cb)`.",
    },
    {
      type: "note",
      tone: "info",
      text: "Speech runs on the browser or WebView engine's own `speechSynthesis`, with no native plugin. It works wherever that engine has it and has voices. Check `status` before you offer it.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Where the browser has `speechSynthesis` and voices.",
        },
        { target: "Mobile web", status: "partial", note: "Same as desktop." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as desktop.",
        },
        {
          target: "iOS",
          status: "partial",
          note: "Where the WebView has `speechSynthesis`.",
        },
        {
          target: "Android",
          status: "partial",
          note: "Where the WebView has `speechSynthesis`.",
        },
      ],
    },

    { type: "h2", text: "usePrivacyScreen" },
    {
      type: "api",
      name: "usePrivacyScreen()",
      signature: "function usePrivacyScreen(): UsePrivacyScreenResult",
      description:
        "Native only. Cover the app when it goes to the app switcher and, on Android, block screenshots and recordings. Use it for a screen with a balance, a code or a message. The state is read after mount, so the server and the first render show `null`.",
      returns: "`{ support, enabled, caveat, enable, disable, last }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "support",
          type: '"available" | "unsupported" | null',
          description:
            '`"available"` when this binary carries the plugin. `null` until the client has read it.',
        },
        {
          name: "enabled",
          type: "boolean | null",
          description:
            "Whether it is on, as the OS last said. `null` where nothing can be asked.",
        },
        {
          name: "caveat",
          type: "string",
          description:
            'One sentence on what "enabled" means on this target. Empty until `support` is known.',
        },
        {
          name: "enable",
          type: "(options?: PrivacyScreenOptions) => Promise<PrivacyScreenOutcome>",
          description: "Turn it on.",
        },
        {
          name: "disable",
          type: "() => Promise<PrivacyScreenOutcome>",
          description: "Turn it off.",
        },
        {
          name: "last",
          type: "PrivacyScreenOutcome | null",
          description: "Outcome of the latest `enable` or `disable`.",
        },
      ],
    },
    { type: "h3", text: "PrivacyScreenOptions" },
    {
      type: "props",
      rows: [
        {
          name: "cover",
          type: '"splash" | "obscure"',
          default: '"splash"',
          description:
            '`"splash"` shows the launch screen: on iOS a flat fill of the splash colour with no image. `"obscure"` blurs the app on iOS and dims it on Android.',
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"applied"`', "The OS took the change."],
        [
          '`"unsupported"`',
          "The web, a PWA, the server, or a binary built before the plugin.",
        ],
        ['`"failed"`', "The plugin reported no success, or rejected."],
      ],
    },
    {
      type: "code",
      label: "recovery-code.tsx",
      lang: "tsx",
      code: `const { enable, disable } = usePrivacyScreen()

useEffect(() => {
  void enable({ cover: "obscure" })
  return () => {
    void disable()
  }
}, [enable, disable])`,
    },
    {
      type: "note",
      tone: "warn",
      text: "The guarantee differs by OS. Android sets `FLAG_SECURE`: screenshots and recordings come back black. iOS covers the app in the switcher and under system overlays but cannot block a screenshot. A screenshot taken while the app is in front captures it. No browser can keep a page out of a screenshot. Show `caveat` next to any switch you offer.",
    },
    {
      type: "p",
      text: "Outside React, use `enablePrivacyScreen(options)`, `disablePrivacyScreen()`, `readPrivacyScreen()`, `getPrivacyScreenSupport()` and `getPrivacyScreenCaveat()`.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: 'Resolves `"unsupported"`.',
        },
        {
          target: "Mobile web",
          status: "no",
          note: 'Resolves `"unsupported"`.',
        },
        {
          target: "Installed PWA",
          status: "no",
          note: 'Resolves `"unsupported"`.',
        },
        {
          target: "iOS",
          status: "partial",
          note: "Covers the app switcher. Does not block screenshots.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Blocks screenshots and recordings.",
        },
      ],
    },
  ],
}
