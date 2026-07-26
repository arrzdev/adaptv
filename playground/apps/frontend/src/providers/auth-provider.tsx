import type { ReactNode } from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { LoginDrawer } from "@/components/auth/login-drawer"
import type { AuthSessionUser } from "@/data/auth/client"
import { useSessionState } from "@/data/auth/client"
import { resetLocalStore } from "@/data/store"
import { consumeSyncReset, setSyncEnabled } from "@/data/sync/controller"

//---- Auth provider ------------------------------------------------
//the single owner of auth. it subscribes to the session ONCE, exposes it as
//app-wide reactive state through `useAuth()`, owns the login drawer's OPEN
//STATE, and bridges auth → sync. everything that needs to know whether we're
//signed in (settings, the sync indicator, …) reads `useAuth()` — no page needs
//an auth guard, because the app is fully usable as a guest.
//
//the drawer itself is rendered inside the page tree by <GlobalLoginDrawer/>,
//NOT here: iOS only raises the keyboard for an autofocus that happens inside the
//router's outlet scope; a drawer mounted up at provider level (outside the
//outlet) focuses the field but never opens the keyboard. See GlobalLoginDrawer.
//
//STALE-WHILE-REVALIDATE: better-auth revalidates the session in the background
//(on tab refocus). we expose `isPending` as "the first resolve hasn't happened
//yet" ONLY — once the session has resolved even once, we keep serving the cached
//user (or cached guest = null) and never report pending again. so navigation and
//refocus never re-flash auth-dependent UI or re-gate the page.

type AuthContextValue = {
  /** The signed-in user, or null for a guest. Served from cache (SWR). */
  user: AuthSessionUser | null
  /** Whether a user is signed in. */
  isAuthenticated: boolean
  /**
   * True only until the session resolves the FIRST time — use it to avoid a
   * first-paint guest flash. It never re-flips true on background
   * revalidation, so do NOT use it as a per-render loading gate.
   */
  isPending: boolean
  /** Open the login drawer (email/password + oauth). */
  openLogin: () => void
  /** Login drawer open state — consumed by {@link GlobalLoginDrawer}. */
  loginOpen: boolean
  setLoginOpen: (open: boolean) => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isPending: true,
  openLogin: () => {},
  loginOpen: false,
  setLoginOpen: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    user,
    isAuthenticated,
    isPending: rawIsPending,
  } = useSessionState()
  const [loginOpen, setLoginOpen] = useState(false)

  //latch: once the session has resolved a first time we're "settled" forever.
  //after that, better-auth's `rawIsPending` may flip true again on a background
  //revalidation — we ignore it and keep serving the cached value (SWR).
  const [hasSettled, setHasSettled] = useState(false)
  useEffect(() => {
    if (!rawIsPending && !hasSettled) setHasSettled(true)
  }, [rawIsPending, hasSettled])
  const isPending = rawIsPending && !hasSettled

  const openLogin = useCallback(() => setLoginOpen(true), [])

  //sync follows auth: external system (the sync controller), so an effect is the
  //right tool. gate on the FIRST resolve only (`isPending`) so background
  //revalidations can't flap sync on/off.
  useEffect(() => {
    if (isPending) return
    if (!isAuthenticated) {
      setSyncEnabled(false)
      return
    }
    //authenticated: an existing-account sign-in asked to discard guest data, so
    //wipe local BEFORE enabling sync (which then pulls only this account's data)
    let cancelled = false
    void (async () => {
      if (consumeSyncReset()) {
        await resetLocalStore()
        if (cancelled) return
      }
      setSyncEnabled(true)
    })()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, isPending])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated,
      isPending,
      openLogin,
      loginOpen,
      setLoginOpen,
    }),
    [user, isAuthenticated, isPending, openLogin, loginOpen],
  )

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  )
}

//the one hook every consumer reads: cached auth state (SWR) + the login opener.
export function useAuth() {
  return useContext(AuthContext)
}

//Renders the login drawer INSIDE the page tree (router outlet scope) so its
//autofocus can raise the iOS keyboard. Mount once, near the outlet — e.g. in a
//page that can open login. Reads open state from {@link useAuth}.
export function GlobalLoginDrawer() {
  const { loginOpen, setLoginOpen } = useAuth()
  return <LoginDrawer open={loginOpen} onOpenChange={setLoginOpen} />
}
