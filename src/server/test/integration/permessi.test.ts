/**
 * La matrice dei permessi completa, attraverso le rotte HTTP: per ogni modo di
 * accedere a una mappa, per ogni persona e per ogni azione, il codice che il
 * server deve rispondere. È la stessa regola di acl.ts vista da fuori, dove un
 * errore diventa un accesso che non doveva esserci.
 */
import "../_env.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { anonymous, FEATURES, signedIn, type Client } from "./_app.js";

type Access = "private" | "org" | "link";
type General = "viewer" | "editor";
type Role = "owner" | "editor" | "viewer" | null;

const owner = await signedIn("proprietaria@example.org");
const editor = await signedIn("editor@example.org");
const viewer = await signedIn("lettore@example.org");
const colleague = await signedIn("collega@example.org");
const outsider = await signedIn("esterno@example.net");
const nobody = anonymous();

const ACTORS: [string, Client][] = [
  ["proprietaria", owner],
  ["editor invitato", editor],
  ["lettore invitato", viewer],
  ["collega dell'organizzazione", colleague],
  ["esterno", outsider],
  ["anonimo", nobody],
];

/** Il ruolo atteso: condivisione esplicita prima, poi l'accesso generale. */
function expectedRole(actor: Client, access: Access, general: General): Role {
  if (actor === owner) return "owner";
  if (actor === editor) return "editor";
  if (actor === viewer) return "viewer";
  if (access === "link") return general;
  if (access === "org" && actor === colleague) return general;
  return null;
}

/** Il codice atteso per ogni azione, dato chi la chiede e con quale ruolo. */
const ACTIONS: {
  name: string;
  needsLogin: boolean;
  allowed: (role: Exclude<Role, null>) => boolean;
  ok: number;
  run: (actor: Client, mapId: string, fileId: string) => Promise<{ status: number }>;
}[] = [
  { name: "leggere", needsLogin: false, allowed: () => true, ok: 200, run: (a, m) => a.call("GET", `/api/maps/${m}`) },
  { name: "elencare i file", needsLogin: false, allowed: () => true, ok: 200, run: (a, m) => a.call("GET", `/api/maps/${m}/files`) },
  { name: "scaricare un file", needsLogin: false, allowed: () => true, ok: 200, run: (a, m, f) => a.call("GET", `/api/maps/${m}/files/${f}`) },
  { name: "leggere l'attività", needsLogin: false, allowed: () => true, ok: 200, run: (a, m) => a.call("GET", `/api/maps/${m}/activity`) },
  { name: "vedere le condivisioni", needsLogin: false, allowed: () => true, ok: 200, run: (a, m) => a.call("GET", `/api/maps/${m}/shares`) },
  {
    name: "modificare",
    needsLogin: true,
    allowed: (r) => r !== "viewer",
    ok: 200,
    run: (a, m) => a.call("PATCH", `/api/maps/${m}`, { name: `da ${a.email}` }),
  },
  {
    name: "caricare un file",
    needsLogin: true,
    allowed: (r) => r !== "viewer",
    ok: 201,
    run: (a, m) => a.call("POST", `/api/maps/${m}/files`, { name: "p.geojson", geojson: FEATURES }),
  },
  {
    name: "condividere",
    needsLogin: true,
    allowed: (r) => r === "owner",
    ok: 201,
    run: (a, m) => a.call("POST", `/api/maps/${m}/shares`, { email: "nuovo@example.org", role: "viewer" }),
  },
  {
    name: "cambiare l'accesso generale",
    needsLogin: true,
    allowed: (r) => r === "owner",
    ok: 200,
    // Lo stesso valore che ha già: la matrice non deve cambiare sotto i piedi.
    run: async (a, m) => {
      const current = (await owner.call("GET", `/api/maps/${m}/shares`)).body;
      return a.call("PATCH", `/api/maps/${m}/access`, { generalAccess: current.generalAccess, generalRole: current.generalRole });
    },
  },
  {
    name: "creare un invito",
    needsLogin: true,
    allowed: (r) => r === "owner",
    ok: 201,
    run: (a, m) => a.call("POST", `/api/maps/${m}/invites`, { role: "viewer" }),
  },
];

