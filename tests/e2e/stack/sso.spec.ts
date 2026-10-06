/**
 * Requisito: in un'installazione condivisa l'accesso può passare da Keycloak.
 * Qui contro il compose completo: Keycloak dietro Caddy, realm importato.
 */
import { expect, test, type Page } from "@playwright/test";

const SSO_USER = process.env.E2E_SSO_USER ?? "anna.verdi";
const SSO_PASSWORD = process.env.E2E_SSO_PASSWORD ?? "Sestante-demo-2026";

async function keycloakLogin(page: Page) {
  await page.goto("./");
  await page.getByText("Continua con SSO aziendale").click();
  await expect(page).toHaveURL(/\/auth\/realms\/sestante\//);
  await page.locator("#username").fill(SSO_USER);
  await page.locator("#password").fill(SSO_PASSWORD);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();
}

test("con la registrazione locale spenta si entra solo con l'SSO", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText("Continua con SSO aziendale")).toBeVisible();
  await expect(page.getByRole("button", { name: "Non hai un account? Registrati" })).toHaveCount(0);
  const register = await page.request.post("api/auth/register", {
    data: { email: "intruso@example.org", password: "password-sicura-2026" },
  });
  expect(register.status()).toBe(403);
});

test("si entra con Keycloak e Sestante riconosce l'utente del realm", async ({ page, context }) => {
  await keycloakLogin(page);
  const me = (await (await page.request.get("api/me")).json()) as { user: { email: string; provider: string } };
  expect(me.user.email).toBe("anna.verdi@example.org");
  expect(me.user.provider).toBe("keycloak");

  // Dietro HTTPS il cookie di sessione è Secure e HttpOnly.
  const session = (await context.cookies()).find((c) => c.name === "sestante_session");
  expect(session?.secure).toBe(true);
  expect(session?.httpOnly).toBe(true);
});

test("uscendo si chiude anche la sessione di Keycloak: per rientrare serve la password", async ({ page }) => {
  await keycloakLogin(page);
  await page.getByRole("button", { name: "Anna Verdi" }).click();
  await page.getByText("Esci").click();
  await expect(page.getByText("Continua con SSO aziendale")).toBeVisible();
  expect((await page.request.get("api/me")).status()).toBe(401);

  await page.getByText("Continua con SSO aziendale").click();
  await expect(page.locator("#password")).toBeVisible();
});
