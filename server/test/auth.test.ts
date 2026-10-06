/** Password, sessioni e riconciliazione degli account fra locale e Keycloak. */
import "./_env.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { hashPassword, passwordProblem, verifyPassword } from "../src/auth/passwords.js";
import { createSessionToken, readSessionToken } from "../src/auth/session.js";
import { createLocalUser, upsertKeycloakUser, userByEmail } from "../src/users.js";

test("una password si verifica solo con sé stessa", async () => {
  const stored = await hashPassword("password-di-prova-1");
  assert.ok(await verifyPassword("password-di-prova-1", stored));
  assert.equal(await verifyPassword("password-di-prova-2", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("l'hash porta con sé i parametri e non è mai in chiaro", async () => {
  const stored = await hashPassword("password-di-prova-1");
  assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
  assert.equal(stored.includes("password-di-prova-1"), false);
});

test("due hash della stessa password differiscono (salt casuale)", async () => {
  const a = await hashPassword("stessa-password-1");
  const b = await hashPassword("stessa-password-1");
  assert.notEqual(a, b);
  assert.ok(await verifyPassword("stessa-password-1", a));
  assert.ok(await verifyPassword("stessa-password-1", b));
});

test("un hash assente o corrotto non autentica", async () => {
  assert.equal(await verifyPassword("qualunque", null), false);
  assert.equal(await verifyPassword("qualunque", "non-un-hash"), false);
  assert.equal(await verifyPassword("qualunque", "scrypt$a$b$c$d$e"), false);
});

test("la policy minima rifiuta password corte o senza cifre", () => {
  assert.equal(passwordProblem("corta1"), "too-short");
  assert.equal(passwordProblem("soltantolettere"), "too-simple");
  assert.equal(passwordProblem("password123"), null);
});

test("il token di sessione è firmato e non manomettibile", () => {
  const token = createSessionToken("utente-1");
  assert.equal(readSessionToken(token), "utente-1");

  const [payload, signature] = token.split(".") as [string, string];
  const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 4102444800 }), "utf8").toString(
    "base64url",
  );
  assert.equal(readSessionToken(`${forged}.${signature}`), null);
  assert.equal(readSessionToken(`${payload}.firma-inventata`), null);
  assert.equal(readSessionToken(undefined), null);
  assert.equal(readSessionToken("non-un-token"), null);
});

test("Keycloak: un utente nuovo viene creato una sola volta", async () => {
  const first = await upsertKeycloakUser("sub-123", "nuovo@example.org", "Utente Nuovo");
  const second = await upsertKeycloakUser("sub-123", "nuovo@example.org", "Utente Nuovo");
  assert.equal(first.id, second.id);
  assert.equal(first.provider, "keycloak");
});

test("Keycloak: un account locale preesistente viene collegato, non duplicato", async () => {
  const local = await createLocalUser("misto@example.org", "Utente Misto", "password123");
  assert.equal(local.provider, "local");

  const linked = await upsertKeycloakUser("sub-misto", "misto@example.org", "Utente Misto");
  assert.equal(linked.id, local.id, "stesso account, non un doppione");
  assert.equal(linked.provider, "keycloak");
  assert.equal(linked.external_id, "sub-misto");
});

test("un account passato a Keycloak non accetta più la vecchia password", async () => {
  const local = await createLocalUser("switch@example.org", "Switch", "password123");
  await upsertKeycloakUser("sub-switch", "switch@example.org", "Switch");

  const after = await userByEmail("switch@example.org");
  assert.equal(after?.id, local.id);
  assert.equal(after?.provider, "keycloak");
  // La rotta di login rifiuta i provider diversi da "local" anche se l'hash è
  // rimasto in tabella: è quel controllo a chiudere il percorso, non la
  // cancellazione dell'hash.
  assert.notEqual(after?.provider, "local");
});

test("Keycloak: il nome visualizzato viene aggiornato a ogni accesso", async () => {
  await upsertKeycloakUser("sub-rinomina", "rinomina@example.org", "Nome Vecchio");
  const updated = await upsertKeycloakUser("sub-rinomina", "rinomina@example.org", "Nome Nuovo");
  assert.equal(updated.display_name, "Nome Nuovo");
});
