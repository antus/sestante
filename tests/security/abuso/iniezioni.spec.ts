/**
 * Iniezioni: contenuti scelti da un utente che finiscono nella pagina di un
 * altro (XSS), nelle query (SQL) o nel parser (corpi malformati).
 */
import { expect, test, type Page } from "@playwright/test";
import { createMap, share, signIn, USERS } from "../../e2e/support/helpers";

/**
 * Il testo ostile deve arrivare nella pagina come testo (o valore di un campo)
 * e nessun elemento che porta con sé deve esistere nel DOM.
 */
async function expectInert(page: Page, payload: string): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate((p) => {
        const values = [...document.querySelectorAll("input, textarea")].map((e) => (e as HTMLInputElement).value);
        return document.body.innerText.includes(p) || values.includes(p);
      }, payload),
    )
    .toBe(true);
  const injected = await page.evaluate(() => ({
    xss: (window as { __xss?: number }).__xss,
    elements: document.querySelectorAll("img[src=x], img[onerror], svg[onload]").length,
  }));
  expect(injected.xss, payload).toBeUndefined();
  expect(injected.elements, payload).toBe(0);
}

const PAYLOADS = [
  `<img src=x onerror="window.__xss=1">`,
  `"><svg onload="window.__xss=1">`,
  `<script>window.__xss=1</script>`,
  `javascript:window.__xss=1`,
];

test("un nome di mappa ostile resta testo nella dashboard di chi la riceve", async ({ browser }) => {
  const attacker = await signIn(browser, USERS.editor);
  const victim = await signIn(browser, USERS.viewer);
  for (const payload of PAYLOADS) {
    const mapId = await createMap(attacker, payload);
    await share(attacker, mapId, USERS.viewer, "viewer");
  }

  await victim.page.goto("/");
  await victim.page.getByText("Condivise con me").first().click();
  for (const payload of PAYLOADS) await expectInert(victim.page, payload);
  await attacker.context.close();
  await victim.context.close();
});

test("un nome di mappa ostile resta testo anche nell'editor", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, PAYLOADS[0]!);
  await owner.page.goto(`/m/${mapId}`);
  await expectInert(owner.page, PAYLOADS[0]!);
  await owner.context.close();
});

test("la ricerca degli utenti tratta l'input come testo, non come SQL", async ({ browser }) => {
  const actor = await signIn(browser, USERS.owner);
  for (const q of [`' OR '1'='1`, `x'); DROP TABLE users; --`, `\\' UNION SELECT password_hash FROM users --`]) {
    const response = await actor.page.request.get(`/api/users/search?q=${encodeURIComponent(q)}`);
    expect(response.status(), q).toBe(200);
    expect(((await response.json()) as { items: unknown[] }).items, q).toEqual([]);
  }
  // Le tabelle ci sono ancora e nessun hash esce dalle API.
  const ok = await actor.page.request.get(`/api/users/search?q=example`);
  expect(ok.status()).toBe(200);
  expect(JSON.stringify(await ok.json())).not.toMatch(/password|hash|scrypt/i);
  await actor.context.close();
});

test("campi del tipo sbagliato si rifiutano senza errori del server", async ({ browser, playwright, baseURL }) => {
  const actor = await signIn(browser, USERS.owner);
  const anonymous = await playwright.request.newContext({ baseURL });
  const mapId = await createMap(actor, "Bersaglio dei corpi strani");
  const r = actor.page.request;
  const object = { $gt: "" };
  const cases: [string, Promise<{ status(): number }>][] = [
    ["JSON rotto", r.post("/api/maps", { headers: { "content-type": "application/json" }, data: Buffer.from("{ non json") })],
    ["nome non testo", r.post("/api/maps", { data: { name: object } })],
    ["descrizione non testo", r.post("/api/maps", { data: { description: [1, 2] } })],
    ["email d'accesso non testo", anonymous.post("/api/auth/login", { data: { email: object, password: "x" } })],
    ["password d'accesso non testo", anonymous.post("/api/auth/login", { data: { email: USERS.owner, password: object } })],
    ["email di registrazione non testo", anonymous.post("/api/auth/register", { data: { email: object, password: "password-sicura-2026" } })],
    ["email di condivisione non testo", r.post(`/api/maps/${mapId}/shares`, { data: { email: object, role: "viewer" } })],
    ["GeoJSON finto", r.post(`/api/maps/${mapId}/files`, { data: { name: "x", geojson: { type: "Virus" } } })],
    ["GeoJSON come stringa", r.post(`/api/maps/${mapId}/files`, { data: { name: "x", geojson: "<html>" } })],
    ["accesso inventato", r.patch(`/api/maps/${mapId}/access`, { data: { generalAccess: "public", generalRole: "admin" } })],
  ];
  for (const [what, call] of cases) {
    const status = (await call).status();
    expect(status, what).toBeGreaterThanOrEqual(400);
    expect(status, what).toBeLessThan(500);
  }
  // Il parametro ripetuto arriva come lista: nessun errore del server.
  expect((await r.get("/api/users/search?q=ab&q=cd")).status()).toBeLessThan(500);
  await anonymous.dispose();
  await actor.context.close();
});

test("condividendo non si concede il ruolo di proprietario", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Proprietario unico");
  const response = await owner.page.request.post(`/api/maps/${mapId}/shares`, {
    data: { email: USERS.viewer, role: "owner" },
  });
  // Un ruolo sconosciuto diventa il più basso, mai quello chiesto.
  expect(((await response.json()) as { role: string }).role).toBe("viewer");
  const viewer = await signIn(browser, USERS.viewer);
  expect((await viewer.page.request.delete(`/api/maps/${mapId}`)).status()).toBe(403);
  await owner.context.close();
  await viewer.context.close();
});

test("un file oltre il limite si rifiuta prima di arrivare al disco", async ({ browser }) => {
  const actor = await signIn(browser, USERS.owner);
  const mapId = await createMap(actor, "Caricamento enorme");
  // Qui il limite è 1 MB (UPLOAD_MAX_BYTES in security.config.ts).
  const huge = { type: "FeatureCollection", features: [], pad: "x".repeat(2 * 1024 * 1024) };
  const response = await actor.page.request.post(`/api/maps/${mapId}/files`, { data: { name: "enorme", geojson: huge } });
  expect(response.status()).toBe(413);
  const files = (await (await actor.page.request.get(`/api/maps/${mapId}/files`)).json()) as { items: unknown[] };
  expect(files.items).toHaveLength(0);
  await actor.context.close();
});
