import { useEffect, useMemo, useRef, useState } from "react"
import { EmojiSelector } from "@/components/decks/emoji-selector"
import {
  AppDrawer,
  DrawerActionFooter,
  drawerCancelClassName,
  PrimaryButton,
  TextInput,
} from "@/components/ui"
import {
  DECK_EMOJI_OPTIONS,
  DEFAULT_DECK_EMOJI,
} from "@/data/collections/decks/constants"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

export type DeckFormInput = {
  name: string
  emoji?: string
}

type DeckFormDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  submitLabel: string
  initialValue?: string
  initialEmoji?: string
  isSubmitting?: boolean
  errorMessage?: string
  onSubmit: (input: DeckFormInput) => void
}

export function DeckFormDrawer({
  open,
  onOpenChange,
  submitLabel,
  initialValue = "",
  initialEmoji,
  isSubmitting = false,
  errorMessage,
  onSubmit,
}: DeckFormDrawerProps) {
  const { vibrateCancel, vibrateSuccess } = useAppVibrate()
  const [value, setValue] = useState(initialValue)
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(
    initialEmoji ?? null,
  )

  const orderedEmojiOptions = useMemo(() => {
    const leadingEmoji = initialEmoji ?? DEFAULT_DECK_EMOJI
    const match = DECK_EMOJI_OPTIONS.find(
      (emoji) => emoji === leadingEmoji,
    )
    if (!match) return DECK_EMOJI_OPTIONS
    return [
      match,
      ...DECK_EMOJI_OPTIONS.filter((emoji) => emoji !== match),
    ]
  }, [initialEmoji])

  //seed the form only on the closed→open transition — a live prop change while
  //open would otherwise wipe in-progress input (matching todo-form-drawer)
  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setValue(initialValue)
      setSelectedEmoji(initialEmoji ?? null)
    }
    wasOpenRef.current = open
  }, [open, initialValue, initialEmoji])

  function handleSubmit() {
    const trimmed = value.trim()
    if (!trimmed || isSubmitting) return
    vibrateSuccess()
    onSubmit({ name: trimmed, emoji: selectedEmoji ?? undefined })
  }

  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="flex flex-col gap-y-5 pt-4">
            <div className="flex flex-col gap-y-2">
              <span className="ps-1 text-sm font-medium text-subtle">
                Name
              </span>
              <TextInput
                value={value}
                onChange={setValue}
                onSubmit={handleSubmit}
                placeholder="e.g. Groceries"
                aria-label="Deck name"
                disabled={isSubmitting}
                autoFocus
                fieldClassName="py-3.5 leading-none"
              />
            </div>
            <EmojiSelector
              options={orderedEmojiOptions}
              value={selectedEmoji}
              onChange={setSelectedEmoji}
            />

            {/* last in the scroll flow, not pinned — the actions follow the form down */}
            <DrawerActionFooter
              errorMessage={errorMessage}
              action={
                <PrimaryButton
                  className="w-full py-3.5 text-base font-semibold leading-none"
                  onClick={handleSubmit}
                  loading={isSubmitting}
                  disabled={!value.trim()}
                >
                  {submitLabel}
                </PrimaryButton>
              }
              cancel={
                <AppDrawer.Close
                  type="button"
                  onClick={vibrateCancel}
                  className={drawerCancelClassName}
                >
                  Cancel
                </AppDrawer.Close>
              }
            />
          </AppDrawer.Shell>
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
}
