/**
 * Archivio dei file caricati dagli utenti.
 *
 * Perché esiste: un livello GeoLibre creato aprendo un file locale **non
 * sopravvive** alla chiusura della mappa. GeoLibre, quando trasmette il
 * progetto verso l'esterno, per quei livelli scarta la geometria e conserva
 * solo il riferimento al file sul disco di chi l'ha aperto — riferimento che
 * per noi, e per chiunque riceva la condivisione, non significa nulla. Un
 * livello WMS invece porta con sé un URL raggiungibile, e infatti si ricarica.
 *
 * La cura è togliere il file dal disco dell'utente e metterlo dove la mappa
 * già vive: sul server, con i permessi della mappa.
 *
 * ── Perché un'interfaccia e non quattro chiamate a `fs` ──────────────────────
 * Oggi i file stanno in una cartella accanto al database: coerente con SQLite,
 * zero configurazione, il progetto si scompatta e funziona. Domani, in un
 * ambiente con più istanze o con volumi seri, stanno su MinIO o Apache Ozone —
 * entrambi S3. Quel passaggio deve toccare **questo solo file**, e per questo
 * la superficie qui sotto è deliberatamente la più piccola che serve: mettere,
 * leggere, cancellare. Nessuna nozione di percorso esce di qui, perché un
 * percorso è esattamente ciò che S3 non ha.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "./config.js";

export interface Storage {
  put(mapId: string, fileId: string, data: Buffer): Promise<void>;
  get(mapId: string, fileId: string): Promise<Buffer>;
  remove(mapId: string, fileId: string): Promise<void>;
  /** Chiamata quando si cancella una mappa: i suoi file se ne vanno con lei. */
  removeMap(mapId: string): Promise<void>;
}

/**
 * Identificativi ammessi nei percorsi.
 *
 * `mapId` e `fileId` li generiamo noi con `randomUUID()`, quindi questo
 * controllo non dovrebbe mai scattare. È scritto lo stesso perché è l'unico
 * punto in cui un valore diventa un percorso su disco: se un giorno uno dei due
 * arrivasse da una richiesta senza passare dal database, `../` non deve poter
 * uscire dalla cartella. Costa un confronto di regex e chiude la categoria.
 */
const ID = /^[a-zA-Z0-9-]{1,64}$/;

function safe(id: string, what: string): string {
  if (!ID.test(id)) throw new Error(`${what} non valido`);
  return id;
}

class LocalStorage implements Storage {
  constructor(private readonly root: string) {}

  private path(mapId: string, fileId: string): string {
    return join(this.root, safe(mapId, "mapId"), safe(fileId, "fileId"));
  }

  async put(mapId: string, fileId: string, data: Buffer): Promise<void> {
    const target = this.path(mapId, fileId);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  async get(mapId: string, fileId: string): Promise<Buffer> {
    return readFile(this.path(mapId, fileId));
  }

  async remove(mapId: string, fileId: string): Promise<void> {
    await rm(this.path(mapId, fileId), { force: true });
  }

  async removeMap(mapId: string): Promise<void> {
    await rm(join(this.root, safe(mapId, "mapId")), { recursive: true, force: true });
  }
}

export const storage: Storage = new LocalStorage(config.uploadsPath);

/**
 * Segreto di lettura del file, incorporato nell'URL del livello.
 *
 * Serve perché la richiesta al file **non arriva da Sestante**: arriva
 * dall'istanza GeoLibre dentro l'iframe, che è un'altra origine e quindi non
 * porta il nostro cookie di sessione. Senza un'autorizzazione che viaggi
 * nell'URL, l'unica alternativa sarebbe aprire il file a chiunque.
 *
 * Il compromesso, dichiarato: chi possiede l'URL completo legge il file, anche
 * se la condivisione della mappa gli viene tolta dopo. È la stessa semantica
 * del "chiunque abbia il link" che Sestante già offre sulle mappe, applicata al
 * singolo file; e il link esce solo dentro il progetto, che a sua volta si
 * ottiene solo passando dall'ACL. Chi non lo accetta, revoca cancellando il
 * file: il segreto è per file, non per mappa né per utente.
 */
export function newSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function checksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}
