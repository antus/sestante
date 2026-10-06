/**
 * Intestazioni HTTP che chiudono intere classi di attacchi: l'app non si
 * incorpora in siti altrui (clickjacking), il browser non "indovina" i tipi
 * (MIME sniffing), le API non si leggono da altre origini (CORS).
 */
import { expect, test } from "@playwright/test";
import { createMap, FEATURE_COLLECTION, signIn, USERS } from "../../e2e/support/helpers";

const EVIL = "https://sito-ostile.example.net";

test("le pagine dell'app non si incorporano in un altro sito", async ({ request }) => {
  for (const path of ["/", "/m/qualsiasi"]) {
    const headers = (await request.get(path)).headers();
    const frameAncestors = /frame-ancestors\s+'self'/.test(headers["content-security-policy"] ?? "");
    const xfo = /^(sameorigin|deny)$/i.test(headers["x-frame-options"] ?? "");
    expect(frameAncestors || xfo, `${path}: frame-ancestors o X-Frame-Options`).toBe(true);
    expect(headers["x-content-type-options"], path).toBe("nosniff");
  }
});

test("GeoLibre si incorpora solo in Sestante e con una CSP restrittiva", async ({ request }) => {
  const response = await request.get("/gis/");
  expect(response.status()).toBe(200);
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/frame-ancestors 'self'/);
  expect(csp).not.toMatch(/script-src[^;]*\*/);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
});

test("le API non rispondono a un'altra origine con le credenziali dell'utente", async ({ browser }) => {
  const actor = await signIn(browser, USERS.owner);
  for (const path of ["/api/me", "/api/maps"]) {
    const response = await actor.page.request.get(path, { headers: { origin: EVIL } });
    const allow = response.headers()["access-control-allow-origin"];
    expect(allow === undefined || (allow !== "*" && allow !== EVIL), path).toBe(true);
  }
  const preflight = await actor.page.request.fetch("/api/maps", {
    method: "OPTIONS",
    headers: { origin: EVIL, "access-control-request-method": "DELETE" },
  });
  expect(preflight.headers()["access-control-allow-origin"]).not.toBe(EVIL);
  await actor.context.close();
});

test("i file caricati si scaricano come dati, mai come pagina", async ({ browser }) => {
  const actor = await signIn(browser, USERS.owner);
  const mapId = await createMap(actor, "Tipi dei file");
  const uploaded = await actor.page.request.post(`/api/maps/${mapId}/files`, {
    data: { name: "pagina.html", geojson: { ...FEATURE_COLLECTION, note: "<script>alert(1)</script>" } },
  });
  const { file } = (await uploaded.json()) as { file: { url: string } };
  const response = await actor.page.request.get(new URL(file.url).pathname + new URL(file.url).search);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).not.toMatch(/html/i);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["access-control-allow-origin"]).not.toBe("*");
  await actor.context.close();
});

test("gli errori non espongono dettagli interni", async ({ request }) => {
  const responses = [
    await request.get("/api/maps/../../etc/passwd"),
    await request.post("/api/auth/login", { headers: { "content-type": "application/json" }, data: "{" }),
  ];
  for (const response of responses) {
    const text = await response.text();
    expect(text).not.toMatch(/at \w+ \(|node_modules|[A-Z]:\\|\/src\/server\//);
  }
});
