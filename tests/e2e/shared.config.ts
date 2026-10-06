/** Impostazioni comuni alle tre configurazioni e2e. */
import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * Su Windows si usa Edge, già installato: niente browser da scaricare. Altrove
 * (CI Linux) il Chromium di Playwright: `npx playwright install chromium`.
 * E2E_BROWSER_CHANNEL lo forza (es. "chrome", o "" per il Chromium incluso).
 */
const channel =
  process.env.E2E_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined);

export const shared: PlaywrightTestConfig = {
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  // Un server, dati condivisi fra i test: in sequenza, così un test non vede
  // le sessioni collaborative di un altro.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../.out/e2e/report" }]],
  use: {
    ...(channel ? { channel } : {}),
    headless: process.env.E2E_HEADED !== "1",
    locale: "it-IT",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "../../.out/e2e/results",
};
