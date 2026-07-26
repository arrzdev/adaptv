import tryCatch from "@repo/shared/try-catch"
import { CloudUpload } from "lucide-react"
import { useState } from "react"
import { SignOutConfirmDrawer } from "@/components/auth/sign-out-confirm-drawer"
import { PrimaryButton, SecondaryButton } from "@/components/ui"
import { signOut } from "@/data/auth/client"
import { seedInitialDataIfEmpty } from "@/data/seed"
import { resetLocalStore } from "@/data/store"
import { pendingChangeCount, setSyncEnabled } from "@/data/sync/controller"
import { useAppVibrate } from "@/hooks/use-app-vibrate"
import { useAuth } from "@/providers/auth-provider"

//account surface in settings: a single row — identity on the left, a pill action
//on the right. guests see "Not signed in" + a "Sign in" button; signed-in users
//see their name/email + "Sign out". signing out wipes the local store in place
//(no reload) so the next session starts as a clean guest — their data is on the
//server and re-pulls on next sign-in. if there are UNSYNCED changes we confirm
//first, since the wipe would lose them.
export function SettingsAccountCard() {
  const { user, isAuthenticated, isPending, openLogin } = useAuth()
  const { vibrateOk } = useAppVibrate()
  const [signingOut, setSigningOut] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [unsyncedCount, setUnsyncedCount] = useState(0)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  async function handleSignOutClick() {
    const pending = await pendingChangeCount()
    if (pending > 0) {
      setUnsyncedCount(pending)
      setConfirmOpen(true)
      return
    }
    await doSignOut()
  }

  async function doSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    const [, signOutFailure] = await tryCatch(async () => {
      setSyncEnabled(false) //stop syncing before the wipe
      await signOut() //clear the session + local bearer token
      await resetLocalStore() //wipe local data in place — reactive, no reload
      await seedInitialDataIfEmpty() //restore the guest tutorial deck
    })
    //reset on BOTH paths — leaving signingOut stuck freezes the spinner and makes
    //the confirm drawer undismissable (onOpenChange refuses while signingOut)
    setSigningOut(false)
    if (signOutFailure) {
      setSignOutError("Could not sign out. Try again.")
      return
    }
    setConfirmOpen(false)
  }

  return (
    <section
      aria-labelledby="settings-account-heading"
      className="rounded-md bg-surface px-4 py-4"
    >
      <div className="flex items-center gap-x-4">
        <div className="flex min-w-0 flex-1 flex-col gap-y-0.5">
          {isAuthenticated && (
            <>
              <h2
                id="settings-account-heading"
                className="truncate text-lg font-semibold text-foreground"
              >
                {user?.name || "Signed in"}
              </h2>
              <p className="truncate text-sm text-muted">{user?.email}</p>
            </>
          )}
          {!isAuthenticated && (
            <>
              <h2
                id="settings-account-heading"
                className="text-lg font-semibold text-foreground"
              >
                Not signed in
              </h2>
              <p className="text-sm text-muted">Saved on this device.</p>
            </>
          )}
        </div>

        {!isPending && isAuthenticated && (
          <SecondaryButton
            className="shrink-0 rounded-full px-6 py-2.5 text-base font-semibold"
            onClick={() => {
              vibrateOk()
              void handleSignOutClick()
            }}
            loading={signingOut}
          >
            Sign out
          </SecondaryButton>
        )}
        {!isPending && !isAuthenticated && (
          <PrimaryButton
            className="shrink-0 rounded-full px-5 py-2.5 text-base font-semibold"
            onClick={() => {
              vibrateOk()
              openLogin()
            }}
          >
            <span className="flex items-center gap-x-2">
              <CloudUpload size={18} aria-hidden />
              Sign in
            </span>
          </PrimaryButton>
        )}
      </div>

      {signOutError && (
        <p role="alert" className="mt-3 text-sm text-error">
          {signOutError}
        </p>
      )}

      <SignOutConfirmDrawer
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !signingOut) setConfirmOpen(false)
        }}
        unsyncedCount={unsyncedCount}
        isSigningOut={signingOut}
        onConfirm={() => void doSignOut()}
      />
    </section>
  )
}
