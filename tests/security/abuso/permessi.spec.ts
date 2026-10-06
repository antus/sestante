/**
 * Abusi dei permessi: arrivare a mappe e file altrui conoscendone gli
 * identificativi, fare più di quanto il proprio ruolo consente, riusare inviti.
 * Le richieste partono dalle API, come le farebbe chi manomette il client.
 */
import { expect, test } from "@playwright/test";
import { createMap, FEATURE_COLLECTION, share, signIn, USERS, type Actor } from "../../e2e/support/helpers";

async function upload(actor: Actor, mapId: string): Promise<{ id: string; url: string }> {
  const response = await actor.page.request.post(`/api/maps/${mapId}/files`, {
    data: { name: "punti.geojson", geojson: FEATURE_COLLECTION },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { file: { id: string; url: string } }).file;
}

test("chi non è invitato non arriva a nulla di una mappa privata, nemmeno sapendone l'id", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const outsider = await signIn(browser, USERS.outsider);
  const mapId = await createMap(owner, "Privata");
  const file = await upload(owner, mapId);
  const r = outsider.page.request;

  const attempts: [string, Promise<{ status(): number }>][] = [
    ["leggere la mappa", r.get(`/api/maps/${mapId}`)],
    ["modificarla", r.patch(`/api/maps/${mapId}`, { data: { name: "presa" } })],
    ["aprirne l'accesso", r.patch(`/api/maps/${mapId}/access`, { data: { generalAccess: "link", generalRole: "editor" } })],
    ["cancellarla", r.delete(`/api/maps/${mapId}`)],
    ["elencarne i file", r.get(`/api/maps/${mapId}/files`)],
    ["scaricare un file", r.get(`/api/maps/${mapId}/files/${file.id}`)],
    ["cancellare un file", r.delete(`/api/maps/${mapId}/files/${file.id}`)],
    ["vederne le condivisioni", r.get(`/api/maps/${mapId}/shares`)],
    ["condividerla con sé", r.post(`/api/maps/${mapId}/shares`, { data: { email: USERS.outsider, role: "editor" } })],
    ["crearsi un invito", r.post(`/api/maps/${mapId}/invites`, { data: { role: "editor" } })],
    ["leggerne l'attività", r.get(`/api/maps/${mapId}/activity`)],
    ["aprirne la sessione collaborativa", r.post(`/api/maps/${mapId}/collab/session`)],
  ];
  for (const [what, call] of attempts) {
    // 404 e non 403: per chi non ha accesso la mappa non esiste.
    expect((await call).status(), what).toBe(404);
  }

  const still = await owner.page.request.get(`/api/maps/${mapId}`);
  expect(still.status()).toBe(200);
  expect(((await still.json()) as { map: { name: string } }).map.name).toBe("Privata");
  await owner.context.close();
  await outsider.context.close();
});

test("un lettore non scrive: né la mappa, né i file, né le condivisioni", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const viewer = await signIn(browser, USERS.viewer);
  const mapId = await createMap(owner, "Da leggere");
  const file = await upload(owner, mapId);
  await share(owner, mapId, USERS.viewer, "viewer");
  const r = viewer.page.request;

  expect((await r.get(`/api/maps/${mapId}`)).status()).toBe(200);
  expect((await r.patch(`/api/maps/${mapId}`, { data: { name: "cambiata" } })).status()).toBe(403);
  expect((await r.patch(`/api/maps/${mapId}`, { data: { project: { layers: [] } } })).status()).toBe(403);
  expect((await r.post(`/api/maps/${mapId}/files`, { data: { name: "x.geojson", geojson: FEATURE_COLLECTION } })).status()).toBe(403);
  expect((await r.delete(`/api/maps/${mapId}/files/${file.id}`)).status()).toBe(403);
  expect((await r.post(`/api/maps/${mapId}/shares`, { data: { email: USERS.colleague, role: "editor" } })).status()).toBe(403);
  expect((await r.delete(`/api/maps/${mapId}`)).status()).toBe(403);
  // Il file c'è ancora.
  expect((await owner.page.request.get(`/api/maps/${mapId}/files/${file.id}`)).status()).toBe(200);
  await owner.context.close();
  await viewer.context.close();
});

