import { useCallback, useEffect, useState } from "react"
import type {
  ComposeOutcome,
  ComposeSupport,
  MailDraft,
  SmsDraft,
} from "#adaptv/capabilities/compose"
import {
  composeMail as composeMailNow,
  composeSms as composeSmsNow,
  getComposeSupport,
  mailUrl,
  smsUrl,
} from "#adaptv/capabilities/compose"

export type UseComposeResult = {
  /** Whether the OS has a mail handler; `null` while the probe runs. */
  mail: ComposeSupport | null
  /** Whether the OS has an SMS handler; `null` while the probe runs. */
  sms: ComposeSupport | null
  /** Open the mail composer. Resolves the outcome; never rejects. */
  composeMail: (draft: MailDraft) => Promise<ComposeOutcome>
  /** Open the SMS composer. Resolves the outcome; never rejects. */
  composeSms: (draft: SmsDraft) => Promise<ComposeOutcome>
  /** Outcome of the most recent compose, or `null` before the first. */
  last: ComposeOutcome | null
  /** The URL the most recent compose built, or `null` before the first. */
  lastUrl: string | null
}

/**
 * The OS composer, as a hook. `mail` and `sms` are probed once on mount and
 * read `null` until the OS has answered, so a button can be disabled rather
 * than rendered as working; `last` and `lastUrl` are what the button should
 * show afterwards, because an open that resolved `"no-handler"` looks exactly
 * like one that worked unless something says so.
 */
export function useCompose(): UseComposeResult {
  const [mail, setMail] = useState<ComposeSupport | null>(null)
  const [sms, setSms] = useState<ComposeSupport | null>(null)
  const [last, setLast] = useState<ComposeOutcome | null>(null)
  const [lastUrl, setLastUrl] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getComposeSupport("mail").then((s) => {
      if (live) setMail(s)
    })
    void getComposeSupport("sms").then((s) => {
      if (live) setSms(s)
    })
    return () => {
      live = false
    }
  }, [])

  const composeMail = useCallback(async (draft: MailDraft) => {
    setLastUrl(mailUrl(draft))
    const outcome = await composeMailNow(draft)
    setLast(outcome)
    return outcome
  }, [])

  const composeSms = useCallback(async (draft: SmsDraft) => {
    setLastUrl(smsUrl(draft))
    const outcome = await composeSmsNow(draft)
    setLast(outcome)
    return outcome
  }, [])

  return { mail, sms, composeMail, composeSms, last, lastUrl }
}
