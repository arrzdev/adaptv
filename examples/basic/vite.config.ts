import { adaptv } from "@arrzdev/adaptv/vite"
import { defineConfig } from "vite"

export default defineConfig({
  //`@/` is `src/`, from tsconfig.json — adaptv imports the app's stylesheet and screens
  //through it
  resolve: { tsconfigPaths: true },
  plugins: [adaptv()],
})
