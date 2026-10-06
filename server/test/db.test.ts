/**
 * Il livello dati si comporta allo stesso modo su SQLite e su PostgreSQL.
 * Ogni test qui corrisponde a una differenza reale fra i due motori, che senza
 * attenzione darebbe un risultato diverso a seconda dell'installazione.
 */
import { engine } from "./_env.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { db, newId, now, toPgPlaceholders, type InviteRow, type MapRow, type UserRow } from "../src/db.js";
import { createLocalUser } from "../src/users.js";

const owner = await createLocalUser("db-owner@example.org", "Mario Rossi", "password123");
const guest = await createLocalUser("db-guest@example.org", "Anna Bianchi", "password123");

async function makeMap(): Promise<string> {
  const id = newId();
  await db().run(
    `INSERT INTO maps (id, owner_id, name, description, project_json, thumb,
                       general_access, general_role, created_at, updated_at)
     VALUES (?, ?, 'Mappa', '', NULL, 'italia', 'private', 'viewer', ?, ?)`,
    id,
    owner.id,
    now(),
    now(),
  );
  return id;
}

test(`[${engine}] i placeholder ? diventano $1, $2… per PostgreSQL`, () => {
  assert.equal(toPgPlaceholders("SELECT ? , ?, ?"), "SELECT $1 , $2, $3");
});

test(`[${engine}] i tempi in millisecondi tornano come number esatti`, async () => {
  // In PostgreSQL INTEGER è a 32 bit: Date.now() ci sta solo in BIGINT, e pg
  // lo restituirebbe come stringa senza il parser configurato in db.ts.
  const id = await makeMap();
  const at = 1_790_000_000_123;
  await db().run("UPDATE maps SET updated_at = ? WHERE id = ?", at, id);
  const map = await db().get<MapRow>("SELECT * FROM maps WHERE id = ?", id);
  assert.equal(map?.updated_at, at);
  assert.equal(typeof map?.updated_at, "number");
});

test(`[${engine}] run restituisce il numero di righe toccate`, async () => {
  const id = await makeMap();
  assert.equal((await db().run("UPDATE maps SET name = ? WHERE id = ?", "Nuovo", id)).changes, 1);
  assert.equal((await db().run("UPDATE maps SET name = ? WHERE id = ?", "Nuovo", "nessuna")).changes, 0);
});

test(`[${engine}] l'upsert delle condivisioni aggiorna il ruolo invece di duplicare`, async () => {
  const id = await makeMap();
  const upsert = (role: string) =>
    db().run(
      `INSERT INTO shares (id, map_id, user_id, role, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
      newId(),
      id,
      guest.id,
      role,
      now(),
      owner.id,
    );
  await upsert("viewer");
  await upsert("editor");
  const rows = await db().all<{ role: string }>("SELECT role FROM shares WHERE map_id = ?", id);
  assert.deepEqual(
    rows.map((r) => r.role),
    ["editor"],
  );
});

test(`[${engine}] gli alias distinguono id della condivisione e id dell'utente`, async () => {
  const id = await makeMap();
  const shareId = newId();
  await db().run(
    "INSERT INTO shares (id, map_id, user_id, role, created_at, created_by) VALUES (?, ?, ?, 'viewer', ?, ?)",
    shareId,
    id,
    guest.id,
    now(),
    owner.id,
  );
  const [row] = await db().all<UserRow & { share_id: string }>(
    `SELECT u.*, s.id AS share_id FROM shares s JOIN users u ON u.id = s.user_id WHERE s.map_id = ?`,
    id,
  );
  assert.equal(row?.share_id, shareId);
  assert.equal(row?.id, guest.id);
});

test(`[${engine}] la ricerca utenti ignora le maiuscole su entrambi i motori`, async () => {
  const pattern = "%bianchi%";
  const rows = await db().all<UserRow>(
    "SELECT * FROM users WHERE LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?",
    pattern,
    pattern,
  );
  assert.ok(rows.some((r) => r.id === guest.id), "«Anna Bianchi» trovata cercando «bianchi»");
});

test(`[${engine}] NULL resta null, anche passando undefined`, async () => {
  const id = await makeMap();
  const token = newId();
  await db().run(
    `INSERT INTO invites (token, map_id, role, expires_at, max_uses, uses, created_at, created_by)
     VALUES (?, ?, 'viewer', ?, ?, 0, ?, ?)`,
    token,
    id,
    null,
    undefined,
    now(),
    owner.id,
  );
  const invite = await db().get<InviteRow>("SELECT * FROM invites WHERE token = ?", token);
  assert.equal(invite?.expires_at, null);
  assert.equal(invite?.max_uses, null);
  assert.equal(invite?.uses, 0);
});

test(`[${engine}] la cancellazione di una mappa porta via le righe collegate`, async () => {
  const id = await makeMap();
  await db().run(
    "INSERT INTO shares (id, map_id, user_id, role, created_at, created_by) VALUES (?, ?, ?, 'viewer', ?, ?)",
    newId(),
    id,
    guest.id,
    now(),
    owner.id,
  );
  await db().run("DELETE FROM maps WHERE id = ?", id);
  const left = await db().all("SELECT * FROM shares WHERE map_id = ?", id);
  assert.equal(left.length, 0, "ON DELETE CASCADE attivo (in SQLite serve PRAGMA foreign_keys)");
});
