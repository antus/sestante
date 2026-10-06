/**
 * Funzioni comuni ai test e2e. La preparazione dei dati passa dalle API (veloce
 * e senza ambiguità); ciò che il requisito chiede di verificare passa invece
 * dall'interfaccia, come lo farebbe una persona.
 */
import { expect, type Browser, type BrowserContext, type Frame, type Page } from "@playwright/test";

/** Password comune degli utenti di esempio (src/server/src/seed.ts). */
export const DEMO_PASSWORD = "sestante2026";

export const USERS = {
  owner: "m.antonini@example.org",
  editor: "e.ricci@example.org",
  viewer: "s.lombardi@example.org",
  colleague: "d.colombo@example.org",
  outsider: "gis@protezionecivile.example.net",
} as const;

/** Un utente con il suo contesto di browser, già autenticato. */
export interface Actor {
  context: BrowserContext;
  page: Page;
  email: string;
}

export async function signIn(browser: Browser, email: string, password = DEMO_PASSWORD): Promise<Actor> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response.status(), `accesso di ${email}`).toBe(200);
  return { context, page, email };
}

export async function createMap(actor: Actor, name: string): Promise<string> {
  const response = await actor.page.request.post("/api/maps", { data: { name } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { map: { id: string } }).map.id;
}

export async function share(actor: Actor, mapId: string, email: string, role: "viewer" | "editor") {
  const response = await actor.page.request.post(`/api/maps/${mapId}/shares`, { data: { email, role } });
  expect(response.status()).toBe(201);
}

export async function savedLayerIds(actor: Actor, mapId: string): Promise<string[]> {
  const body = (await (await actor.page.request.get(`/api/maps/${mapId}`)).json()) as {
    project: { layers?: { id: string }[] } | null;
  };
  return (body.project?.layers ?? []).map((layer) => layer.id).sort();
}

/**
 * Registra, nella pagina, l'ultimo progetto che GeoLibre ha trasmesso a
 * Sestante (`geolibre:state`): è ciò che la persona vede nella mappa.
 */
export async function watchMapState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = {
      layers: [] as string[],
      project: null as unknown,
      types: {} as Record<string, number>,
      /** Messaggi del relay ricevuti dalla connessione di GeoLibre (via il ponte). */
      relay: [] as { type: string; role?: string; reason?: string; participants?: unknown[] }[],
    };
    (window as unknown as { __e2e: typeof seen }).__e2e = seen;
    // Il ponte della collaborazione (src/web/src/lib/collabBridge.ts) si registra
    // su window all'avvio dell'app: lo si intercetta mentre nasce, così anche
    // il primo `welcome` resta registrato.
    let bridge: { onRelayMessage: (frame: unknown) => void } | undefined;
    Object.defineProperty(window, "__sestanteCollab", {
      configurable: true,
      get: () => bridge,
      set: (value: { onRelayMessage: (frame: unknown) => void }) => {
        const original = value.onRelayMessage;
        value.onRelayMessage = (frame) => {
          seen.relay.push(frame as (typeof seen.relay)[number]);
          original(frame);
        };
        bridge = value;
      },
    });
    window.addEventListener("message", (event) => {
      const data = event.data as { type?: string; project?: { layers?: { id: string }[] } };
      if (!data || typeof data.type !== "string") return;
      seen.types[data.type] = (seen.types[data.type] ?? 0) + 1;
      if (data.type === "geolibre:state" && data.project) {
        seen.project = data.project;
        seen.layers = (data.project.layers ?? []).map((l) => l.id).sort();
      }
    });
  });
}

export async function mapLayers(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __e2e: { layers: string[] } }).__e2e.layers);
}

/** Apre una mappa e aspetta che GeoLibre sia pronto e abbia consegnato il progetto. */
export async function openMap(page: Page, mapId: string): Promise<Frame> {
  await page.goto(`/m/${mapId}`);
  await page.waitForFunction(
    () => Boolean((window as unknown as { __e2e?: { project: unknown } }).__e2e?.project),
    undefined,
    { timeout: 60_000 },
  );
  const frame = page.frames().find((f) => f.url().includes("/gis/"));
  expect(frame, "iframe GeoLibre").toBeTruthy();
  return frame as Frame;
}

/** Un livello GeoJSON con un punto, nella forma che Sestante produce. */
export function pointLayer(id: string) {
  return {
    id,
    name: id,
    type: "geojson",
    visible: true,
    opacity: 1,
    source: { type: "geojson" },
    style: {},
    metadata: {},
    geojson: {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [12.5, 41.9] } }],
    },
  };
}

/**
 * Modifica la mappa come farebbe GeoLibre dopo un'azione dell'utente: il
 * progetto vivo con un livello in più, caricato nell'istanza della pagina.
 */
export async function addLayerInMap(page: Page, layerId: string): Promise<void> {
  await page.evaluate((layer) => {
    const current = ((window as unknown as { __e2e: { project: Record<string, unknown> } }).__e2e.project ?? {}) as {
      layers?: unknown[];
    };
    const next = { ...current, layers: [...(current.layers ?? []), layer] };
    const iframe = document.querySelector("iframe") as HTMLIFrameElement;
    iframe.contentWindow?.postMessage({ type: "geolibre:load-project", project: next }, location.origin);
  }, pointLayer(layerId));
}

/** I messaggi del relay visti da quella pagina, nell'ordine. */
export async function relayFrames(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as {
        __e2e: { relay: { type: string; role?: string; reason?: string; participants?: unknown[] }[] };
      }).__e2e.relay,
  );
}

/** Il testo della barra che riporta la sessione collaborativa. */
export function presence(page: Page) {
  return page.getByText(/\d+ conness[oi]/);
}

export const FEATURE_COLLECTION = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { nome: "Colosseo" }, geometry: { type: "Point", coordinates: [12.4922, 41.8902] } },
    { type: "Feature", properties: { nome: "Pantheon" }, geometry: { type: "Point", coordinates: [12.4768, 41.8986] } },
  ],
};
