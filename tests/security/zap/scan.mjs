/**
 * Scansione OWASP ZAP "baseline" di Sestante: esplora l'app e segnala ciò che
 * si vede dalle risposte (intestazioni, cookie, contenuti) senza attaccarla.
 *
 *   npm run test:security:zap                       avvia un server locale e lo scansiona
 *   ZAP_TARGET=https://host/sestante/ npm run …     scansiona un'installazione esistente
 *
 * Serve Docker (immagine ghcr.io/zaproxy/zaproxy:stable). Il report va in
 * .out/security/zap/. Le regole e le eccezioni motivate sono in rules.tsv:
 * una regola a FAIL che scatta fa fallire il comando.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = join(root, ".out/security/zap");
mkdirSync(out, { recursive: true });
copyFileSync(join(here, "rules.tsv"), join(out, "rules.tsv"));

const port = process.env.ZAP_PORT ?? "4183";
let server = null;
let target = process.env.ZAP_TARGET;

if (!target) {
  // Dal container l'host si raggiunge come host.docker.internal: il server
  // ascolta su tutte le interfacce, non solo su 127.0.0.1.
  target = `http://host.docker.internal:${port}/`;
  server = spawn(process.execPath, [join(root, "tests/e2e/support/start-local.mjs")], {
    cwd: root,
    env: { ...process.env, E2E_PORT: port, E2E_RELAY_PORT: "8796", E2E_HOST: "0.0.0.0" },
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
}

console.log(`\n  ▸ ZAP baseline su ${target}\n`);
const result = spawnSync(
  "docker",
  [
    "run", "--rm",
    "--add-host", "host.docker.internal:host-gateway",
    "-v", `${out}:/zap/wrk:rw`,
    "ghcr.io/zaproxy/zaproxy:stable",
    "zap-baseline.py",
    "-t", target,
    "-c", "rules.tsv",
    "-r", "report.html",
    "-J", "report.json",
    "-m", "2",
    "-I",
  ],
  { stdio: "inherit" },
);
// Su Windows kill() ferma solo il lanciatore, non il server che ha avviato.
if (server) {
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
  else server.kill();
}

console.log(`\n  Report: ${join(out, "report.html")}\n`);
// -I: gli avvisi (WARN) non fanno fallire; le regole a FAIL sì (codice 1).
process.exit(result.status ?? 1);
