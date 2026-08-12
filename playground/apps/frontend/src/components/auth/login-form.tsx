import type { InputHandle } from "@arrzdev/adaptv/components"
import { Pressable, Text, View } from "@arrzdev/adaptv/components"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { PasswordField } from "@/components/auth/password-field"
import {
  AppDrawer,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from "@/components/ui"
import { authClient } from "@/data/auth/client"
import type { SocialProvider } from "@/data/auth/social-providers"
import { socialProvidersQueryOptions } from "@/data/auth/social-providers"
import { consumeSyncReset, requestSyncReset } from "@/data/sync/controller"
import { useHaptics } from "@/hooks/use-haptics"

const MIN_PASSWORD = 8

//Floor the visible loading time on submit so a fast network round-trip doesn't flash
//the spinner as a jarring blip — the button reads as "working" for at least this long.
const MIN_SUBMIT_LOADING_MS = 1000

//How long an autofill detection stays armed while the controlled state catches up to the
//DOM fill (one or two renders). Kept short so a dropped arm can never fire on later typing.
const AUTOFILL_SUBMIT_WINDOW_MS = 500

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const PROVIDER_LABEL: Record<SocialProvider, string> = {
  github: "GitHub",
  google: "Google",
}

//inputs + buttons share ONE explicit control height so they line up exactly
//(the button's internal content shell has a different line-height than a bare
//<input>, so matching `py` alone doesn't produce equal box heights)
const CONTROL_CLASS = "w-full h-12 text-base font-semibold leading-none"
const FIELD_CLASS = "h-12 leading-none"

type Mode = "signin" | "signup"

//email/password + oauth, in a drawer. the social buttons are data-driven from
//the backend's configured providers. on SIGN-UP the local guest data is kept
//and adopts into the new account (sync pushes it up); on SIGN-IN to an existing
//account the local guest state is discarded and reset to the clean upstream.
export function LoginForm({ onClose }: { onClose: () => void }) {
  //the engine comes from context so the lab can open this exact drawer on either one

  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [pendingProvider, setPendingProvider] =
    useState<SocialProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: providers = [] } = useQuery(socialProvidersQueryOptions)
  const haptic = useHaptics()
  const passwordRef = useRef<InputHandle>(null)
  const fieldsRef = useRef<HTMLDivElement>(null)
  //when (performance.now) an autofill burst armed the auto-submit; null = disarmed
  const autofillArmedAtRef = useRef<number | null>(null)
  //last seen DOM value lengths, to tell a one-shot fill from per-keystroke typing
  const fieldLengthsRef = useRef({ email: 0, password: 0 })

  const isSignUp = mode === "signup"
  //any in-flight auth (email submit or a social redirect starting) locks every
  //control so a second tap can't double-fire a sign-in
  const isBusy = submitting || pendingProvider !== null
  const canSubmit =
    email.trim().length > 0 && password.length >= MIN_PASSWORD && !isBusy

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    //existing-account sign-in discards local guest data and pulls the account's
    //clean state — request it BEFORE the session lands so the auth provider
    //wipes before enabling sync. a sign-up leaves it unset → guest data adopts.
    if (!isSignUp) requestSyncReset()
    const startedAt = Date.now()
    const result = isSignUp
      ? await authClient.signUp.email({
          email: email.trim(),
          password,
          //better-auth requires a name; username lives in our profile table
          name: email.trim().split("@")[0] || email.trim(),
        })
      : await authClient.signIn.email({ email: email.trim(), password })

    //hold the loading state to its floor before resolving either way (success closes the
    //drawer, error surfaces below) — a fast round-trip otherwise flashes the spinner
    const remaining = MIN_SUBMIT_LOADING_MS - (Date.now() - startedAt)
    if (remaining > 0) await delay(remaining)

    if (result.error) {
      if (!isSignUp) consumeSyncReset() //cancel the pending reset
      setSubmitting(false)
      setError(result.error.message ?? "Something went wrong. Try again.")
      return
    }

    //success: the AuthProvider effect enables sync — adopting guest data on
    //sign-up, or wiping local + pulling clean on sign-in — all in place
    onClose()
  }

  async function handleSocial(provider: SocialProvider) {
    if (isBusy) return
    setError(null)
    setPendingProvider(provider)
    //note: social sign-in currently ADOPTS guest data (no requestSyncReset before
    //the session lands), whereas email sign-in DISCARDS it. this divergence is an
    //owner product decision — do not reconcile it here.
    //redirects to the provider; on success this is a full-page nav (no reset
    //needed), so only a FAILED start returns here with an error to surface.
    const result = await authClient.signIn.social({
      provider,
      callbackURL: window.location.href,
    })
    if (result.error) {
      setPendingProvider(null)
      setError(result.error.message ?? "Something went wrong. Try again.")
    }
  }

  function switchMode() {
    setMode(isSignUp ? "signin" : "signup")
    setError(null)
  }

  //---- autofill auto-submit ----------------

  //iOS password autofill fills a field's whole value in ONE input event (typing never
  //does), so a multi-char jump — or WebKit's explicit "insertReplacementText" — marks a
  //fill. When a fill leaves BOTH fields populated (read from the DOM: controlled state
  //lands a tick later), arm the auto-submit; the render effect below fires it once state
  //catches up. Covers either fill order, and password-only autofill after a typed email.
  useEffect(() => {
    const root = fieldsRef.current
    if (!root) return

    function handleNativeInput(event: Event) {
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.name !== "email" && target.name !== "password") return
      const field = target.name

      const previousLength = fieldLengthsRef.current[field]
      fieldLengthsRef.current[field] = target.value.length
      const valueDelta = target.value.length - previousLength

      //null inputType = a plain (non-InputEvent) programmatic fill; paste is excluded —
      //pasting a password shouldn't submit for you
      const inputType =
        event instanceof InputEvent ? event.inputType : null
      const isAutofillLike =
        inputType === "insertReplacementText" ||
        inputType === null ||
        (valueDelta > 1 && inputType !== "insertFromPaste")

      if (!isAutofillLike) return

      const emailValue =
        fieldsRef.current?.querySelector<HTMLInputElement>(
          'input[name="email"]',
        )?.value ?? ""
      const passwordValue =
        fieldsRef.current?.querySelector<HTMLInputElement>(
          'input[name="password"]',
        )?.value ?? ""
      if (
        emailValue.trim().length === 0 ||
        passwordValue.length < MIN_PASSWORD
      ) {
        return
      }

      autofillArmedAtRef.current = performance.now()
    }

    root.addEventListener("input", handleNativeInput)
    return () => root.removeEventListener("input", handleNativeInput)
  }, [])

  //deliberately dep-less: the arm is a ref set by the native listener, and the state it
  //waits for arrives on the very next render(s) — the window bounds how long it can wait,
  //so an arm can never fire on unrelated typing later.
  useEffect(() => {
    if (autofillArmedAtRef.current === null) return
    if (
      performance.now() - autofillArmedAtRef.current >
      AUTOFILL_SUBMIT_WINDOW_MS
    ) {
      autofillArmedAtRef.current = null
      return
    }
    //account creation stays a deliberate tap — never auto-submit a sign-up
    if (isSignUp) {
      autofillArmedAtRef.current = null
      return
    }
    if (!canSubmit) return

    autofillArmedAtRef.current = null
    haptic.notify("success")
    void handleSubmit()
  })

  return (
    <AppDrawer.Shell className="pb-2">
      <AppDrawer.Title>
        {isSignUp && "Create your account"}
        {!isSignUp && "Welcome back"}
      </AppDrawer.Title>
      <AppDrawer.Description className="mt-1">
        {isSignUp && "Sign up to sync your tasks across devices."}
        {!isSignUp && "Sign in to sync your tasks across devices."}
      </AppDrawer.Description>

      <View ref={fieldsRef} className="mt-3 flex flex-col gap-3">
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
          autoComplete={isSignUp ? "new-password" : "current-password"}
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
            haptic.notify("success")
            void handleSubmit()
          }}
          hapticOnPress={false}
          disabled={!canSubmit}
          loading={submitting}
        >
          {isSignUp && "Create account"}
          {!isSignUp && "Sign in"}
        </PrimaryButton>
      </View>

      {providers.length > 0 && (
        <View className="mt-4 flex flex-col gap-3">
          <View row className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border-subtle" />
            or
            <span className="h-px flex-1 bg-border-subtle" />
          </View>
          {providers.map((provider) => (
            <SecondaryButton
              key={provider}
              className={CONTROL_CLASS}
              onClick={() => void handleSocial(provider)}
              disabled={isBusy}
              loading={pendingProvider === provider}
            >
              Continue with {PROVIDER_LABEL[provider]}
            </SecondaryButton>
          ))}
        </View>
      )}

      <Pressable
        render={<button type="button" />}
        onPress={() => {
          haptic.impact("light")
          switchMode()
        }}
        className="clickable mt-5 w-full text-center text-sm text-muted"
      >
        {isSignUp && (
          <>
            Already have an account?{" "}
            <span className="font-medium text-foreground underline underline-offset-2 decoration-border-strong">
              Sign in
            </span>
          </>
        )}
        {!isSignUp && (
          <>
            New here?{" "}
            <span className="font-medium text-foreground underline underline-offset-2 decoration-border-strong">
              Create an account
            </span>
          </>
        )}
      </Pressable>
    </AppDrawer.Shell>
  )
}
