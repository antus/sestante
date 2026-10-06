/**
 * Requisito: le mappe si condividono con altri, in lettura o in scrittura.
 * Ruoli espliciti (lettore, editor), accesso generale (privato, organizzazione,
 * link) e link d'invito; solo il proprietario gestisce gli accessi, e il server
 * — non l'interfaccia — fa rispettare i permessi.
 */
import { expect, test } from "@playwright/test";
import {
  FEATURE_COLLECTION,
  createMap,
  openMap,
  share,
  signIn,
  USERS,
  watchMapState,
} from "../support/helpers";

test("una mappa privata non esiste per chi non è invitato", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const outsider = await signIn(browser, USERS.colleague);
  const mapId = await createMap(owner, "Privata");

  // 404, non 403: non si rivela nemmeno che la mappa esiste.
  expect((await outsider.page.request.get(`/api/maps/${mapId}`)).status()).toBe(404);
  const shared = (await (await outsider.page.request.get("/api/maps?scope=shared")).json()) as {
    items: { id: string }[];
  };
  expect(shared.items.map((m) => m.id)).not.toContain(mapId);
  await owner.context.close();
  await outsider.context.close();
});

test("il proprietario invita un lettore dal dialogo; il lettore vede la mappa in sola lettura", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, `Condivisa in lettura ${Date.now()}`);
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);

  await owner.page.getByRole("button", { name: "Condividi" }).click();
  const dialog = owner.page.getByRole("dialog");
  await dialog.locator("#invite-mail").fill(USERS.viewer);
  await dialog.getByRole("button", { name: "Invita" }).click();
  await expect(dialog.getByText(USERS.viewer)).toBeVisible();

  const viewer = await signIn(browser, USERS.viewer);
  const shared = (await (await viewer.page.request.get("/api/maps?scope=shared")).json()) as {
    items: { id: string; role: string }[];
  };
  expect(shared.items.find((m) => m.id === mapId)?.role).toBe("viewer");

  await watchMapState(viewer.page);
  await openMap(viewer.page, mapId);
  await expect(viewer.page.getByText("Sola lettura")).toBeVisible();
  // Per un lettore il caricamento di dati non c'è proprio.
  await expect(viewer.page.getByRole("button", { name: "Aggiungi dati" })).toHaveCount(0);
  await expect(viewer.page.locator("iframe")).toHaveAttribute("src", /layout=viewer/);

  // E il server lo fa rispettare, qualunque cosa faccia il browser.
  const write = await viewer.page.request.patch(`/api/maps/${mapId}`, { data: { project: { layers: [] } } });
  expect(write.status()).toBe(403);
  const upload = await viewer.page.request.post(`/api/maps/${mapId}/files`, {
    data: { name: "x.geojson", geojson: FEATURE_COLLECTION },
  });
  expect(upload.status()).toBe(403);
  await owner.context.close();
  await viewer.context.close();
});

test("un editor invitato può modificare la mappa e caricare dati", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Condivisa in scrittura");
  await share(owner, mapId, USERS.editor, "editor");

  const editor = await signIn(browser, USERS.editor);
  await watchMapState(editor.page);
  await openMap(editor.page, mapId);
  await expect(editor.page.getByText("Sola lettura")).toHaveCount(0);
  await editor.page.locator('input[type="file"]').setInputFiles({
    name: "rilievi.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(FEATURE_COLLECTION)),
  });
  await expect(editor.page.getByText("Livello «rilievi» aggiunto e salvato.")).toBeVisible();
  await expect
    .poll(async () => {
      const body = (await (await owner.page.request.get(`/api/maps/${mapId}`)).json()) as {
        project: { layers?: { name: string }[] } | null;
      };
      return (body.project?.layers ?? []).map((l) => l.name);
    })
    .toContain("rilievi");
  await owner.context.close();
  await editor.context.close();
});

