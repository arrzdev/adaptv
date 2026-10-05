import { adaptv } from "@arrzdev/adaptv/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

//41760 sits clear of the playground's blocks (41730/41740, 41830/41840), so the site
//and the playground can run side by side. `VITE_APP_PORT` moves it for a second worktree.
const port = Number(process.env.VITE_APP_PORT ?? 41760)

export default defineConfig({
  server: { host: "0.0.0.0", port },
  preview: { host: "0.0.0.0", port },
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  plugins: [adaptv(), tailwindcss()],
})
