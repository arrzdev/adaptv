import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import { LabLog, LabSection, labLogEntry } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { ReplyForm } from "@/components/landing/reply-form"
import { SaveButton } from "@/components/landing/save-button"
import { ShareButton } from "@/components/landing/share-button"

export const Route = createFileRoute("/_providers/lab/landing")({
  component: LabLandingPage,
})

/*
 * The website shows these three files as code (it imports them `?raw`) above a
 * recording of this page on a phone, so the code on the landing is the code that
 * ran. Edit a snippet here and the landing changes with it; keep each one at six
 * lines or fewer, and import only from the public `@arrzdev/adaptv/*` entries.
 */
const FILLER = ["one", "two", "three", "four", "five", "six", "seven"]

function LabLandingPage() {
  const [saves, setSaves] = useState<LabLogEntry[]>([])
  return (
    <LabPage
      title="Landing snippets"
      subtitle="The three snippets the website shows under “Native features from plain React”, running as written. Record the website's clips from this page."
    >
      <LabSection
        title="Haptics"
        description="Tap Save. The phone gives a firm tap and the log below gains a line, which is what the recording shows."
      >
        <SaveButton
          save={() => setSaves((log) => [labLogEntry("saved"), ...log])}
        />
        <LabLog entries={saves} />
      </LabSection>
      <LabSection
        title="Share"
        description="Tap Share. The OS share sheet opens with this page's address."
      >
        <ShareButton url="https://adaptv.tudu.dev" />
      </LabSection>
      <LabSection
        title="Keyboard"
        description="Scroll down and tap the Reply field. It stays above the keyboard."
      >
        {FILLER.map((word) => (
          <p
            key={word}
            className="rounded-md bg-secondary px-3 py-6 text-sm text-muted"
          >
            Message {word}
          </p>
        ))}
        <ReplyForm />
      </LabSection>
    </LabPage>
  )
}
