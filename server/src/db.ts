/**
 * Persistenza: SQLite oppure PostgreSQL, dietro la stessa interfaccia.
 *
 * - **SQLite** (default) tramite `node:sqlite`, il modulo integrato in Node
 *   22.13+: nessuna dipendenza nativa da compilare, ed è ciò che fa partire il
 *   progetto (e l'eseguibile) su una postazione Windows senza build tools.
 * - **PostgreSQL** con `DATABASE_URL=postgres://…`, tramite `pg` (JavaScript
 *   puro): per l'installazione condivisa.
 *
 * Il resto del server non sa quale dei due c'è sotto: legge righe con `get` /
 * `all` e scrive con `run`, sempre in modo asincrono, con parametri posizionali
 * `?`. Lo schema è uno solo e portabile: tipi banali (TEXT, BIGINT), nessuna
 * estensione, nessuna funzione specifica di un motore.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export type Role = "owner" | "editor" | "viewer";
export type GeneralAccess = "private" | "org" | "link";

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
  /** "local" oppure "keycloak": un utente non può avere entrambi i percorsi. */
  provider: string;
  /** Solo per provider "local". */
  password_hash: string | null;
  /** `sub` del token OIDC, solo per provider "keycloak". */
  external_id: string | null;
  color: string;
  locale: string;
  theme: string;
  accent: string;
  created_at: number;
}

export interface MapRow {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  /** Progetto GeoLibre serializzato (.geolibre.json) o null se ancora vuoto. */
  project_json: string | null;
  thumb: string;
  general_access: GeneralAccess;
  general_role: Exclude<Role, "owner">;
  /** Codice sessione del relay, se una sessione collaborativa è aperta. */
  collab_session_id: string | null;
  collab_host_token: string | null;
  created_at: number;
  updated_at: number;
}

export interface FileRow {
  id: string;
  map_id: string;
  /** Nome scelto dall'utente: serve solo a etichettare il livello. */
  name: string;
  content_type: string;
  size: number;
  /** Autorizzazione di lettura incorporata nell'URL (vedi storage.ts). */
  secret: string;
  created_at: number;
  created_by: string;
}

export interface ShareRow {
  id: string;
  map_id: string;
  user_id: string;
  role: Exclude<Role, "owner">;
  created_at: number;
  created_by: string;
}

export interface InviteRow {
  token: string;
  map_id: string;
  role: Exclude<Role, "owner">;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  created_at: number;
  created_by: string;
}

/**
 * La superficie che il server usa. Le righe tornano tipizzate dal chiamante
 * (`get<MapRow>(…)`): è l'unico punto in cui si rinuncia a una garanzia del
 * tipo, ed è dichiarato invece che nascosto. I numeri arrivano sempre come
 * `number`, anche dalle colonne BIGINT di PostgreSQL.
 */
export interface Db {
  readonly kind: "sqlite" | "postgres";
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  /** Più istruzioni senza parametri: serve allo schema. */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Ciò che serve di un client PostgreSQL: `pg.Pool` e PGlite lo offrono entrambi. */
export interface PgClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
  exec?(text: string): Promise<unknown>;
  end?(): Promise<void>;
  close?(): Promise<void>;
}

/** `?` posizionali → `$1, $2…`. Le nostre query non hanno `?` dentro stringhe. */
export function toPgPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

/** BIGINT può arrivare come bigint (PGlite): qui diventa number. */
function normalizeRow<T>(row: unknown): T {
  const record = row as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (typeof record[key] === "bigint") record[key] = Number(record[key]);
  }
  return record as T;
}

function sqliteDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const handle = new DatabaseSync(path);
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec("PRAGMA foreign_keys = ON");
  // node:sqlite accetta solo questi tipi come parametro: undefined diventa NULL.
  type Param = string | number | bigint | null | Uint8Array;
  const bind = (params: unknown[]) => params.map((p) => (p === undefined ? null : p)) as Param[];
  return {
    kind: "sqlite",
    async get<T>(sql: string, ...params: unknown[]) {
      return handle.prepare(sql).get(...bind(params)) as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return handle.prepare(sql).all(...bind(params)) as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      const result = handle.prepare(sql).run(...bind(params));
      return { changes: Number(result.changes) };
    },
    async exec(sql: string) {
      handle.exec(sql);
    },
    async close() {
      handle.close();
    },
  };
}

