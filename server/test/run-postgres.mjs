// Gli stessi test di `npm test`, su PostgreSQL (PGlite) invece che su SQLite.
// Uno script invece di `TEST_DB=postgres tsx …`, che su Windows non funziona.
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "test/*.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, TEST_DB: "postgres" },
});
process.exit(result.status ?? 1);
