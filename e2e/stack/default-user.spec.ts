/**
 * Requisito: ogni distribuzione ha un utente di default, con cui si entra
 * appena installata anche quando la registrazione è chiusa.
 *
 * Nelle installazioni server la password è un segreto dell'installazione:
 *   Docker      DEFAULT_USER_PASSWORD di deploy/.env
 *   Kubernetes  kubectl get secret … -o jsonpath='{.data.default-user-password}'
 * La si passa ai test con E2E_DEFAULT_PASSWORD.
 */
import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_DEFAULT_EMAIL ?? "admin@example.org";
const PASSWORD = process.env.E2E_DEFAULT_PASSWORD ?? "";

test.skip(!PASSWORD, "imposta E2E_DEFAULT_PASSWORD con la password dell'utente di default");

test("l'utente di default entra con email e password, anche con la registrazione chiusa", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Non hai un account? Registrati" })).toHaveCount(0);
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Accedi", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();

  const me = (await (await page.request.get("api/me")).json()) as { user: { email: string; provider: string } };
  expect(me.user).toMatchObject({ email: EMAIL, provider: "local" });
});
