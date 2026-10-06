/**
 * Requisito: una volta entrati, gli utenti creano mappe; il loro contenuto
 * (livelli, stili, vista) si salva e si ritrova riaprendole.
 */
import { expect, test } from "@playwright/test";
import {
  FEATURE_COLLECTION,
  createMap,
  mapLayers,
  openMap,
  signIn,
  USERS,
  watchMapState,
} from "../support/helpers";

test("una mappa nuova si crea dalla dashboard e si apre in GeoLibre", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  await watchMapState(owner.page);
  await owner.page.goto("/");
  await owner.page.getByRole("button", { name: "Nuova mappa" }).click();

  await expect(owner.page).toHaveURL(/\/m\/[0-9a-f-]{36}$/);
  const iframe = owner.page.locator("iframe");
  await expect(iframe).toHaveAttribute("src", /\/gis\/\?/);
  await owner.page.waitForFunction(() => Boolean((window as never as { __e2e: { project: unknown } }).__e2e.project));

  const mapId = owner.page.url().split("/m/")[1] as string;
  const list = (await (await owner.page.request.get("/api/maps?scope=mine")).json()) as { items: { id: string }[] };
  expect(list.items.map((m) => m.id)).toContain(mapId);
  await owner.context.close();
});

test("un file GeoJSON caricato diventa un livello salvato, che si ritrova riaprendo la mappa", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Mappa con livello");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);

  await owner.page.locator('input[type="file"]').setInputFiles({
    name: "monumenti.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(FEATURE_COLLECTION)),
  });
  await expect(owner.page.getByText("Livello «monumenti» aggiunto e salvato.")).toBeVisible();

  // Salvato sul server (le modifiche si scrivono entro un secondo), con i dati
  // serviti da Sestante e non incorporati nel progetto.
  type Saved = { project: { layers?: { id: string; name: string; source?: { data?: string } }[] } | null };
  const savedLayer = async () =>
    ((await (await owner.page.request.get(`/api/maps/${mapId}`)).json()) as Saved).project?.layers?.find(
      (l) => l.name === "monumenti",
    );
  await expect.poll(savedLayer, { timeout: 10_000 }).toBeTruthy();
  const layer = await savedLayer();
  expect(layer, "livello nel progetto salvato").toBeTruthy();
  expect(layer?.source?.data).toContain(`/api/maps/${mapId}/files/`);

  // Riaprendo, GeoLibre riceve il progetto con il livello.
  await owner.page.reload();
  await owner.page.waitForFunction(
    (id) => (window as never as { __e2e: { layers: string[] } }).__e2e.layers.includes(id),
    layer?.id ?? "",
    { timeout: 60_000 },
  );
  expect(await mapLayers(owner.page)).toContain(layer?.id);
  await owner.context.close();
});

test("un file che non è GeoJSON viene rifiutato con un messaggio", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Mappa file sbagliato");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);
  await owner.page.locator('input[type="file"]').setInputFiles({
    name: "note.geojson",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ciao: "mondo" })),
  });
  await expect(owner.page.getByText("Il file non è un GeoJSON valido.")).toBeVisible();
  await owner.context.close();
});

test("il nome della mappa si cambia dall'editor e resta salvato", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Nome provvisorio");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);

  const name = owner.page.locator("input.proj-name");
  await name.fill("Nome definitivo");
  await name.press("Enter");
  await name.blur();
  await expect
    .poll(async () => ((await (await owner.page.request.get(`/api/maps/${mapId}`)).json()) as { map: { name: string } }).map.name)
    .toBe("Nome definitivo");
  await owner.context.close();
});

test("una mappa si elimina dalla dashboard e non è più raggiungibile", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const name = `Da eliminare ${Date.now()}`;
  const mapId = await createMap(owner, name);
  await owner.page.goto("/");

  const card = owner.page.locator("article, .card, li").filter({ hasText: name }).first();
  await card.getByRole("button", { name: "Altre azioni" }).click();
  await owner.page.getByText("Elimina mappa").click();
  await owner.page.locator(".btn-danger").click();

  await expect(owner.page.getByText(name)).toHaveCount(0);
  expect((await owner.page.request.get(`/api/maps/${mapId}`)).status()).toBe(404);
  await owner.context.close();
});
