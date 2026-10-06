/**
 * Requisito: Sestante su un server condiviso, distribuito con Docker: PostgreSQL
 * per i dati, un solo ingresso HTTPS, collaborazione su wss attraverso il proxy.
 */
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
import { FEATURE_COLLECTION, watchMapState } from "../support/helpers";

const SSO_USER = process.env.E2E_SSO_USER ?? "anna.verdi";
const SSO_PASSWORD = process.env.E2E_SSO_PASSWORD ?? "Sestante-demo-2026";
const COMPOSE_DIR = resolve(HERE, "../../../distribution/docker");

async function signIn(page: Page) {
  await page.goto("./");
  await page.getByText("Continua con SSO aziendale").click();
  await page.locator("#username").fill(SSO_USER);
  await page.locator("#password").fill(SSO_PASSWORD);
  await page.locator("#kc-login").click();
  await expect(page.getByRole("button", { name: "Nuova mappa" })).toBeVisible();
}

/**
 * Interroga il PostgreSQL dell'installazione: quello del cluster se è indicato
 * E2E_K8S_NAMESPACE (con E2E_K8S_CONTEXT facoltativo), altrimenti quello del
 * compose. null se lo strumento non è a disposizione di chi lancia i test.
 */
function psql(sql: string): string | null {
  const query = ["psql", "-U", "postgres", "-d", "sestante", "-tAc", sql];
  const namespace = process.env.E2E_K8S_NAMESPACE;
  const [command, args, cwd] = namespace
    ? [
        "kubectl",
        [
          ...(process.env.E2E_K8S_CONTEXT ? ["--context", process.env.E2E_K8S_CONTEXT] : []),
          "-n",
          namespace,
          "exec",
          process.env.E2E_K8S_POSTGRES_POD ?? "sestante-postgres-0",
          "--",
          ...query,
        ],
        undefined,
      ]
    : ["docker", ["compose", "exec", "-T", "postgres", ...query], COMPOSE_DIR];
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

test("una mappa con un livello si salva su PostgreSQL e si ritrova", async ({ page }) => {
  await watchMapState(page);
  await signIn(page);
  const created = (await (await page.request.post("api/maps", { data: { name: "Su PostgreSQL" } })).json()) as {
    map: { id: string };
  };
  const mapId = created.map.id;
  await page.goto(`m/${mapId}`);
  await page.waitForFunction(() => Boolean((window as never as { __e2e: { project: unknown } }).__e2e.project), undefined, {
    timeout: 60_000,
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "server.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify(FEATURE_COLLECTION)),
  });
  await expect(page.getByText("Livello «server» aggiunto e salvato.")).toBeVisible();
  await expect
    .poll(async () => {
      const body = (await (await page.request.get(`api/maps/${mapId}`)).json()) as {
        project: { layers?: { name: string }[] } | null;
      };
      return (body.project?.layers ?? []).map((l) => l.name);
    })
    .toContain("server");

  // Dove è finita davvero: nel database PostgreSQL del compose.
  const row = psql(`SELECT name FROM maps WHERE id = '${mapId}'`);
  test.skip(row === null, "docker non disponibile: controllo diretto su PostgreSQL saltato");
  expect(row).toBe("Su PostgreSQL");
});

test("la collaborazione passa da wss attraverso il proxy, con il ruolo di host", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (ws) => sockets.push(ws.url()));
  await watchMapState(page);
  await signIn(page);
  const created = (await (await page.request.post("api/maps", { data: { name: "Collaborazione su wss" } })).json()) as {
    map: { id: string };
  };
  await page.goto(`m/${created.map.id}`);
  await expect(page.getByText("1 connesso")).toBeVisible({ timeout: 60_000 });

  const relay = new URL("collab/sessions/", test.info().project.use.baseURL).href.replace("https:", "wss:");
  expect(sockets.some((url) => url.startsWith(relay)), `WebSocket aperti: ${sockets.join(", ")}`).toBe(true);
  const welcome = await page.evaluate(
    () => (window as never as { __e2e: { relay: { type: string; role?: string }[] } }).__e2e.relay.find((f) => f.type === "welcome"),
  );
  expect(welcome?.role).toBe("host");
});

test("GeoLibre è servito dall'immagine, con la CSP che ammette il relay pubblico", async ({ request, baseURL }) => {
  const index = await request.get("gis/");
  expect(index.status()).toBe(200);
  const csp = index.headers()["content-security-policy"] ?? "";
  expect(csp).toContain(new URL(baseURL as string).origin.replace("https:", "wss:"));

  const status = (await (await request.get("api/collab/status")).json()) as { inMap: boolean; reachable: boolean };
  expect(status).toMatchObject({ inMap: true, reachable: true });
});