test("un editor non si promuove: niente gestione degli accessi né cancellazione", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const editor = await signIn(browser, USERS.editor);
  const mapId = await createMap(owner, "Con editor");
  await share(owner, mapId, USERS.editor, "editor");
  const r = editor.page.request;

  const shares = (await (await owner.page.request.get(`/api/maps/${mapId}/shares`)).json()) as {
    people: { shareId: string; user: { email: string } }[];
  };
  const editorShare = shares.people.find((s) => s.user.email === USERS.editor);
  expect(editorShare).toBeDefined();

  expect((await r.patch(`/api/maps/${mapId}`, { data: { name: "si può" } })).status()).toBe(200);
  expect((await r.post(`/api/maps/${mapId}/shares`, { data: { email: USERS.colleague, role: "editor" } })).status()).toBe(403);
  expect((await r.patch(`/api/maps/${mapId}/shares/${editorShare!.shareId}`, { data: { role: "editor" } })).status()).toBe(403);
  expect((await r.delete(`/api/maps/${mapId}/shares/${editorShare!.shareId}`)).status()).toBe(403);
  expect((await r.patch(`/api/maps/${mapId}/access`, { data: { generalAccess: "link", generalRole: "editor" } })).status()).toBe(403);
  expect((await r.post(`/api/maps/${mapId}/invites`, { data: { role: "editor" } })).status()).toBe(403);
  expect((await r.delete(`/api/maps/${mapId}`)).status()).toBe(403);
  await owner.context.close();
  await editor.context.close();
});

test("un file si raggiunge solo dalla sua mappa, anche con l'id giusto", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const editor = await signIn(browser, USERS.editor);
  const secretMap = await createMap(owner, "Con file riservato");
  const secretFile = await upload(owner, secretMap);
  // L'editor ha una mappa sua, e prova a usarla come passe-partout.
  const ownMap = await createMap(editor, "Dell'editor");

  expect((await editor.page.request.get(`/api/maps/${ownMap}/files/${secretFile.id}`)).status()).toBe(404);
  const del = await editor.page.request.delete(`/api/maps/${ownMap}/files/${secretFile.id}`);
  expect(del.status()).toBe(404);
  // Né un percorso relativo né un secret di un altro file aprono la porta.
  const traversal = await editor.page.request.delete(
    `/api/maps/${ownMap}/files/${encodeURIComponent(`../${secretMap}/${secretFile.id}`)}`,
  );
  expect(traversal.status()).toBe(404);
  const k = new URL(secretFile.url).searchParams.get("k");
  expect((await editor.page.request.get(`/api/maps/${ownMap}/files/${secretFile.id}?k=${k}`)).status()).toBe(404);

  expect((await owner.page.request.get(`/api/maps/${secretMap}/files/${secretFile.id}`)).status()).toBe(200);
  await owner.context.close();
  await editor.context.close();
});

test("il link di un file vale solo con il suo segreto", async ({ browser, playwright, baseURL }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "File col segreto");
  const file = await upload(owner, mapId);
  const anonymous = await playwright.request.newContext({ baseURL });
  const url = new URL(file.url);

  expect((await anonymous.get(`${url.pathname}${url.search}`)).status()).toBe(200);
  expect((await anonymous.get(url.pathname)).status()).toBe(404);
  expect((await anonymous.get(`${url.pathname}?k=sbagliato`)).status()).toBe(404);
  expect((await anonymous.get(`${url.pathname}?k=`)).status()).toBe(404);
  await anonymous.dispose();
  await owner.context.close();
});

test("un invito esaurito, revocato o inventato non dà accesso", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const first = await signIn(browser, USERS.colleague);
  const second = await signIn(browser, USERS.outsider);
  const mapId = await createMap(owner, "Inviti");

  const once = (await (await owner.page.request.post(`/api/maps/${mapId}/invites`, { data: { role: "viewer", maxUses: 1 } })).json()) as {
    token: string;
  };
  expect((await first.page.request.post(`/api/invites/${once.token}/redeem`)).status()).toBe(200);
  expect((await second.page.request.post(`/api/invites/${once.token}/redeem`)).status()).toBe(410);

  const revoked = (await (await owner.page.request.post(`/api/maps/${mapId}/invites`, { data: { role: "editor" } })).json()) as {
    token: string;
  };
  expect((await owner.page.request.delete(`/api/maps/${mapId}/invites/${revoked.token}`)).status()).toBe(200);
  expect((await second.page.request.post(`/api/invites/${revoked.token}/redeem`)).status()).toBe(404);
  expect((await second.page.request.post(`/api/invites/${"A".repeat(24)}/redeem`)).status()).toBe(404);

  expect((await second.page.request.get(`/api/maps/${mapId}`)).status()).toBe(404);
  await Promise.all([owner, first, second].map((a) => a.context.close()));
});