export function postgresDb(client: PgClient): Db {
  return {
    kind: "postgres",
    async get<T>(sql: string, ...params: unknown[]) {
      const result = await client.query(toPgPlaceholders(sql), params);
      const row = result.rows[0];
      return row ? normalizeRow<T>(row) : undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      const result = await client.query(toPgPlaceholders(sql), params);
      return result.rows.map((row) => normalizeRow<T>(row));
    },
    async run(sql: string, ...params: unknown[]) {
      const result = await client.query(toPgPlaceholders(sql), params);
      return { changes: Number(result.rowCount ?? result.affectedRows ?? 0) };
    },
    async exec(sql: string) {
      if (client.exec) await client.exec(sql);
      else await client.query(sql);
    },
    async close() {
      if (client.end) await client.end();
      else if (client.close) await client.close();
    },
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pg = await import("pg");
  const { Pool, types } = pg.default ?? pg;
  // BIGINT (OID 20): per noi sono millisecondi e byte, ben dentro il limite dei
  // numeri interi esatti di JavaScript. Senza, pg li restituirebbe come stringhe.
  types.setTypeParser(20, (value: string) => Number(value));
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });
  // In un orchestratore il database può partire dopo il server (Kubernetes non
  // ha un ordine di avvio): si riprova per un po' invece di uscire subito. Se
  // allo scadere non risponde, l'avvio fallisce con il messaggio di pg.
  const deadline = Date.now() + Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 60) * 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (error) {
      if (Date.now() >= deadline) {
        await pool.end().catch(() => undefined);
        throw error;
      }
      if (attempt === 1) console.log(`  PostgreSQL non ancora raggiungibile (${(error as Error).message}): riprovo…`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  return postgresDb(pool as unknown as PgClient);
}

let database: Db | null = null;

/**
 * Apre il database e applica lo schema. Va chiamata una volta all'avvio
 * (server, seed, test) prima di qualunque `db()`. `override` serve ai test, per
 * passare un motore già aperto (PGlite).
 */
export async function initDb(override?: Db): Promise<Db> {
  if (database && !override) return database;
  database =
    override ??
    (config.databaseUrl ? await openPostgres(config.databaseUrl) : sqliteDb(config.databasePath));
  await migrate(database);
  return database;
}

export function db(): Db {
  if (!database) throw new Error("Database non inizializzato: chiamare initDb() all'avvio.");
  return database;
}

export async function closeDb(): Promise<void> {
  await database?.close();
  database = null;
}

/**
 * Lo schema, identico per i due motori. I tempi sono millisecondi (Date.now()),
 * quindi BIGINT: in PostgreSQL INTEGER è a 32 bit e non li conterrebbe. Per
 * SQLite BIGINT è un INTEGER come un altro, e le tabelle già create con
 * INTEGER restano valide.
 */
async function migrate(d: Db): Promise<void> {
  await d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      provider      TEXT NOT NULL DEFAULT 'local',
      password_hash TEXT,
      external_id   TEXT UNIQUE,
      color         TEXT NOT NULL DEFAULT '#2563eb',
      locale        TEXT NOT NULL DEFAULT 'it',
      theme         TEXT NOT NULL DEFAULT 'system',
      accent        TEXT NOT NULL DEFAULT 'blue',
      created_at    BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maps (
      id                TEXT PRIMARY KEY,
      owner_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      description       TEXT NOT NULL DEFAULT '',
      project_json      TEXT,
      thumb             TEXT NOT NULL DEFAULT 'italia',
      general_access    TEXT NOT NULL DEFAULT 'private',
      general_role      TEXT NOT NULL DEFAULT 'viewer',
      collab_session_id TEXT,
      collab_host_token TEXT,
      created_at        BIGINT NOT NULL,
      updated_at        BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maps_owner ON maps(owner_id);

    -- Una riga per (mappa, utente): il vincolo UNIQUE è ciò che rende
    -- l'invito idempotente, invece di moltiplicare i permessi.
    CREATE TABLE IF NOT EXISTS shares (
      id         TEXT PRIMARY KEY,
      map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      created_by TEXT NOT NULL,
      UNIQUE (map_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);

    -- File caricati dagli utenti e serviti da Sestante. Il contenuto sta su
    -- disco (storage.ts): qui c'è solo ciò che serve a decidere chi può
    -- leggerlo e come etichettarlo.
    CREATE TABLE IF NOT EXISTS files (
      id           TEXT PRIMARY KEY,
      map_id       TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size         BIGINT NOT NULL,
      secret       TEXT NOT NULL,
      created_at   BIGINT NOT NULL,
      created_by   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_files_map ON files(map_id);

    CREATE TABLE IF NOT EXISTS invites (
      token      TEXT PRIMARY KEY,
      map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      expires_at BIGINT,
      max_uses   BIGINT,
      uses       BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      created_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invites_map ON invites(map_id);

    -- Traccia di chi ha fatto cosa su una mappa. Serve alla colonna "aggiornata
    -- da" in dashboard e, più avanti, all'audit richiesto in contesto operativo.
    CREATE TABLE IF NOT EXISTS activity (
      id         TEXT PRIMARY KEY,
      map_id     TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      user_id    TEXT NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_map ON activity(map_id, created_at);

    -- Invito "co-edit" della sessione del relay aperta su una mappa. Le
    -- sessioni nascono in sola lettura: si scrive solo presentando questo
    -- invito, che il server consegna soltanto a chi è editor in Sestante.
    -- Una tabella a sé, non una colonna di maps, perché i database esistenti
    -- la ricevano con CREATE TABLE IF NOT EXISTS invece che con un ALTER.
    CREATE TABLE IF NOT EXISTS collab_invites (
      session_id  TEXT PRIMARY KEY,
      map_id      TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      edit_invite TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    );
  `);
}

export function now(): number {
  return Date.now();
}

export function newId(): string {
  return randomUUID();
}

export async function logActivity(
  mapId: string,
  userId: string,
  action: string,
  detail = "",
): Promise<void> {
  await db().run(
    "INSERT INTO activity (id, map_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    newId(),
    mapId,
    userId,
    action,
    detail,
    now(),
  );
}
