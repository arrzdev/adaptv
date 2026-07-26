import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers"
import { defineConfig } from "vitest/config"

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@/entrypoint",
        replacement: path.resolve(rootDir, "entrypoint/worker.ts"),
      },
      { find: "@/env", replacement: path.resolve(rootDir, "env") },
      { find: "@", replacement: path.resolve(rootDir, "src") },
    ],
  },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(
        path.join(rootDir, "src/database/migrations"),
      )

      return {
        wrangler: { configPath: path.join(rootDir, "wrangler.toml") },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            RATE_LIMIT_ALLOW_TEST_BYPASS: "true",
            //auth env so the better-auth instance boots in the test worker;
            //sync tests sign up through the real handler to get a bearer token
            BETTER_AUTH_SECRET: "test-secret-at-least-32-chars-long-xx",
            BETTER_AUTH_URL: "http://example.com",
            FRONTEND_URL: "http://example.com",
          },
        },
      }
    }),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test-support/apply-migrations.ts"],
  },
})
