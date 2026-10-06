/**
 * Ambiente dei test: database temporaneo e segreti finti.
 *
 * Va importato per PRIMO in ogni file di test, prima di qualunque modulo che
 * legga la configurazione: `config.ts` la fissa al primo import e non la
 * rilegge più, quindi l'ordine degli import qui è funzionale, non estetico.
 *
 * Motore: SQLite di default; con TEST_DB=postgres gli stessi test girano su
 * PostgreSQL vero, compilato in WebAssembly (PGlite), senza bisogno di un
 * server: è ciò che verifica che lo schema e le query siano davvero portabili.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sestante-test-"));

process.env.DATA_DIR = dir;
process.env.DATABASE_PATH = join(dir, "test.sqlite");
process.env.SESSION_SECRET = "test-session-secret";
process.env.COLLAB_IDENTITY_SECRET = "test-collab-secret";
process.env.ORG_DOMAIN = "example.org";
process.env.NODE_ENV = "test";
delete process.env.DATABASE_URL;

export const engine = process.env.TEST_DB === "postgres" ? "postgres" : "sqlite";

const { initDb, postgresDb } = await import("../src/db.js");
if (engine === "postgres") {
  const { PGlite } = await import("@electric-sql/pglite");
  const pglite = new PGlite();
  await initDb(postgresDb(pglite));
} else {
  await initDb();
}

process.on("exit", () => {
  // Su Windows il database è ancora aperto all'uscita e la cartella non si può
  // cancellare (EPERM): resta nella temp di sistema, non è un test fallito.
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignorato */
  }
});

export const testDir = dir;
