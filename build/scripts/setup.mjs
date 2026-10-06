/**
 * Preparazione completa di una postazione di sviluppo, in un comando:
 *
 *   1. controllo della versione di Node;
 *   2. dipendenze npm;
 *   3. database con i dati di esempio (solo se non esiste già: rilanciare
 *      setup non cancella il lavoro fatto — per ripartire da zero c'è
 *      `npm run db:reset`);
 *   4. build di GeoLibre e del relay, solo se manca o se è di un commit diverso
 *      da quello di build/geolibre/geolibre.lock.json.
 *
 *   npm run setup                   tutto
 *   npm run setup -- --skip-geolibre  salta il passo 4 (si usa l'istanza pubblica)
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appBase } from "./app-base.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const args = process.argv.slice(2);

function step(message) {
  console.log(`\n  ▸ ${message}\n`);
}
function run(command, commandArgs) {
  // La shell serve solo a npm.cmd su Windows; con node.exe spezzerebbe il
  // percorso "C:\Program Files\…" sugli spazi.
  const shell = isWindows && command === npm;
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, [join(root, "build/scripts/check-node.mjs")]);

step("Dipendenze npm");
run(npm, ["install"]);

const database = join(root, ".out/data/sestante.sqlite");
if (existsSync(database)) {
  step("Database già presente: lo lascio com'è (npm run db:reset per ricrearlo)");
} else {
  step("Creo il database con i dati di esempio");
  run(npm, ["run", "db:reset"]);
}

if (args.includes("--skip-geolibre")) {
  step("GeoLibre: saltato su richiesta");
} else {
  const lock = JSON.parse(readFileSync(join(root, "build/geolibre/geolibre.lock.json"), "utf8"));
  const manifestPath = join(root, ".out/geolibre/manifest.json");
  const built = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null;
  const upToDate =
    built?.geolibre?.commit === lock.commit &&
    // Un build da --src (checkout di sviluppo) non è la versione fissata.
    built?.geolibre?.repo === lock.repo &&
    built?.buildEnv?.GEOLIBRE_APP_BASE === `${appBase(root)}gis/` &&
    existsSync(join(root, ".out/geolibre/web/index.html")) &&
    existsSync(join(root, ".out/geolibre/relay/relay.cjs"));
  if (upToDate) {
    step(`GeoLibre ${lock.version} già compilato`);
  } else {
    step(
      `Compilo GeoLibre ${lock.version} (la prima volta scarica il sorgente e le sue dipendenze: qualche minuto)`,
    );
    run(process.execPath, [join(root, "build/scripts/build-geolibre.mjs")]);
  }
}

console.log("\n  Pronto. Avvia con:  npm run dev\n");
