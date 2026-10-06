/**
 * Dove stanno le cose: sorgenti, dati, build di GeoLibre.
 *
 * Due situazioni, decise una volta qui e da nessun'altra parte:
 *
 *  - **sviluppo / npm start**: tutto è relativo alla radice del repository;
 *    ciò che si genera (dati, build di GeoLibre) sta in `.out/`;
 *  - **Sestante.exe** (Node single executable application): accanto
 *    all'eseguibile c'è la cartella `geolibre/`; il client React è dentro
 *    l'eseguibile come asset; i dati vanno in `data/` accanto all'eseguibile
 *    se la cartella è scrivibile (zip portabile), altrimenti in
 *    `%LOCALAPPDATA%\Sestante`.
 */
import { accessSync, constants, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `node:sea` esiste anche fuori da un eseguibile (isSea() vale false); lo si
 * carica con require perché nel bundle CommonJS dell'eseguibile non c'è un
 * `import.meta.url` da cui partire.
 */
const nodeRequire: NodeRequire =
  typeof require === "function" ? require : createRequire(import.meta.url);
const sea = nodeRequire("node:sea") as {
  isSea(): boolean;
  getAsset(key: string): ArrayBuffer;
};

export const isPackaged = sea.isSea();

/**
 * Radice da cui si risolvono i percorsi relativi di configurazione: la cartella
 * dell'eseguibile, oppure la radice del repository (questo file è in
 * src/server/src, compilato in src/server/dist: tre livelli sotto).
 */
export const appRoot = isPackaged
  ? dirname(process.execPath)
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function writable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Cartella dei dati quando la configurazione non ne indica una. */
export const defaultDataDir = (() => {
  if (!isPackaged) return join(appRoot, ".out/data");
  const portable = join(appRoot, "data");
  if (writable(portable)) return portable;
  const base = process.env.LOCALAPPDATA ?? join(process.env.HOME ?? appRoot, ".local/share");
  return join(base, "Sestante");
})();

/** Build di GeoLibre servito su /gis/. */
export const defaultGeolibreDir = isPackaged
  ? join(appRoot, "geolibre")
  : join(appRoot, ".out/geolibre/web");

/** Build del client React (solo fuori dall'eseguibile: dentro è un asset). */
export const webDistDir = join(appRoot, "src/web/dist");

/** Asset incorporato nell'eseguibile, o null se non c'è. */
export function packagedAsset(key: string): Buffer | null {
  if (!isPackaged) return null;
  try {
    return Buffer.from(sea.getAsset(key));
  } catch {
    return null;
  }
}
