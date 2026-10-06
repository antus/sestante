/**
 * Test di sicurezza: casi d'abuso contro il server avviato in modalità local,
 * come per gli e2e ma su una porta sua.
 *
 *   npm run test:security
 *
 * Ogni test descrive un attacco e verifica che non riesca. La scansione
 * automatica OWASP ZAP è a parte: npm run test:security:zap.
 */
import { defineConfig } from "@playwright/test";
import { shared } from "../e2e/shared.config";

const port = process.env.SECURITY_PORT ?? "4181";

export default defineConfig({
  ...shared,
  testDir: "./abuso",
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../.out/security/report" }]],
  outputDir: "../../.out/security/results",
  use: { ...shared.use, baseURL: `http://localhost:${port}` },
  webServer: {
    command: "node tests/e2e/support/start-local.mjs",
    cwd: "../..",
    env: { E2E_PORT: port, E2E_RELAY_PORT: "8799", UPLOAD_MAX_BYTES: String(1024 * 1024) },
    url: `http://localhost:${port}/api/config`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
