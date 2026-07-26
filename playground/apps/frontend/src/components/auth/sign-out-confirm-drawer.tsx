import { AppDrawer, PrimaryButton, SecondaryButton } from "@/components/ui"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

type SignOutConfirmDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  unsyncedCount: number
  isSigningOut: boolean
  onConfirm: () => void
}

const CONTROL_CLASS = "w-full py-3.5 text-base font-semibold leading-none"

//shown only when there are unsynced local changes: signing out wipes this
//device's local store, so the user confirms the loss first.
export function SignOutConfirmDrawer({
  open,
  onOpenChange,
  unsyncedCount,
  isSigningOut,
  onConfirm,
}: SignOutConfirmDrawerProps) {
  const { vibrateOk, vibrateCancel } = useAppVibrate()
  const noun = unsyncedCount === 1 ? "change" : "changes"
  const verb = unsyncedCount === 1 ? "hasn't" : "haven't"
  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <AppDrawer.Shell className="pb-2">
            <AppDrawer.Title>Sign out?</AppDrawer.Title>
            <AppDrawer.Description className="mt-1">
              You have {unsyncedCount} unsynced {noun} that {verb} reached
              the server yet. Signing out clears this device's local data,
              so
              {unsyncedCount === 1 ? " it" : " they"} will be lost.
            </AppDrawer.Description>
            <div className="mt-5 flex flex-col gap-3">
              <PrimaryButton
                className={CONTROL_CLASS}
                onClick={() => {
                  vibrateOk()
                  onConfirm()
                }}
                loading={isSigningOut}
              >
                Sign out anyway
              </PrimaryButton>
              <SecondaryButton
                className={CONTROL_CLASS}
                onClick={() => {
                  vibrateCancel()
                  onOpenChange(false)
                }}
                disabled={isSigningOut}
              >
                Cancel
              </SecondaryButton>
            </div>
          </AppDrawer.Shell>
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
}
