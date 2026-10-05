import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
  //`@/` is `src/`, from tsconfig.json — adaptv imports the app's stylesheet and screens
  //through it
  resolve: { tsconfigPaths: true },
  //adaptv ships TypeScript source for now, so the server build bundles it
  ssr: { noExternal: ["@arrzdev/adaptv"] },
  plugins: [adaptv(), tailwindcss()],
})
