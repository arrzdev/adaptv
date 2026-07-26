import { LoginForm } from "@/components/auth/login-form"
import { AppDrawer } from "@/components/ui"

type LoginDrawerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

//the login surface. kept mounted (toggle `open` only) so the drawer's exit
//animation can run — see the ui-shell controlled-drawer contract.
export function LoginDrawer({ open, onOpenChange }: LoginDrawerProps) {
  return (
    <AppDrawer open={open} onOpenChange={onOpenChange}>
      <AppDrawer.Portal>
        <AppDrawer.Overlay />
        <AppDrawer.Content>
          <AppDrawer.Handle />
          <LoginForm onClose={() => onOpenChange(false)} />
        </AppDrawer.Content>
      </AppDrawer.Portal>
    </AppDrawer>
  )
}
