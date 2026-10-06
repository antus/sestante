/**
 * Requisito: chi condivide una mappa la modifica insieme agli altri in tempo
 * reale, ognuno con il proprio ruolo e con la propria identità.
 *
 * Uno scenario in sequenza, con tre persone in tre browser distinti sulla
 * stessa mappa: proprietario (host), editor (scrive), lettore (guarda).
 */
import { expect, test, type Browser } from "@playwright/test";
import {
  addLayerInMap,
  createMap,
  mapLayers,
  openMap,
  presence,
  relayFrames,
  savedLayerIds,
  share,
  signIn,
  USERS,
  watchMapState,
  type Actor,
} from "../support/helpers";

test.describe.configure({ mode: "serial" });

let owner: Actor;
let editor: Actor;
let viewer: Actor;
let mapId: string;

async function join(browser: Browser, email: string): Promise<Actor> {
  const actor = await signIn(browser, email);
  await watchMapState(actor.page);
  return actor;
}

test.beforeAll(async ({ browser }) => {
  owner = await join(browser, USERS.owner);
  editor = await join(browser, USERS.editor);
  viewer = await join(browser, USERS.viewer);
  mapId = await createMap(owner, `Collaborazione ${Date.now()}`);
  await share(owner, mapId, USERS.editor, "editor");
  await share(owner, mapId, USERS.viewer, "viewer");
});

test.afterAll(async () => {
  for (const actor of [owner, editor, viewer]) await actor?.context.close();
});

test("chi apre la mappa entra da solo nella sessione, con il ruolo e l'identità di Sestante", async () => {
  // Il proprietario apre per primo: è lui a creare la sessione.
  await openMap(owner.page, mapId);
  await expect(presence(owner.page)).toHaveText("1 connesso", { timeout: 30_000 });
  await openMap(editor.page, mapId);
  await openMap(viewer.page, mapId);

  for (const actor of [owner, editor, viewer]) {
    await expect(presence(actor.page)).toHaveText("3 connessi", { timeout: 30_000 });
    // Il dialogo "Collabora" di GeoLibre si è aperto, compilato e chiuso da sé.
    const frame = actor.page.frames().find((f) => f.url().includes("/gis/"));
    expect(await frame?.evaluate(() => Boolean(document.getElementById("collab-name")))).toBe(false);
  }

  const roleOf = async (actor: Actor) => (await relayFrames(actor.page)).find((f) => f.type === "welcome")?.role;
  expect(await roleOf(owner)).toBe("host");
  expect(await roleOf(editor)).toBe("guest");
  expect(await roleOf(viewer)).toBe("guest");

  // Ognuno è nella sessione con l'identità firmata da Sestante, non con un nome
  // scelto da sé.
  const frames = await relayFrames(owner.page);
  const participants = [...frames].reverse().find((f) => f.participants)?.participants as {
    identity?: { userId: string; username: string } | null;
  }[];
  const people = participants.filter((p) => p.identity?.userId !== "sestante:server");
  expect(people).toHaveLength(3);
  for (const person of people) expect(person.identity?.userId).toBeTruthy();
});

test("le modifiche dell'editor arrivano a tutti e vengono salvate", async () => {
  await addLayerInMap(editor.page, "livello-editor");

  await expect.poll(() => mapLayers(owner.page)).toContain("livello-editor");
  await expect.poll(() => mapLayers(viewer.page)).toContain("livello-editor");
  await expect.poll(() => savedLayerIds(owner, mapId), { timeout: 10_000 }).toContain("livello-editor");
});

test("le modifiche di un lettore non arrivano a nessuno e non vengono salvate", async () => {
  await addLayerInMap(viewer.page, "livello-lettore");
  // Il relay rifiuta lo snapshot: si lascia il tempo di una propagazione vera.
  await owner.page.waitForTimeout(4000);

  expect(await mapLayers(owner.page)).not.toContain("livello-lettore");
  expect(await mapLayers(editor.page)).not.toContain("livello-lettore");
  expect(await savedLayerIds(owner, mapId)).not.toContain("livello-lettore");
});

test("un editor declassato esce dalla sessione e rientra solo in lettura", async () => {
  const shares = (await (await owner.page.request.get(`/api/maps/${mapId}/shares`)).json()) as {
    people: { shareId: string; user: { email: string } }[];
  };
  const shareId = shares.people.find((p) => p.user.email === USERS.editor)?.shareId as string;
  const patch = await owner.page.request.patch(`/api/maps/${mapId}/shares/${shareId}`, { data: { role: "viewer" } });
  expect(patch.status()).toBe(200);

  // La sessione è sostituita: gli ospiti vengono fatti uscire con il motivo
  // che il client riconosce.
  await expect
    .poll(async () => (await relayFrames(editor.page)).some((f) => f.type === "kicked" && f.reason === "sestante:session-replaced"))
    .toBe(true);

  // Il proprietario riapre (crea la sessione nuova); gli altri rientrano da soli.
  await openMap(owner.page, mapId);
  await expect(presence(editor.page)).toHaveText("3 connessi", { timeout: 60_000 });

  await addLayerInMap(editor.page, "livello-ex-editor");
  await owner.page.waitForTimeout(4000);
  expect(await mapLayers(owner.page)).not.toContain("livello-ex-editor");
  expect(await savedLayerIds(owner, mapId)).not.toContain("livello-ex-editor");
});
