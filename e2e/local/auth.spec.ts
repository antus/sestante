/**
 * Requisito: autenticazione iniziale locale (Keycloak facoltativo, se configurato).
 * Qui Keycloak non è configurato: l'accesso è solo locale e il pulsante SSO non c'è.
 */
import { expect, test } from "@playwright/test";
import { DEMO_PASSWORD, USERS } from "../support/helpers";

async function fillLogin(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
}

test("senza sessione si vede la pagina di accesso, senza SSO quando Keycloak non è configurato", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Accedi al tuo spazio" })).toBeVisible();
  await expect(page.getByText("Continua con SSO aziendale")).toHaveCount(0);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("si accede con email e password e si esce", async ({ page }) => {
  await page.goto("/");
  await fillLogin(page, USERS.owner, DEMO_PASSWORD);
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(200);

  await page.getByRole("button", { name: "Massimo Antonini" }).click();
  await page.getByText("Esci").click();
  await expect(page.getByRole("heading", { name: "Accedi al tuo spazio" })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("password sbagliata ed email inesistente danno lo stesso messaggio", async ({ page }) => {
  // Lo stesso messaggio per i due casi: la pagina non rivela quali email sono registrate.
  await page.goto("/");
  await fillLogin(page, USERS.owner, "password-sbagliata-1");
  await expect(page.getByText("Email o password non corretti.")).toBeVisible();

  await fillLogin(page, "nessuno@example.org", "password-sbagliata-1");
  await expect(page.getByText("Email o password non corretti.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toHaveCount(0);
});

test("ci si registra con un account locale, e la stessa email non si registra due volte", async ({ page }) => {
  const email = `nuovo.${Date.now()}@example.org`;
  await page.goto("/");
  await page.getByRole("button", { name: "Non hai un account? Registrati" }).click();
  await page.getByLabel("Nome e cognome").fill("Nuovo Utente");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password-sicura-2026");
  await page.getByRole("button", { name: "Crea un account" }).click();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();

  const again = await page.request.post("/api/auth/register", {
    data: { email, password: "password-sicura-2026", displayName: "Doppione" },
  });
  expect(again.status()).toBe(409);
});

test("la registrazione rifiuta password deboli", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Non hai un account? Registrati" }).click();
  await page.getByLabel("Email").fill(`debole.${Date.now()}@example.org`);
  await page.getByLabel("Password").fill("corta1");
  await page.getByRole("button", { name: "Crea un account" }).click();
  await expect(page.getByText("La password deve avere almeno 10 caratteri.")).toBeVisible();
});

test("senza sessione le API delle mappe rispondono 401", async ({ request }) => {
  expect((await request.get("/api/maps")).status()).toBe(401);
  expect((await request.post("/api/maps", { data: { name: "x" } })).status()).toBe(401);
});
