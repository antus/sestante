/**
 * Requisito: lingua e tema scelti dall'utente valgono anche dentro la mappa.
 * GeoLibre li riceve all'apertura (parametri lang e theme): cambiarli rimonta
 * la mappa nella nuova lingua o nel nuovo tema, senza perdere il progetto.
 */
import { expect, test } from "@playwright/test";
import { FEATURE_COLLECTION, createMap, mapLayers, openMap, signIn, USERS, watchMapState } from "../support/helpers";

test("passando all'inglese cambiano Sestante e la mappa, e il progetto resta", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Lingua");
  await watchMapState(owner.page);
  const frame = await openMap(owner.page, mapId);
  await expect(frame.getByText("Progetto", { exact: true }).first()).toBeVisible();
  await owner.page.locator('input[type="file"]').setInputFiles({
    name: "lingua.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(FEATURE_COLLECTION)),
  });
  await expect(owner.page.getByText("Livello «lingua» aggiunto e salvato.")).toBeVisible();
  const savedId = async () => {
    const body = (await (await owner.page.request.get(`/api/maps/${mapId}`)).json()) as {
      project: { layers?: { id: string; name: string }[] } | null;
    };
    return body.project?.layers?.find((l) => l.name === "lingua")?.id ?? "";
  };
  await expect.poll(savedId).not.toBe("");
  const layerId = await savedId();

  await owner.page.getByTitle("Lingua").click();
  await owner.page.getByText("Inglese").click();

  await expect(owner.page.getByRole("button", { name: "Share" })).toBeVisible();
  await expect(owner.page.locator("iframe")).toHaveAttribute("src", /lang=en/);
  await expect.poll(() => Boolean(owner.page.frames().find((f) => f.url().includes("lang=en")))).toBe(true);
  const map = owner.page.frames().find((f) => f.url().includes("lang=en"));
  await expect(map!.getByText("Project", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  // La mappa rimontata ha ritrovato il livello.
  await expect.poll(() => mapLayers(owner.page), { timeout: 60_000 }).toContain(layerId);
  await owner.context.close();
});

test("il tema scuro arriva alla mappa e resta dopo una ricarica", async ({ browser }) => {
  const owner = await signIn(browser, USERS.owner);
  const mapId = await createMap(owner, "Tema");
  await watchMapState(owner.page);
  await openMap(owner.page, mapId);

  await owner.page.getByTitle("Tema").click();
  await owner.page.getByText("Scuro", { exact: true }).click();

  await expect(owner.page.locator("html")).toHaveClass(/theme-dark/);
  await expect(owner.page.locator("iframe")).toHaveAttribute("src", /theme=dark/);

  await owner.page.reload();
  await expect(owner.page.locator("html")).toHaveClass(/theme-dark/);
  await expect(owner.page.locator("iframe")).toHaveAttribute("src", /theme=dark/);
  await owner.context.close();
});
