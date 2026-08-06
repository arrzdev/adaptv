import type { InputHandle } from "@arrzdev/adaptv/components"
import { Pressable, View } from "@arrzdev/adaptv/components"
import { Eye, EyeOff } from "lucide-react"
import { forwardRef, useState } from "react"
import { TextInput } from "@/components/ui"

type PasswordFieldProps = {
  value: string
  onChange: (value: string) => void
  onSubmit?: () => void
  autoComplete?: string
  placeholder?: string
}

//password input with a show/hide toggle. the eye button overlays the right edge
//of the field (which reserves space via pe-11), matching the app's input shell.
//forwards a ref so a preceding field can advance focus here on Enter.
export const PasswordField = forwardRef<InputHandle, PasswordFieldProps>(
  function PasswordField(
    { value, onChange, onSubmit, autoComplete, placeholder = "Password" },
    ref,
  ) {
    const [show, setShow] = useState(false)

    return (
      <View className="relative">
        <TextInput
          ref={ref}
          type={show ? "text" : "password"}
          name="password"
          value={value}
          onChange={onChange}
          //last field → Enter submits, on desktop AND the software keyboard's
          //"go" key (onSubmit alone is desktop-only inside the pwa input).
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            onSubmit?.()
          }}
          enterKeyHint="go"
          placeholder={placeholder}
          autoComplete={autoComplete}
          aria-label="Password"
          fieldClassName="h-12 leading-none pe-11"
        />
        <Pressable
          render={<button type="button" />}
          onPress={() => setShow((shown) => !shown)}
          aria-label={show ? "Hide password" : "Show password"}
          className="clickable absolute inset-y-0 end-0 flex items-center pe-3.5 text-muted"
        >
          {show && <EyeOff size={18} strokeWidth={1.75} aria-hidden />}
          {!show && <Eye size={18} strokeWidth={1.75} aria-hidden />}
        </Pressable>
      </View>
    )
  },
)
