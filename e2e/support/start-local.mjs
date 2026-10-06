/**
 * Server Sestante per i test e2e "local": modalità local, SQLite, relay ospitato
 * nel processo, GeoLibre da geolibre-dist, dati di esempio. Tutto in una
 * cartella temporanea, e ogni variabile rilevante impostata qui: il .env dello
 * sviluppatore non deve poter cambiare l'esito dei test.
 *
 * Lo lancia Playwright (webServer in e2e/local.config.ts).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.E2E_PORT ?? "4180";
const relayPort = process.env.E2E_RELAY_PORT ?? "8798";
const isWindows = process.platform === "win32";

if (!existsSync(join(root, "geolibre-dist/web/index.html"))) {
  console.error("\n  Manca geolibre-dist: esegui prima  npm run setup\n");
  process.exit(1);
}

const dataDir = mkdtempSync(join(tmpdir(), "sestante-e2e-"));
const env = {
  ...process.env,
  NODE_ENV: "test",
  SESTANTE_MODE: "local",
  PORT: port,
  HOST: "127.0.0.1",
  PUBLIC_URL: `http://localhost:${port}`,
  DATA_DIR: dataDir,
  DATABASE_PATH: join(dataDir, "sestante.sqlite"),
  UPLOADS_PATH: join(dataDir, "uploads"),
  DATABASE_URL: "",
  SESSION_SECRET: "e2e-session-secret",
  ALLOW_LOCAL_SIGNUP: "true",
  ORG_DOMAIN: "example.org",
  ORG_LABEL: "example.org",
  KEYCLOAK_ISSUER: "",
  KEYCLOAK_CLIENT_SECRET: "",
  COLLAB_EMBEDDED: "1",
  COLLAB_URL: `http://127.0.0.1:${relayPort}`,
  COLLAB_PUBLIC_URL: "",
  COLLAB_IDENTITY_SECRET: "",
  GEOLIBRE_URL: "",
  GEOLIBRE_SERVICES_FILE: "",
};

// Il client va servito dal server, come in produzione: lo si compila ora.
const npm = isWindows ? "npm.cmd" : "npm";
const built = spawnSync(npm, ["run", "build", "-w", "@sestante/web"], {
  cwd: root,
  stdio: "inherit",
  shell: isWindows,
});
if (built.status !== 0) process.exit(built.status ?? 1);

const seeded = spawnSync(process.execPath, ["--import", "tsx", "src/seed.ts", "--reset"], {
  cwd: join(root, "server"),
  env,
  stdio: "inherit",
});
if (seeded.status !== 0) process.exit(seeded.status ?? 1);

const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(root, "server"),
  env,
  stdio: "inherit",
});

const stop = () => {
  server.kill();
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* su Windows il database può essere ancora aperto */
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
server.on("exit", (code) => process.exit(code ?? 0));
