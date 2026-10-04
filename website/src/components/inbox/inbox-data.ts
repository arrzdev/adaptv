import { useCallback, useState } from "react"

export type Message = {
  id: string
  from: string
  subject: string
  preview: string
  time: string
  /** Two stops of the avatar's gradient. */
  hue: [string, string]
  unread?: boolean
}

const SEED: Message[] = [
  {
    id: "m1",
    from: "Inês Duarte",
    subject: "Build 1.4 is on TestFlight",
    preview:
      "Pushed it ten minutes ago. The sheet finally tracks the keyboard on the way up.",
    time: "9:41",
    hue: ["#8b95ff", "#c08bff"],
    unread: true,
  },
  {
    id: "m2",
    from: "Rui Matos",
    subject: "Can we ship the web version first?",
    preview:
      "Same codebase, so yes. Deploy is already green — the stores can follow on Thursday.",
    time: "9:12",
    hue: ["#ff8fb4", "#ffb86a"],
    unread: true,
  },
  {
    id: "m3",
    from: "App Review",
    subject: "Your submission is ready for sale",
    preview:
      "Version 1.3.2 has been approved and is now available on the App Store.",
    time: "Yesterday",
    hue: ["#4fdca0", "#38b6ff"],
  },
  {
    id: "m4",
    from: "Sofia Lima",
    subject: "Dark mode splash is fixed",
    preview:
      "No more white flash between the launch screen and the first paint. Looks native.",
    time: "Yesterday",
    hue: ["#ffb86a", "#ff6a9a"],
  },
  {
    id: "m5",
    from: "Tomás Reis",
    subject: "Offline mode demo for the client",
    preview:
      "Turned on airplane mode in the meeting and the app just kept going. They noticed.",
    time: "Mon",
    hue: ["#38b6ff", "#8b95ff"],
  },
  {
    id: "m6",
    from: "Google Play Console",
    subject: "Release 1.3.2 rolled out to 100%",
    preview: "Your production release has completed its staged rollout.",
    time: "Mon",
    hue: ["#c08bff", "#ff8fb4"],
  },
  {
    id: "m7",
    from: "Marta Pires",
    subject: "Swipe to archive feels right now",
    preview:
      "Whatever you changed about the spring, keep it. It stops exactly where my thumb does.",
    time: "Sun",
    hue: ["#4fdca0", "#ffb86a"],
  },
]

const INCOMING: Omit<Message, "id" | "time">[] = [
  {
    from: "Inês Duarte",
    subject: "You pulled to refresh",
    preview:
      "That gesture only arms at the very top of the list, and never fights the scroll.",
    hue: ["#8b95ff", "#c08bff"],
    unread: true,
  },
  {
    from: "Rui Matos",
    subject: "Try it in the other window",
    preview:
      "The phone and the browser are the same components reading the same state.",
    hue: ["#ff8fb4", "#ffb86a"],
    unread: true,
  },
]

/** One inbox, read by every frame on the stage — archive it on the phone, it leaves the desktop. */
export function useInbox() {
  const [messages, setMessages] = useState(SEED)
  const [selectedId, setSelectedId] = useState(SEED[0].id)
  const [arrivals, setArrivals] = useState(0)

  const archive = useCallback((id: string) => {
    setMessages((list) => list.filter((message) => message.id !== id))
  }, [])

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setMessages((list) =>
      list.map((message) =>
        message.id === id ? { ...message, unread: false } : message,
      ),
    )
  }, [])

  const refresh = useCallback(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900))
    setArrivals((count) => {
      const next = INCOMING[count % INCOMING.length]
      setMessages((list) => [
        { ...next, id: `new-${count}`, time: "now" },
        ...list.filter((message) => message.id !== `new-${count}`),
      ])
      return count + 1
    })
  }, [])

  const reset = useCallback(() => {
    setMessages(SEED)
    setSelectedId(SEED[0].id)
  }, [])

  const selected =
    messages.find((message) => message.id === selectedId) ?? messages[0]

  return { messages, selected, select, archive, refresh, reset, arrivals }
}

export type Inbox = ReturnType<typeof useInbox>