function expectedStatus(action: (typeof ACTIONS)[number], actor: Client, role: Role): number {
  if (action.needsLogin && actor === nobody) return 401;
  if (role === null) return 404;
  return action.allowed(role) ? action.ok : 403;
}

async function prepareMap(access: Access, general: General): Promise<{ mapId: string; fileId: string }> {
  const created = await owner.call("POST", "/api/maps", { name: `${access}/${general}` });
  const mapId = created.body.map.id as string;
  await owner.call("POST", `/api/maps/${mapId}/shares`, { email: editor.email, role: "editor" });
  await owner.call("POST", `/api/maps/${mapId}/shares`, { email: viewer.email, role: "viewer" });
  await owner.call("PATCH", `/api/maps/${mapId}/access`, { generalAccess: access, generalRole: general });
  const file = await owner.call("POST", `/api/maps/${mapId}/files`, { name: "base.geojson", geojson: FEATURES });
  return { mapId, fileId: file.body.file.id as string };
}

const CONFIGURATIONS: [Access, General][] = [
  ["private", "viewer"],
  ["org", "viewer"],
  ["org", "editor"],
  ["link", "viewer"],
  ["link", "editor"],
];

for (const [access, general] of CONFIGURATIONS) {
  test(`mappa con accesso ${access}${access === "private" ? "" : ` (${general})`}`, async () => {
    const { mapId, fileId } = await prepareMap(access, general);
    const wrong: string[] = [];
    for (const [who, actor] of ACTORS) {
      const role = expectedRole(actor, access, general);
      for (const action of ACTIONS) {
        const want = expectedStatus(action, actor, role);
        const got = (await action.run(actor, mapId, fileId)).status;
        if (got !== want) wrong.push(`${who} · ${action.name}: ${got} invece di ${want}`);
      }
    }
    assert.deepEqual(wrong, []);
  });
}

test("solo la proprietaria cancella, e dopo la mappa non esiste per nessuno", async () => {
  const { mapId } = await prepareMap("link", "editor");
  for (const actor of [editor, viewer, colleague, outsider]) {
    assert.equal((await actor.call("DELETE", `/api/maps/${mapId}`)).status, 403, actor.email);
  }
  assert.equal((await nobody.call("DELETE", `/api/maps/${mapId}`)).status, 401);
  assert.equal((await owner.call("DELETE", `/api/maps/${mapId}`)).status, 200);
  for (const [who, actor] of ACTORS) {
    assert.equal((await actor.call("GET", `/api/maps/${mapId}`)).status, 404, who);
  }
});

test("togliere una condivisione toglie l'accesso", async () => {
  const { mapId } = await prepareMap("private", "viewer");
  const shares = (await owner.call("GET", `/api/maps/${mapId}/shares`)).body;
  const share = shares.people.find((p: { user: { email: string } }) => p.user.email === editor.email);
  assert.equal((await owner.call("DELETE", `/api/maps/${mapId}/shares/${share.shareId}`)).status, 200);
  assert.equal((await editor.call("GET", `/api/maps/${mapId}`)).status, 404);
});

test("abbassare un editor a lettore chiude la scrittura", async () => {
  const { mapId } = await prepareMap("private", "viewer");
  const shares = (await owner.call("GET", `/api/maps/${mapId}/shares`)).body;
  const share = shares.people.find((p: { user: { email: string } }) => p.user.email === editor.email);
  assert.equal((await owner.call("PATCH", `/api/maps/${mapId}/shares/${share.shareId}`, { role: "viewer" })).status, 200);
  assert.equal((await editor.call("PATCH", `/api/maps/${mapId}`, { name: "no" })).status, 403);
  assert.equal((await editor.call("GET", `/api/maps/${mapId}`)).status, 200);
});
