import type { InputHandle } from "adaptv/components"
import { Text, View } from "adaptv/components"
import { useRef, useState } from "react"
import { PasswordField } from "@/components/auth/password-field"
import { AppDrawer, PrimaryButton, TextInput } from "@/components/ui"
import { useHaptics } from "@/hooks/use-haptics"

const MIN_PASSWORD = 8

//The one thing this form does when you submit it.
const UNAVAILABLE = "Sign-in is not available in this demo."

//inputs + buttons share ONE explicit control height so they line up exactly
//(the button's internal content shell has a different line-height than a bare
//<input>, so matching `py` alone doesn't produce equal box heights)
const CONTROL_CLASS = "w-full h-12 text-base font-semibold leading-none"
const FIELD_CLASS = "h-12 leading-none"

//---- Sign-in facade -----------------------------------------------
//A REAL form with NO account behind it. This app is frontend-only: there is no
//server to authenticate against, so submitting always fails, in one line, with
//no network request. The fields, the autofocus and the drawer are the point —
//they are what the framework's keyboard/inset/drawer behaviour is exercised
//against (see /lab/drawer §7 and e2e/drawer-real.spec.ts). The auth is not.
export function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const haptic = useHaptics()
  const passwordRef = useRef<InputHandle>(null)

  const canSubmit =
    email.trim().length > 0 && password.length >= MIN_PASSWORD

  function handleSubmit() {
    if (!canSubmit) return
    //no fetch, no session, no retry — say so and stop
    setError(UNAVAILABLE)
  }

  return (
    <AppDrawer.Shell className="pb-2">
      <AppDrawer.Title>Welcome back</AppDrawer.Title>
      <AppDrawer.Description className="mt-1">
        This demo keeps everything on your device — there is no account to
        sign in to.
      </AppDrawer.Description>

      <View className="mt-3 flex flex-col gap-3">
        <TextInput
          type="email"
          name="email"
          value={email}
          onChange={setEmail}
          placeholder="you@example.com"
          autoComplete="email"
          aria-label="Email"
          fieldClassName={FIELD_CLASS}
          //Enter advances to the password field rather than submitting.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            passwordRef.current?.focus()
          }}
          enterKeyHint="next"
          autoFocus
        />
        <PasswordField
          ref={passwordRef}
          value={password}
          onChange={setPassword}
          onSubmit={handleSubmit}
          autoComplete="current-password"
        />

        {/* reserved one-line slot — always present so an error can't shift the buttons */}
        <Text
          render={<p />}
          role="alert"
          className="min-h-5 whitespace-pre-line text-sm text-error"
        >
          {error}
        </Text>

        <PrimaryButton
          className={CONTROL_CLASS}
          onClick={() => {
            haptic.notify("error")
            handleSubmit()
          }}
          hapticOnPress={false}
          disabled={!canSubmit}
        >
          Sign in
        </PrimaryButton>
      </View>
    </AppDrawer.Shell>
  )
}
