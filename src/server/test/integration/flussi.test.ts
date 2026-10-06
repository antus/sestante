/**
 * I flussi principali attraverso le API: account, ciclo di vita di una mappa,
 * file, inviti, elenchi della dashboard. Le risposte sono quelle che il
 * client si aspetta (forma e contenuto), non solo i codici.
 */
import "../_env.js";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { stripBase } from "../../src/app.js";
import { anonymous, FEATURES, PASSWORD, server, signedIn } from "./_app.js";

test("registrazione, accesso, profilo e uscita", async () => {
  const app = await server();
  const email = "nuova@example.org";
  const registered = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: { email: "  Nuova@Example.org ", password: PASSWORD, displayName: "Nuova Persona" },
  });
  assert.equal(registered.statusCode, 201);
  assert.equal(registered.json().user.email, email, "email normalizzata");
  assert.equal(JSON.stringify(registered.json()).includes("password"), false, "nessun hash nella risposta");

  const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
  const cookie = login.cookies.find((c) => c.name === "sestante_session")!;
  const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: `sestante_session=${cookie.value}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.displayName, "Nuova Persona");

  const logout = await app.inject({ method: "POST", url: "/api/auth/logout" });
  const cleared = logout.cookies.find((c) => c.name === "sestante_session");
  assert.ok(cleared && (cleared.value === "" || (cleared.expires && cleared.expires.getTime() < Date.now())));
});

test("ciclo di vita di una mappa: crea, elenca, salva il progetto, riapre, cancella", async () => {
  const anna = await signedIn("anna@example.org");
  const created = await anna.call("POST", "/api/maps", { name: "  Rilievi 2026  ", description: "Campagna" });
  assert.equal(created.status, 201);
  const map = created.body.map;
  assert.equal(map.name, "Rilievi 2026");
  assert.equal(map.role, "owner");

  const project = { layers: [{ id: "l1", name: "Punti" }], view: { center: [12.5, 41.9], zoom: 9 } };
  assert.equal((await anna.call("PATCH", `/api/maps/${map.id}`, { project })).status, 200);

  const reopened = await anna.call("GET", `/api/maps/${map.id}`);
  assert.deepEqual(reopened.body.project, project);

  const mine = await anna.call("GET", "/api/maps?scope=mine");
  assert.ok(mine.body.items.some((m: { id: string }) => m.id === map.id));

  assert.equal((await anna.call("DELETE", `/api/maps/${map.id}`)).status, 200);
  const after = await anna.call("GET", "/api/maps?scope=mine");
  assert.equal(after.body.items.some((m: { id: string }) => m.id === map.id), false);
});

test("un nome vuoto diventa «Mappa senza titolo»", async () => {
  const bruno = await signedIn("bruno@example.org");
  assert.equal((await bruno.call("POST", "/api/maps", { name: "   " })).body.map.name, "Mappa senza titolo");
});

test("un progetto oltre i 10 MB si rifiuta con il suo codice", async () => {
  const carla = await signedIn("carla@example.org");
  const { body } = await carla.call("POST", "/api/maps", { name: "Pesante" });
  const huge = { layers: [], pad: "x".repeat(10 * 1024 * 1024 + 1) };
  const response = await carla.call("PATCH", `/api/maps/${body.map.id}`, { project: huge });
  assert.equal(response.status, 413);
  assert.equal(response.body.error, "project-too-large");
});

test("file: caricamento, elenco, link col segreto, cancellazione", async () => {
  const dario = await signedIn("dario@example.org");
  const { body } = await dario.call("POST", "/api/maps", { name: "Con file" });
  const mapId = body.map.id as string;

  const uploaded = await dario.call("POST", `/api/maps/${mapId}/files`, { name: "../../etc/punti.geojson", geojson: FEATURES });
  assert.equal(uploaded.status, 201);
  const file = uploaded.body.file;
  assert.equal(file.name.includes("/"), false, "niente separatori di percorso nel nome");
  assert.match(file.url, new RegExp(`/api/maps/${mapId}/files/${file.id}\\?k=`));

  const listed = await dario.call("GET", `/api/maps/${mapId}/files`);
  assert.deepEqual(listed.body.items.map((f: { id: string }) => f.id), [file.id]);

  const url = new URL(file.url);
  const download = await anonymous().call("GET", `${url.pathname}${url.search}`);
  assert.equal(download.status, 200);
  assert.deepEqual(download.body, FEATURES, "riserializzato, identico nel contenuto");

  assert.equal((await dario.call("DELETE", `/api/maps/${mapId}/files/${file.id}`)).status, 200);
  assert.equal((await anonymous().call("GET", `${url.pathname}${url.search}`)).status, 404);
  assert.equal((await dario.call("DELETE", `/api/maps/${mapId}/files/${file.id}`)).status, 404, "già cancellato");
});

test("invito: dà il suo ruolo, si consuma, compare fra le condivise", async () => {
  const elena = await signedIn("elena@example.org");
  const franco = await signedIn("franco@example.org");
  const { body } = await elena.call("POST", "/api/maps", { name: "Su invito" });
  const mapId = body.map.id as string;

  const invite = await elena.call("POST", `/api/maps/${mapId}/invites`, { role: "editor", maxUses: 1, expiresInDays: 7 });
  assert.equal(invite.status, 201);
  assert.match(invite.body.url, new RegExp(`/m/${mapId}\\?invito=${invite.body.token}$`));

  const redeemed = await franco.call("POST", `/api/invites/${invite.body.token}/redeem`);
  assert.deepEqual(redeemed.body, { mapId, role: "editor" });
  assert.equal((await franco.call("PATCH", `/api/maps/${mapId}`, { name: "Modificata da Franco" })).status, 200);

  const shared = await franco.call("GET", "/api/maps?scope=shared");
  assert.ok(shared.body.items.some((m: { id: string }) => m.id === mapId));

  const state = await elena.call("GET", `/api/maps/${mapId}/shares`);
  assert.equal(state.body.invites.find((i: { token: string }) => i.token === invite.body.token)?.uses, 1);
});

test("la ricerca degli utenti trova i colleghi ma non sé stessi", async () => {
  const gina = await signedIn("gina.rossi@example.org", "Gina Rossi");
  await signedIn("gino.rossi@example.org", "Gino Rossi");
  const found = await gina.call("GET", "/api/users/search?q=ROSSI");
  const emails = found.body.items.map((u: { email: string }) => u.email);
  assert.ok(emails.includes("gino.rossi@example.org"));
  assert.equal(emails.includes("gina.rossi@example.org"), false);
  assert.deepEqual((await gina.call("GET", "/api/users/search?q=r")).body.items, [], "almeno due caratteri");
});

test("la configurazione pubblica dice cosa è attivo, senza segreti", async () => {
  const config = await anonymous().call("GET", "/api/config");
  assert.equal(config.status, 200);
  assert.equal(typeof config.body.keycloakEnabled, "boolean");
  assert.equal(JSON.stringify(config.body).match(/secret|password/i), null);
});

test("il percorso dell'app si toglie all'ingresso, e solo quello", () => {
  assert.equal(stripBase("/sestante/api/maps", "/sestante/"), "/api/maps");
  assert.equal(stripBase("/sestante", "/sestante/"), "/");
  assert.equal(stripBase("/sestante?x=1", "/sestante/"), "/?x=1");
  assert.equal(stripBase("/api/config", "/sestante/"), "/api/config", "il controllo di salute passa senza prefisso");
  assert.equal(stripBase("/sestanteX/api", "/sestante/"), "/sestanteX/api", "un prefisso simile non è il prefisso");
  assert.equal(stripBase("/api/maps", "/"), "/api/maps");
});
