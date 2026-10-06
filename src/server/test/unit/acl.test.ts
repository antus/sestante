/**
 * I permessi sono la parte in cui un errore non si vede finché non è un danno:
 * un lettore che può scrivere, o una mappa privata che compare a un collega.
 * Qui si verifica ogni combinazione di ruolo esplicito e accesso generale.
 */
import "../_env.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canEdit, canManageSharing, effectiveRole, loadMapFor } from "../../src/acl.js";
import { db, newId, now, type MapRow } from "../../src/db.js";
import { createLocalUser } from "../../src/users.js";

const owner = await createLocalUser("proprietario@example.org", "Proprietario", "password123");
const editor = await createLocalUser("editor@example.org", "Editor", "password123");
const viewer = await createLocalUser("lettore@example.org", "Lettore", "password123");
const colleague = await createLocalUser("collega@example.org", "Collega", "password123");
const outsider = await createLocalUser("esterno@example.net", "Esterno", "password123");

async function makeMap(
  access: "private" | "org" | "link",
  generalRole: "viewer" | "editor",
): Promise<MapRow> {
  const id = newId();
  await db().run(
    `INSERT INTO maps (id, owner_id, name, description, project_json, thumb,
                       general_access, general_role, created_at, updated_at)
     VALUES (?, ?, 'Mappa', '', NULL, 'italia', ?, ?, ?, ?)`,
    id,
    owner.id,
    access,
    generalRole,
    now(),
    now(),
  );
  await db().run(
    "INSERT INTO shares (id, map_id, user_id, role, created_at, created_by) VALUES (?, ?, ?, 'editor', ?, ?)",
    newId(),
    id,
    editor.id,
    now(),
    owner.id,
  );
  await db().run(
    "INSERT INTO shares (id, map_id, user_id, role, created_at, created_by) VALUES (?, ?, ?, 'viewer', ?, ?)",
    newId(),
    id,
    viewer.id,
    now(),
    owner.id,
  );
  return (await db().get<MapRow>("SELECT * FROM maps WHERE id = ?", id)) as MapRow;
}

test("il proprietario ha sempre il ruolo owner", async () => {
  const map = await makeMap("private", "viewer");
  assert.equal(await effectiveRole(map, owner), "owner");
  assert.ok(canEdit("owner"));
  assert.ok(canManageSharing("owner"));
});

test("la condivisione esplicita vince sull'accesso generale", async () => {
  // La mappa è pubblica in sola lettura, ma l'editor è invitato come editor:
  // il permesso più specifico deve prevalere.
  const map = await makeMap("link", "viewer");
  assert.equal(await effectiveRole(map, editor), "editor");
  assert.equal(await effectiveRole(map, viewer), "viewer");
});

test("mappa privata: chi non è invitato non la vede affatto", async () => {
  const map = await makeMap("private", "viewer");
  assert.equal(await effectiveRole(map, colleague), null);
  assert.equal(await effectiveRole(map, outsider), null);
  assert.equal(await effectiveRole(map, null), null);
});

test("accesso organizzazione: dentro sì, fuori no, anonimo no", async () => {
  const map = await makeMap("org", "viewer");
  assert.equal(await effectiveRole(map, colleague), "viewer", "stesso dominio email");
  assert.equal(await effectiveRole(map, outsider), null, "dominio diverso");
  assert.equal(await effectiveRole(map, null), null, "senza sessione");
});

test("accesso via link: vale anche senza utente autenticato", async () => {
  const map = await makeMap("link", "viewer");
  assert.equal(await effectiveRole(map, null), "viewer");
  assert.equal(await effectiveRole(map, outsider), "viewer");
});

test("accesso via link in scrittura: chiunque abbia il link può modificare", async () => {
  const map = await makeMap("link", "editor");
  assert.equal(await effectiveRole(map, outsider), "editor");
  assert.ok(canEdit(await effectiveRole(map, outsider)));
});

test("un lettore non può modificare né gestire la condivisione", () => {
  assert.equal(canEdit("viewer"), false);
  assert.equal(canManageSharing("viewer"), false);
  assert.equal(canManageSharing("editor"), false, "solo il proprietario gestisce gli accessi");
});

test("loadMapFor nasconde l'esistenza della mappa a chi non ha accesso", async () => {
  const map = await makeMap("private", "viewer");
  assert.equal((await loadMapFor(map.id, outsider)), null);
  assert.equal((await loadMapFor("id-inesistente", owner)), null);
  assert.equal((await loadMapFor(map.id, owner))?.role, "owner");
});
