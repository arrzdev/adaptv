import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  //`@/` is `src/`, from tsconfig.json — adaptv imports the app's stylesheet and screens
  //through it
  resolve: { tsconfigPaths: true },
  //adaptv imports modules its Vite plugin serves (`virtual:adaptv-*`), which Node cannot
  //load, so the dev server runs it through Vite instead of handing it to Node
  ssr: { noExternal: ["@arrzdev/adaptv"] },
  plugins: [adaptv(), tailwindcss()],
})
