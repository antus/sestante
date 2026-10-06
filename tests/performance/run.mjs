/**
 * Esegue uno scenario k6 contro Sestante.
 *
 *   npm run test:performance                         uso-normale, profilo "carico", server locale
 *   npm run test:performance -- fumo                 profilo breve, per provare lo scenario
 *   PERF_TARGET=https://host/sestante npm run …      contro un'installazione esistente
 *
 * Usa k6 se è installato, altrimenti l'immagine Docker grafana/k6. Senza
 * PERF_TARGET avvia un server locale con i dati di esempio. Il riepilogo va
 * in .out/performance/.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const out = join(root, ".out/performance");
mkdirSync(out, { recursive: true });

const profilo = process.argv[2] ?? "carico";
const scenario = process.env.PERF_SCENARIO ?? "uso-normale";
const port = process.env.PERF_PORT ?? "4184";
const hasK6 = spawnSync("k6", ["version"], { stdio: "ignore" }).status === 0;

let server = null;
let target = process.env.PERF_TARGET;
if (!target) {
  server = spawn(process.execPath, [join(root, "tests/e2e/support/start-local.mjs")], {
    cwd: root,
    env: { ...process.env, E2E_PORT: port, E2E_RELAY_PORT: "8795", E2E_HOST: hasK6 ? "127.0.0.1" : "0.0.0.0" },
    stdio: "ignore",
  });
  const ready = Date.now() + 180_000;
  for (;;) {
    try {
      if ((await fetch(`http://localhost:${port}/api/config`)).ok) break;
    } catch {
      /* non ancora */
    }
    if (Date.now() > ready) throw new Error("il server locale non è partito");
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Dal container l'host si raggiunge come host.docker.internal.
  target = hasK6 ? `http://localhost:${port}` : `http://host.docker.internal:${port}`;
}

console.log(`\n  ▸ k6 ${scenario} (${profilo}) su ${target}${hasK6 ? "" : " — con Docker"}\n`);
const env = ["-e", `BASE_URL=${target}`, "-e", `K6_PROFILO=${profilo}`];
const summary = `riepilogo-${scenario}-${profilo}.json`;
const result = hasK6
  ? spawnSync("k6", ["run", ...env, "--summary-export", join(out, summary), join(here, "scenari", `${scenario}.js`)], {
      stdio: "inherit",
    })
  : spawnSync(
      "docker",
      [
        "run", "--rm", "-i",
        "--add-host", "host.docker.internal:host-gateway",
        "-v", `${join(here, "scenari")}:/scenari:ro`,
        "-v", `${out}:/out`,
        "grafana/k6:latest",
        "run", ...env, "--summary-export", `/out/${summary}`, `/scenari/${scenario}.js`,
      ],
      { stdio: "inherit" },
    );

// Su Windows kill() ferma solo il lanciatore, non il server che ha avviato.
if (server) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}
// k6 esce con 99 se una soglia non è rispettata.
process.exit(result.status ?? 1);
