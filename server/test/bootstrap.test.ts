/**
 * L'utente di default: creato al primo avvio, solo a database vuoto, con la
 * password configurata o quella documentata per la modalità local.
 */
import { engine } from "./_env.js";
import { strict as assert } from "node:assert";
import { afterEach, test } from "node:test";
import { db, type UserRow } from "../src/db.js";
import { ensureDefaultUser, LOCAL_DEFAULT_PASSWORD } from "../src/bootstrap.js";
import { verifyPassword } from "../src/auth/passwords.js";
import { createLocalUser, userByEmail } from "../src/users.js";

const KEYS = ["DEFAULT_USER", "DEFAULT_USER_EMAIL", "DEFAULT_USER_NAME", "DEFAULT_USER_PASSWORD"];

afterEach(async () => {
  for (const key of KEYS) delete process.env[key];
  await db().run("DELETE FROM users");
});

test(`[${engine}] a database vuoto crea l'amministratore con la password documentata`, async () => {
  const report = await ensureDefaultUser();
  assert.deepEqual(report, {
    email: "admin@example.org",
    password: LOCAL_DEFAULT_PASSWORD,
    generated: false,
    configured: false,
  });
  const user = (await userByEmail("admin@example.org")) as UserRow;
  assert.equal(user.provider, "local");
  assert.equal(user.display_name, "Amministratore");
  assert.ok(await verifyPassword(LOCAL_DEFAULT_PASSWORD, user.password_hash));
});

test(`[${engine}] con utenti già presenti non crea nulla`, async () => {
  await createLocalUser("qualcuno@example.org", "Qualcuno", "password123");
  assert.equal(await ensureDefaultUser(), null);
  assert.equal(await userByEmail("admin@example.org"), null);
});

test(`[${engine}] email, nome e password si configurano`, async () => {
  process.env.DEFAULT_USER_EMAIL = "Capo@Example.org";
  process.env.DEFAULT_USER_NAME = "Capo Progetto";
  process.env.DEFAULT_USER_PASSWORD = "una-password-2026";
  const report = await ensureDefaultUser();
  assert.equal(report?.email, "capo@example.org");
  assert.equal(report?.configured, true, "una password configurata non si scrive nel log");
  const user = (await userByEmail("capo@example.org")) as UserRow;
  assert.equal(user.display_name, "Capo Progetto");
  assert.ok(await verifyPassword("una-password-2026", user.password_hash));
});

test(`[${engine}] una password debole ferma l'avvio invece di creare un account fragile`, async () => {
  process.env.DEFAULT_USER_PASSWORD = "corta";
  await assert.rejects(ensureDefaultUser(), /DEFAULT_USER_PASSWORD non valida/);
  assert.equal(await userByEmail("admin@example.org"), null);
});

test(`[${engine}] DEFAULT_USER=off non crea nessun utente`, async () => {
  process.env.DEFAULT_USER = "off";
  assert.equal(await ensureDefaultUser(), null);
  const count = await db().get<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  assert.equal(Number(count?.n), 0);
});
