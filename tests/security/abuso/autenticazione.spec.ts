/**
 * Abusi dell'autenticazione: entrare senza credenziali, falsificare la
 * sessione, indovinare le password, scoprire quali account esistono.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEMO_PASSWORD, USERS } from "../../e2e/support/helpers";

/** Rotte che chiedono una sessione; i parametri non esistono, ma il 401 viene prima. */
const PROTECTED: [method: "get" | "post" | "patch" | "delete", path: string][] = [
  ["get", "/api/me"],
  ["get", "/api/maps"],
  ["post", "/api/maps"],
  ["patch", "/api/maps/qualsiasi"],
  ["patch", "/api/maps/qualsiasi/access"],
  ["delete", "/api/maps/qualsiasi"],
  ["post", "/api/maps/qualsiasi/files"],
  ["delete", "/api/maps/qualsiasi/files/x"],
  ["post", "/api/maps/qualsiasi/shares"],
  ["patch", "/api/maps/qualsiasi/shares/x"],
  ["delete", "/api/maps/qualsiasi/shares/x"],
  ["post", "/api/maps/qualsiasi/invites"],
  ["post", "/api/invites/qualsiasi/redeem"],
  ["get", "/api/users/search?q=example"],
  ["post", "/api/collab/identity-token"],
];

async function sessionCookie(request: APIRequestContext, email: string): Promise<string> {
  const response = await request.post("/api/auth/login", { data: { email, password: DEMO_PASSWORD } });
  expect(response.status()).toBe(200);
  const header = response.headers()["set-cookie"] ?? "";
  const match = header.match(/sestante_session=([^;]+)/);
  expect(match, "cookie di sessione").not.toBeNull();
  return match![1]!;
}

test("senza sessione nessuna rotta protetta risponde", async ({ playwright, baseURL }) => {
  const anonymous = await playwright.request.newContext({ baseURL });
  for (const [method, path] of PROTECTED) {
    const response = await anonymous[method](path, { data: {} });
    expect(response.status(), `${method.toUpperCase()} ${path}`).toBe(401);
  }
  await anonymous.dispose();
});

test("una sessione con l'utente cambiato ma la firma originale non vale", async ({ playwright, baseURL }) => {
  const login = await playwright.request.newContext({ baseURL });
  const token = await sessionCookie(login, USERS.viewer);
  const victim = await sessionCookie(login, USERS.owner);
  await login.dispose();

  const [, signature] = token.split(".");
  const victimClaims = JSON.parse(Buffer.from(victim.split(".")[0]!, "base64url").toString("utf8")) as { uid: string };
  const ownClaims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as { exp: number };
  const forgedPayload = Buffer.from(JSON.stringify({ uid: victimClaims.uid, exp: ownClaims.exp })).toString("base64url");

  const attempts = {
    "utente scambiato": `${forgedPayload}.${signature}`,
    "senza firma": forgedPayload,
    "firma vuota": `${forgedPayload}.`,
    "scadenza allungata": `${Buffer.from(JSON.stringify({ ...ownClaims, exp: ownClaims.exp + 10 ** 8 })).toString("base64url")}.${signature}`,
    "spazzatura": "%%%.%%%",
  };
  for (const [name, value] of Object.entries(attempts)) {
    const forged = await playwright.request.newContext({
      baseURL,
      extraHTTPHeaders: { cookie: `sestante_session=${value}` },
    });
    expect((await forged.get("/api/me")).status(), name).toBe(401);
    await forged.dispose();
  }
});

test("il cookie di sessione non è leggibile da JavaScript e non parte verso altri siti", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const response = await request.post("/api/auth/login", { data: { email: USERS.owner, password: DEMO_PASSWORD } });
  const cookie = (response.headers()["set-cookie"] ?? "").split("\n").find((c) => c.startsWith("sestante_session="));
  expect(cookie).toBeDefined();
  expect(cookie).toMatch(/;\s*HttpOnly/i);
  expect(cookie).toMatch(/;\s*SameSite=Lax/i);
  expect(cookie).toMatch(/;\s*Path=\//i);
  await request.dispose();
});

test("dopo l'uscita il vecchio cookie non serve più a nulla nel browser", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: USERS.owner, password: DEMO_PASSWORD } });
  expect((await page.request.get("/api/me")).status()).toBe(200);
  await page.request.post("/api/auth/logout");
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("la risposta a credenziali errate non rivela se l'account esiste", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const existing = await request.post("/api/auth/login", { data: { email: USERS.colleague, password: "sbagliata-2026" } });
  const missing = await request.post("/api/auth/login", { data: { email: "nessuno@example.org", password: "sbagliata-2026" } });
  expect(existing.status()).toBe(401);
  expect(missing.status()).toBe(401);
  expect(await existing.json()).toEqual(await missing.json());
  await request.dispose();
});

test("dopo troppi tentativi sbagliati l'account si blocca, anche con la password giusta", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const email = `forza-bruta-${Date.now()}@example.org`;
  const password = "password-sicura-2026";
  expect((await request.post("/api/auth/register", { data: { email, password, displayName: "Bersaglio" } })).status()).toBe(201);
  await request.post("/api/auth/logout");

  const statuses: number[] = [];
  for (let i = 0; i < 10; i++) {
    statuses.push((await request.post("/api/auth/login", { data: { email, password: `tentativo-${i}` } })).status());
  }
  expect(statuses.slice(0, 8).every((s) => s === 401), statuses.join(",")).toBe(true);
  expect(statuses.slice(8).every((s) => s === 429), statuses.join(",")).toBe(true);
  expect((await request.post("/api/auth/login", { data: { email, password } })).status()).toBe(429);
  await request.dispose();
});

test("la registrazione rifiuta password deboli e account già esistenti", async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  const weak = await request.post("/api/auth/register", { data: { email: `debole-${Date.now()}@example.org`, password: "123" } });
  expect(weak.status()).toBe(400);
  const taken = await request.post("/api/auth/register", { data: { email: USERS.owner, password: "password-sicura-2026" } });
  expect(taken.status()).toBe(409);
  // Il conflitto non deve aver toccato l'account esistente.
  expect((await request.post("/api/auth/login", { data: { email: USERS.owner, password: DEMO_PASSWORD } })).status()).toBe(200);
  await request.dispose();
});
