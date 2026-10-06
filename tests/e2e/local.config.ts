/**
 * e2e "local": il server avviato da qui, in modalità local, su dati temporanei.
 *
 *   npm run test:e2e
 *
 * Prerequisito: npm run setup (serve il build di GeoLibre).
 */
import { defineConfig } from "@playwright/test";
import { shared } from "./shared.config";

const port = process.env.E2E_PORT ?? "4180";

export default defineConfig({
  ...shared,
  testDir: "./local",
  use: { ...shared.use, baseURL: `http://localhost:${port}` },
  webServer: {
    command: "node tests/e2e/support/start-local.mjs",
    cwd: "../..",
    url: `http://localhost:${port}/api/config`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
