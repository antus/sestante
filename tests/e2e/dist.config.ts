/**
 * e2e "dist": i pacchetti distribuiti, così come li riceve chi li installa.
 *
 *   npm run build:exe
 *   npm run test:e2e:dist
 *
 * Il servizio Windows si prova solo da un terminale amministratore e con
 * E2E_SERVICE=1: registra davvero un servizio (e lo toglie alla fine).
 */
import { defineConfig } from "@playwright/test";
import { shared } from "./shared.config";

export default defineConfig({
  ...shared,
  testDir: "./dist",
});
