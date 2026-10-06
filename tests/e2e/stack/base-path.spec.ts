/**
 * Requisito: l'applicativo si pubblica anche sotto un percorso diverso da "/"
 * (SESTANTE_APP_BASE), con app, GeoLibre, Keycloak e relay tutti sotto di esso.
 *
 * Ha senso solo con E2E_STACK_URL che contiene un percorso, ad esempio
 *   E2E_STACK_URL=https://localhost:8443/sestante/ npm run test:e2e:stack
 * Alla radice i test di questo file si saltano.
 */
import { expect, test } from "@playwright/test";

const base = () => new URL(test.info().project.use.baseURL as string);

test.beforeEach(() => {
  test.skip(base().pathname === "/", "app pubblicata alla radice: niente percorso da verificare");
});

test("le pagine portano il percorso dell'app e funzionano anche sulle rotte profonde", async ({ page }) => {
  const path = base().pathname;
  for (const route of ["./", "m/rotta-inesistente"]) {
    await page.goto(route);
    await expect(page.locator("base")).toHaveAttribute("href", path);
    await expect(page.getByText("Continua con SSO aziendale")).toBeVisible();
  }
  // Gli asset si caricano sotto il percorso, non alla radice dell'host.
  const assets: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/assets/")) assets.push(new URL(r.url()).pathname);
  });
  await page.reload();
  expect(assets.length).toBeGreaterThan(0);
  for (const asset of assets) expect(asset.startsWith(path)).toBe(true);
});

test("fuori dal percorso si torna all'app", async ({ request }) => {
  const root = await request.get(new URL("/", base()).href, { maxRedirects: 0 });
  expect(root.status()).toBe(302);
  // Relativo (Caddy) o assoluto (nginx): conta dove porta, porta compresa.
  expect(new URL(root.headers().location as string, base()).href).toBe(base().href);
});

test("GeoLibre, Keycloak e relay stanno sotto il percorso", async ({ request }) => {
  const gis = await request.get("gis/");
  expect(gis.status()).toBe(200);
  // Il build di GeoLibre è stato fatto per questo percorso.
  expect(await gis.text()).toContain(`src="${base().pathname}gis/geolibre-runtime-config.js"`);

  const discovery = (await (await request.get("auth/realms/sestante/.well-known/openid-configuration")).json()) as {
    issuer: string;
  };
  expect(discovery.issuer).toBe(new URL("auth/realms/sestante", base()).href);

  const config = (await (await request.get("gis/geolibre-runtime-config.js")).text()).match(/= (\{.*?\});/)?.[1];
  const env = JSON.parse(config as string) as Record<string, string>;
  expect(env.VITE_GEOLIBRE_COLLAB_URL).toBe(new URL("collab", base()).href.replace("https:", "wss:"));
});

test("il cookie di sessione vale solo per il percorso dell'app", async ({ page, context }) => {
  await page.goto("./");
  await page.getByText("Continua con SSO aziendale").click();
  await page.locator("#username").fill(process.env.E2E_SSO_USER ?? "anna.verdi");
  await page.locator("#password").fill(process.env.E2E_SSO_PASSWORD ?? "Sestante-demo-2026");
  await page.locator("#kc-login").click();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();
  const session = (await context.cookies()).find((c) => c.name === "sestante_session");
  expect(session?.path).toBe(base().pathname);
});