test("il proprietario cambia un editor in lettore dal dialogo, e la scrittura si chiude", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Ruolo che cambia");
  await share(owner, mapId, USERS.editor, "editor");
  const editor = await signIn(browser, USERS.editor);
  expect((await editor.page.request.patch(`/api/maps/${mapId}`, { data: { name: "ok" } })).status()).toBe(200);

  await watchMapState(owner.page);
  await openMap(owner.page, mapId);
  await owner.page.getByRole("button", { name: "Condividi" }).click();
  const row = owner.page.getByRole("dialog").locator(".person").filter({ hasText: USERS.editor });
  await row.locator("select").selectOption("viewer");

  await expect
    .poll(async () => (await editor.page.request.patch(`/api/maps/${mapId}`, { data: { name: "no" } })).status())
    .toBe(403);
  await owner.context.close();
  await editor.context.close();
});

test("solo il proprietario gestisce gli accessi", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Gestione accessi");
  await share(owner, mapId, USERS.editor, "editor");
  const editor = await signIn(browser, USERS.editor);

  const invite = await editor.page.request.post(`/api/maps/${mapId}/shares`, {
    data: { email: USERS.viewer, role: "editor" },
  });
  expect(invite.status()).toBe(403);
  const access = await editor.page.request.patch(`/api/maps/${mapId}/access`, {
    data: { generalAccess: "link", generalRole: "editor" },
  });
  expect(access.status()).toBe(403);
  await owner.context.close();
  await editor.context.close();
});

test("accesso generale all'organizzazione: dentro il dominio sì, fuori no", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Per l'organizzazione");
  const set = await owner.page.request.patch(`/api/maps/${mapId}/access`, {
    data: { generalAccess: "org", generalRole: "viewer" },
  });
  expect(set.status()).toBe(200);

  const colleague = await signIn(browser, USERS.colleague); // @example.org
  const outsider = await signIn(browser, USERS.outsider); // @…example.net
  const seen = (await (await colleague.page.request.get(`/api/maps/${mapId}`)).json()) as { role: string };
  expect(seen.role).toBe("viewer");
  expect((await outsider.page.request.get(`/api/maps/${mapId}`)).status()).toBe(404);
  await owner.context.close();
  await colleague.context.close();
  await outsider.context.close();
});

test("accesso con il link: lo apre anche chi non ha un account", async ({ browser, request }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Pubblica con link");
  await owner.page.request.patch(`/api/maps/${mapId}/access`, {
    data: { generalAccess: "link", generalRole: "viewer" },
  });

  // `request` è un contesto senza sessione.
  const anonymous = await request.get(`/api/maps/${mapId}`);
  expect(anonymous.status()).toBe(200);
  expect(((await anonymous.json()) as { role: string }).role).toBe("viewer");
  expect((await request.patch(`/api/maps/${mapId}`, { data: { name: "x" } })).status()).toBe(401);
  await owner.context.close();
});

test("un link d'invito dà il ruolo che porta con sé", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Con invito");
  const created = (await (
    await owner.page.request.post(`/api/maps/${mapId}/invites`, { data: { role: "editor", maxUses: 1 } })
  ).json()) as { token: string; url: string };
  expect(created.url).toContain(`/m/${mapId}?invito=`);

  const guest = await signIn(browser, USERS.outsider);
  expect((await guest.page.request.get(`/api/maps/${mapId}`)).status()).toBe(404);
  const redeem = await guest.page.request.post(`/api/invites/${created.token}/redeem`);
  expect(redeem.status()).toBe(200);
  const after = (await (await guest.page.request.get(`/api/maps/${mapId}`)).json()) as { role: string };
  expect(after.role).toBe("editor");

  // Un uso solo: il secondo riscatto è rifiutato.
  const other = await signIn(browser, USERS.viewer);
  expect((await other.page.request.post(`/api/invites/${created.token}/redeem`)).status()).toBe(410);
  await owner.context.close();
  await guest.context.close();
  await other.context.close();
});
