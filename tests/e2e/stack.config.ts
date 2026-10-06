/**
 * e2e "stack": l'installazione server completa del compose (Caddy, Keycloak,
 * PostgreSQL, relay), già avviata.
 *
 *   cd distribution/docker && docker compose up -d --build
 *   npm run test:e2e:stack
 *
 * E2E_STACK_URL: indirizzo pubblico (default https://localhost:8443).
 * E2E_SSO_USER / E2E_SSO_PASSWORD: utente del realm (default l'utente di prova
 * anna.verdi e DEMO_USER_PASSWORD di distribution/docker/.env.example).
 */
import { defineConfig } from "@playwright/test";
import { shared } from "./shared.config";

export default defineConfig({
  ...shared,
  testDir: "./stack",
  use: {
    ...shared.use,
    // Con la barra finale: gli indirizzi dei test sono relativi, e si risolvono
    // sotto il percorso dell'app (https://host/sestante/).
    baseURL: `${(process.env.E2E_STACK_URL ?? "https://localhost:8443").replace(/\/+$/, "")}/`,
    // Il compose locale usa la CA interna di Caddy.
    ignoreHTTPSErrors: true,
  },
});
