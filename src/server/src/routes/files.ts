/**
 * File caricati dagli utenti: caricamento, servizio e cancellazione.
 *
 * Il problema che risolvono è descritto in `storage.ts`: un livello che GeoLibre
 * ha aperto da un file locale non sopravvive alla chiusura della mappa, perché
 * verso l'esterno GeoLibre ne trasmette solo il riferimento al disco di chi
 * l'ha aperto. Qui il file diventa una risorsa della mappa, con la vita e i
 * permessi della mappa.
 *
 * ── Due autorizzazioni, non una ─────────────────────────────────────────────
 * La lettura accetta due prove distinte, e la ragione è concreta: la richiesta
 * al file non parte da Sestante ma dall'istanza GeoLibre dentro l'iframe, che è
 * un'altra origine e quindi **non porta il cookie di sessione**. Quindi:
 *
 *   - sessione valida + ACL della mappa  → il percorso normale (anteprime,
 *     elenco, download dall'interfaccia Sestante);
 *   - segreto corretto nell'URL          → il percorso della mappa incorporata.
 *
 * Il secondo è una capacità: chi ha l'URL completo legge. Il compromesso è
 * discusso in `storage.ts`. Ciò che **non** si fa è aprire il file a chiunque
 * ne indovini l'identificativo, che è quello che succederebbe togliendo il
 * segreto e fidandosi dell'UUID.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { db, logActivity, newId, now, type FileRow } from "../db.js";
import { canEdit, loadMapFor } from "../acl.js";
import { checksum, newSecret, storage } from "../storage.js";
import { requireUser } from "./maps.js";

/** Origine dell'istanza GeoLibre: l'unica a cui si concede la lettura cross-origin. */
const geolibreOrigin = (() => {
  try {
    return new URL(config.geolibreUrl).origin;
  } catch {
    return "";
  }
})();

/**
 * Confronto del segreto a tempo costante: un confronto normale rivela, dalla
 * durata, quanti caratteri iniziali erano giusti. Su 24 byte casuali è un
 * attacco accademico, ma il rimedio costa una riga.
 */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Forme GeoJSON che accettiamo come radice di un file. */
const ROOT_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "GeometryCollection",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

function isGeoJson(value: unknown): value is { type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    ROOT_TYPES.has((value as { type: string }).type)
  );
}

/** Nome di comodo: etichetta il livello, non identifica nulla. */
function cleanName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  // Via i separatori di percorso: il nome finisce in un'etichetta e in un
  // header Content-Disposition, in nessun caso in un percorso su disco.
  const flat = name.replace(/[\\/]+/g, "-").slice(0, 120);
  return flat || "livello.geojson";
}

