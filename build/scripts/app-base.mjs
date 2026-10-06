/**
 * Il percorso sotto cui è pubblicata l'app, per gli script di build: "/" o "/x/".
 *
 * Stessa regola del server (src/server/src/config.ts): APP_BASE se c'è, altrimenti
 * il percorso di PUBLIC_URL; dall'ambiente, oppure dal .env della radice.
 * Serve al build di GeoLibre, il cui percorso (<APP_BASE>gis/) è fissato nel
 * build stesso.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fromDotEnv(root, key) {
  const file = resolve(root, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}

export function normalizeBase(value) {
  const trimmed = String(value ?? "")
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/|\/$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

export function appBase(root) {
  const explicit = process.env.APP_BASE ?? fromDotEnv(root, "APP_BASE");
  if (explicit !== undefined && explicit !== "") return normalizeBase(explicit);
  const publicUrl = process.env.PUBLIC_URL ?? fromDotEnv(root, "PUBLIC_URL");
  try {
    return normalizeBase(publicUrl ? new URL(publicUrl).pathname : "/");
  } catch {
    return "/";
  }
}
