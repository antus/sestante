/**
 * Popolamento iniziale: gli stessi utenti, mappe e condivisioni del mockup, così
 * al primo avvio l'applicazione è già piena e si può verificare il
 * comportamento dei ruoli senza costruire i dati a mano.
 *
 *   npm run db:reset          ricrea il database da zero
 *   npm run db:reset -- --keep  aggiunge i dati mancanti senza cancellare
 */
import { rmSync } from "node:fs";
import { config } from "./config.js";
import { closeDb, db, initDb, newId, now, type MapRow } from "./db.js";
import { createLocalUser, userByEmail } from "./users.js";

const DEMO_PASSWORD = "sestante2026";

interface SeedUser {
  email: string;
  name: string;
  color: string;
}

const USERS: SeedUser[] = [
  { email: "m.antonini@example.org", name: "Massimo Antonini", color: "#2563eb" },
  { email: "e.ricci@example.org", name: "Elena Ricci", color: "#059669" },
  { email: "d.colombo@example.org", name: "Davide Colombo", color: "#d946ef" },
  { email: "s.lombardi@example.org", name: "Sara Lombardi", color: "#f59e0b" },
  { email: "gis@protezionecivile.example.net", name: "Protezione Civile (esterna)", color: "#0891b2" },
];

interface SeedMap {
  name: string;
  description: string;
  thumb: string;
  owner: string;
  access: "private" | "org" | "link";
  shares: { email: string; role: "viewer" | "editor" }[];
}

const MAPS: SeedMap[] = [
  {
    name: "Rete di monitoraggio — Lazio",
    description:
      "14 stazioni idro-pluviometriche, sismiche e di qualità dell'aria sul bacino del Tevere.",
    thumb: "lazio",
    owner: "m.antonini@example.org",
    access: "org",
    shares: [
      { email: "e.ricci@example.org", role: "editor" },
      { email: "d.colombo@example.org", role: "editor" },
      { email: "s.lombardi@example.org", role: "viewer" },
      { email: "gis@protezionecivile.example.net", role: "viewer" },
    ],
  },
  {
    name: "Copertura Sentinel-2 Italia",
    description:
      "Mosaico COG trimestrale, indice NDVI e maschera nuvole per le regioni del centro-sud.",
    thumb: "italia",
    owner: "m.antonini@example.org",
    access: "private",
    shares: [{ email: "e.ricci@example.org", role: "viewer" }],
  },
  {
    name: "Catalogo STAC globale",
    description: "Indice delle collezioni Landsat, Sentinel e Prithvi disponibili nel data lake.",
    thumb: "mondo",
    owner: "m.antonini@example.org",
    access: "private",
    shares: [],
  },
  {
    name: "Rischio valanghe — Arco alpino",
    description: "Pendenze da DTM 10 m, esposizione e bollettini AINEVA sovrapposti.",
    thumb: "alpi",
    owner: "e.ricci@example.org",
    access: "link",
    shares: [
      { email: "m.antonini@example.org", role: "editor" },
      { email: "d.colombo@example.org", role: "editor" },
    ],
  },
  {
    name: "Traffico marittimo Mediterraneo",
    description: "Tracce AIS aggregate per cella H3, aggiornamento orario da NiFi.",
    thumb: "medit",
    owner: "gis@protezionecivile.example.net",
    access: "org",
    shares: [{ email: "m.antonini@example.org", role: "viewer" }],
  },
  {
    name: "Siti Copernicus EMS",
    description: "Attivazioni rapid mapping 2024–2026 con perimetri delle aree colpite.",
    thumb: "europa",
    owner: "e.ricci@example.org",
    access: "link",
    shares: [{ email: "m.antonini@example.org", role: "editor" }],
  },
];

async function main(): Promise<void> {
  const keep = process.argv.includes("--keep");
  if (!keep && !config.databaseUrl) {
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(`${config.databasePath}${suffix}`, { force: true });
    }
  }

  await initDb();
  const d = db();
  // Su PostgreSQL "da zero" vuol dire svuotare le tabelle, non cancellare un file.
  if (!keep && config.databaseUrl) {
    for (const table of ["collab_invites", "activity", "invites", "files", "shares", "maps", "users"]) {
      await d.run(`DELETE FROM ${table}`);
    }
  }
  const ids = new Map<string, string>();

  for (const seed of USERS) {
    const existing = await userByEmail(seed.email);
    const user = existing ?? (await createLocalUser(seed.email, seed.name, DEMO_PASSWORD));
    await d.run("UPDATE users SET display_name = ?, color = ? WHERE id = ?", seed.name, seed.color, user.id);
    ids.set(seed.email, user.id);
  }

  const offsets = [12 * 60_000, 3 * 3_600_000, 9 * 86_400_000, 86_400_000, 2 * 86_400_000, 5 * 86_400_000];

  for (const [index, seed] of MAPS.entries()) {
    const ownerId = ids.get(seed.owner);
    if (!ownerId) continue;

    const existing = await d.get<MapRow>(
      "SELECT * FROM maps WHERE name = ? AND owner_id = ?",
      seed.name,
      ownerId,
    );
    if (existing) continue;

    const mapId = newId();
    const updatedAt = now() - (offsets[index] ?? 0);
    await d.run(
      `INSERT INTO maps (id, owner_id, name, description, project_json, thumb,
                         general_access, general_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'viewer', ?, ?)`,
      mapId,
      ownerId,
      seed.name,
      seed.description,
      seed.thumb,
      seed.access,
      updatedAt,
      updatedAt,
    );

    for (const share of seed.shares) {
      const userId = ids.get(share.email);
      if (!userId || userId === ownerId) continue;
      await d.run(
        `INSERT INTO shares (id, map_id, user_id, role, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
        newId(),
        mapId,
        userId,
        share.role,
        updatedAt,
        ownerId,
      );
    }
  }

  console.log(
    [
      "",
      "  Database popolato.",
      `  Database: ${config.databaseUrl ? config.databaseUrl.replace(/\/\/[^@]*@/, "//…@") : config.databasePath}`,
      `  Utenti:   ${USERS.length} (password comune: ${DEMO_PASSWORD})`,
      `  Mappe:    ${MAPS.length}`,
      "",
      "  Accedi con m.antonini@example.org / " + DEMO_PASSWORD,
      "",
    ].join("\n"),
  );
}

await main();
await closeDb();