function describe(file: FileRow): { id: string; name: string; size: number; url: string } {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    // Assoluto, perché a seguirlo è l'iframe GeoLibre: un percorso relativo si
    // risolverebbe sulla *sua* origine, non sulla nostra.
    url: `${config.publicUrl}/api/maps/${file.map_id}/files/${file.id}?k=${file.secret}`,
  };
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  /** Elenco dei file di una mappa. Chi vede la mappa vede l'elenco. */
  app.get("/api/maps/:id/files", async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });

    const rows = await db().all<FileRow>(
      "SELECT * FROM files WHERE map_id = ? ORDER BY created_at DESC",
      id,
    );
    return { items: rows.map(describe) };
  });

  /**
   * Caricamento. Il corpo è `{ name, geojson }` con il GeoJSON già decodificato:
   * niente multipart, che costerebbe una dipendenza in più per trasportare un
   * documento che è comunque JSON.
   *
   * Il file viene **riserializzato** da ciò che il parser ha accettato, non
   * salvato byte per byte come è arrivato. Così su disco finisce solo JSON
   * valido, e un documento malformato fallisce qui invece che nel browser di
   * chi aprirà la mappa fra un mese.
   */
  app.post(
    "/api/maps/:id/files",
    { bodyLimit: config.uploadMaxBytes },
    async (request, reply) => {
      const user = await requireUser(request);
      if (!user) return reply.code(401).send({ error: "unauthenticated" });
      const { id } = request.params as { id: string };
      const found = await loadMapFor(id, user);
      if (!found) return reply.code(404).send({ error: "not-found" });
      if (!canEdit(found.role)) return reply.code(403).send({ error: "read-only" });

      const body = (request.body ?? {}) as { name?: unknown; geojson?: unknown };
      if (!isGeoJson(body.geojson)) return reply.code(400).send({ error: "not-geojson" });

      const data = Buffer.from(JSON.stringify(body.geojson), "utf8");
      if (data.byteLength > config.uploadMaxBytes) {
        return reply.code(413).send({ error: "file-too-large" });
      }

      const fileId = newId();
      const row: FileRow = {
        id: fileId,
        map_id: id,
        name: cleanName(body.name),
        content_type: "application/geo+json",
        size: data.byteLength,
        secret: newSecret(),
        created_at: now(),
        created_by: user.id,
      };

      // Prima il disco, poi il database: un file senza riga è spazio sprecato,
      // una riga senza file è un livello rotto in faccia all'utente.
      await storage.put(id, fileId, data);
      await db().run(
        `INSERT INTO files (id, map_id, name, content_type, size, secret, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        row.id,
          row.map_id,
          row.name,
          row.content_type,
          row.size,
          row.secret,
          row.created_at,
        row.created_by,
      );
      await logActivity(id, user.id, "file-uploaded", `${row.name} (${checksum(data)})`);

      return reply.code(201).send({ file: describe(row) });
    },
  );

  /** Lettura. È la rotta che segue l'iframe GeoLibre: vedi la nota in testa. */
  app.get("/api/maps/:id/files/:fileId", async (request, reply) => {
    const { id, fileId } = request.params as { id: string; fileId: string };
    const { k } = (request.query ?? {}) as { k?: string };

    const file = await db().get<FileRow>(
      "SELECT * FROM files WHERE id = ? AND map_id = ?",
      fileId,
      id,
    );
    if (!file) return reply.code(404).send({ error: "not-found" });

    const bySecret = typeof k === "string" && k.length > 0 && secretMatches(k, file.secret);
    if (!bySecret) {
      const user = await requireUser(request);
      if (!(await loadMapFor(id, user))) return reply.code(404).send({ error: "not-found" });
    }

    let data: Buffer;
    try {
      data = await storage.get(id, fileId);
    } catch {
      // Riga presente ma contenuto sparito: è una rottura nostra, non una
      // richiesta sbagliata, e va detta come tale invece di fingere un 404.
      request.log.error({ mapId: id, fileId }, "file mancante nell'archivio");
      return reply.code(500).send({ error: "file-missing" });
    }

    return sendFile(reply, file, data);
  });

  app.delete("/api/maps/:id/files/:fileId", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id, fileId } = request.params as { id: string; fileId: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canEdit(found.role)) return reply.code(403).send({ error: "read-only" });

    const result = await db().run("DELETE FROM files WHERE id = ? AND map_id = ?", fileId, id);
    // Solo un file di questa mappa: un id altrui o inventato non tocca il disco.
    if (result.changes === 0) return reply.code(404).send({ error: "not-found" });
    await storage.remove(id, fileId);
    await logActivity(id, user.id, "file-deleted", fileId);
    return { ok: true };
  });
}

function sendFile(reply: FastifyReply, file: FileRow, data: Buffer): FastifyReply {
  // Il permesso cross-origin è nominativo: solo l'istanza GeoLibre configurata.
  // `*` funzionerebbe identico ed è quello che si trova di solito negli esempi,
  // ma significherebbe che qualunque pagina aperta nel browser dell'utente può
  // leggere i suoi file avendone l'URL.
  if (geolibreOrigin) {
    reply.header("access-control-allow-origin", geolibreOrigin);
    reply.header("vary", "origin");
  }
  // Serve se la pagina che incorpora arriva con COEP: senza, il browser
  // scarterebbe la risposta pur avendola ricevuta.
  reply.header("cross-origin-resource-policy", "cross-origin");
  reply.header("content-type", file.content_type);
  // Il contenuto di un file non cambia mai: l'identificativo è nuovo a ogni
  // caricamento. Quindi si può memorizzare a lungo, ed è ciò che evita di
  // riscaricare qualche decina di megabyte a ogni riapertura della mappa.
  reply.header("cache-control", "private, max-age=31536000, immutable");
  return reply.send(data);
}
