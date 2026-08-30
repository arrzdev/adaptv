import { Text, View } from "@arrzdev/adaptv/components"
import { CloudUpload } from "lucide-react"
import { PrimaryButton } from "@/components/ui"

//account surface in settings: identity on the left, a pill action on the right.
//there is no account — this app is frontend-only and every task lives in this
//device's IndexedDB — so the row always reads "Not signed in" and the button
//opens the sign-in facade, which says as much and fails. See LoginForm.
export function SettingsAccountCard({
  onSignIn,
}: {
  onSignIn: () => void
}) {
  return (
    <View
      aria-labelledby="settings-account-heading"
      className="rounded-md bg-surface px-4 py-4"
    >
      <View row className="flex items-center gap-x-4">
        <View className="flex min-w-0 flex-1 flex-col gap-y-0.5">
          <Text
            // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h2 at runtime (cloneElement), which the static check can't see
            render={<h2 />}
            id="settings-account-heading"
            className="text-lg font-semibold text-foreground"
          >
            Not signed in
          </Text>
          <Text render={<p />} className="text-sm text-muted">
            Saved on this device.
          </Text>
        </View>

        <PrimaryButton
          className="shrink-0 rounded-full px-5 py-2.5 text-base font-semibold"
          onClick={onSignIn}
        >
          <Text className="flex items-center gap-x-2">
            <CloudUpload size={18} aria-hidden />
            Sign in
          </Text>
        </PrimaryButton>
      </View>
    </View>
  )
}
