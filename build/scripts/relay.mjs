/**
 * Avvia il relay di collaborazione di GeoLibre (workers/collab-node) in locale.
 *
 * Il relay NON è codice di Sestante: è il componente di GeoLibre che tiene la
 * sessione condivisa, la presenza e i permessi per partecipante. Lo produce
 * `npm run build:geolibre` dallo stesso sorgente, allo stesso commit, del build
 * di GeoLibre (.out/geolibre/relay/relay.cjs, un unico file senza
 * node_modules). Questo script lo avvia con il segreto di firma già allineato a
 * quello del server, perché è l'unica parte della configurazione in cui un
 * errore di copia-incolla produce un fallimento silenzioso: con segreti diversi
 * ogni identityToken verifica a null e tutti entrano come anonimi.
 *
 *   node build/scripts/relay.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relayFile = resolve(root, ".out/geolibre/relay/relay.cjs");

function env(key, fallback = "") {
  const file = resolve(root, ".env");
  if (!existsSync(file)) return process.env[key] ?? fallback;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq).trim() === key) {
      return process.env[key] ?? trimmed.slice(eq + 1).trim();
    }
  }
  return process.env[key] ?? fallback;
}

const secret = env("COLLAB_IDENTITY_SECRET");
if (!secret) {
  console.error(
    [
      "",
      "  COLLAB_IDENTITY_SECRET non è configurato nel file .env.",
      "  Senza segreto condiviso il relay accetta tutti come anonimi e la",
      "  presenza non mostra utenti verificati. Impostalo (stesso valore qui e",
      "  nel server) e riprova.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (!existsSync(relayFile)) {
  console.error(
    [
      "",
      "  Relay non trovato in .out/geolibre/relay/relay.cjs.",
      "  Si produce insieme al build di GeoLibre:  npm run build:geolibre",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// La porta è quella di COLLAB_URL, così server e relay non possono divergere.
const port = (() => {
  try {
    return new URL(env("COLLAB_URL", "http://127.0.0.1:8787")).port || "8787";
  } catch {
    return "8787";
  }
})();
const origins = env("PUBLIC_URL", "http://localhost:5173");

console.log(
  [
    "",
    "  Relay di collaborazione GeoLibre",
    `    porta            ${port}`,
    `    origini ammesse  ${origins}`,
    "    identità         attiva (segreto condiviso con il server Sestante)",
    "",
  ].join("\n"),
);

const relay = spawn(process.execPath, [relayFile], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    HOST: env("COLLAB_HOST", "127.0.0.1"),
    COLLAB_IDENTITY_SECRET: secret,
    ALLOWED_ORIGINS: origins,
    COLLAB_DB_PATH: resolve(root, ".out/data/collab.sqlite"),
  },
});
relay.on("exit", (code) => process.exit(code ?? 0));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => relay.kill(signal));
}
