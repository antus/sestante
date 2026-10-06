/**
 * Requisito: GeoLibre personalizzato senza fork e senza servirlo da CDN.
 * È il build ufficiale, servito da Sestante sulla propria origine, configurato
 * a runtime dal server; la pagina non scarica codice da terzi.
 */
import { expect, test } from "@playwright/test";
import { createMap, openMap, signIn, USERS, watchMapState } from "../support/helpers";

/** Gli unici host esterni ammessi: le tessere della mappa di base (OpenFreeMap). */
const ALLOWED_EXTERNAL = new Set(["tiles.openfreemap.org"]);

test("GeoLibre è servito da Sestante, sulla stessa origine, con le sue intestazioni di sicurezza", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Origine GeoLibre");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);

  const src = (await owner.page.locator("iframe").getAttribute("src")) as string;
  const pageOrigin = new URL(owner.page.url()).origin;
  expect(new URL(src, owner.page.url()).origin).toBe(pageOrigin);
  expect(new URL(src, owner.page.url()).pathname).toBe("/gis/");

  const index = await owner.page.request.get("/gis/");
  expect(index.status()).toBe(200);
  const csp = index.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'self'");
  expect(index.headers()["x-content-type-options"]).toBe("nosniff");
  await owner.context.close();
});

test("aprendo una mappa non si scarica nulla da CDN o servizi di terzi", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Nessun CDN");
  const external = new Set<string>();
  owner.context.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return;
    external.add(url.hostname);
  });
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);
  // Il tempo che GeoLibre carichi motori e plugin pigri.
  await owner.page.waitForTimeout(8000);

  const unexpected = [...external].filter((host) => !ALLOWED_EXTERNAL.has(host));
  expect(unexpected, `host esterni contattati: ${[...external].join(", ")}`).toEqual([]);
  await owner.context.close();
});

test("la configurazione di GeoLibre arriva dal server: comandi solo da Sestante, niente Share, relay nostro", async ({ request, baseURL }) => {
  const script = await (await request.get("/gis/geolibre-runtime-config.js")).text();
  const match = script.match(/__GEOLIBRE_DEPLOYMENT_ENV__ = (\{.*?\});/);
  expect(match, "configurazione runtime").toBeTruthy();
  const env = JSON.parse(match?.[1] as string) as Record<string, string>;
  expect(env.VITE_GEOLIBRE_EMBED_ORIGINS.split(",")).toContain(new URL(baseURL as string).origin);
  expect(env.VITE_GEOLIBRE_SHARE_URL).toBe("off");
  expect(env.VITE_GEOLIBRE_COLLAB_URL).toMatch(/^wss?:\/\//);
});

test("l'API comandi di GeoLibre risponde a Sestante", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "API embed");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);
  // `ready` è il saluto dell'API embed v2: arriva solo se l'origine di Sestante
  // è fra quelle autorizzate.
  await expect
    .poll(() => owner.page.evaluate(() => (window as never as { __e2e: { types: Record<string, number> } }).__e2e.types.ready ?? 0))
    .toBeGreaterThan(0);
  await expect(owner.page.getByText("API runtime non disponibile")).toHaveCount(0);
  await owner.context.close();
});
