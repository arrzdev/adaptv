import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: ["./src/database/schema.ts", "./src/database/auth.schema.ts"],
  out: "./src/database/migrations",
  dialect: "sqlite",
  casing: "snake_case",
  verbose: true,
  strict: true,
})
