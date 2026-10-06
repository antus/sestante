/**
 * Il relay di collaborazione di GeoLibre ospitato nel processo del server.
 *
 * Si attiva con COLLAB_EMBEDDED=1 ed è pensato per l'eseguibile: chi fa doppio
 * clic ottiene presenza e sessioni condivise senza avviare un secondo
 * programma. Il codice resta quello di GeoLibre (geolibre-dist/relay/relay.cjs,
 * o relay/relay.cjs accanto all'eseguibile), caricato con require() e avviato
 * con createRelay(): nessuna copia, nessuna modifica.
 *
 * In un'installazione server il relay resta un processo a sé (npm run relay o
 * il suo container), perché ha un ciclo di vita e una scalabilità propri.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Server } from "node:http";
import { config } from "./config.js";
import { appRoot } from "./paths.js";

interface RelayModule {
  createRelay(options?: {
    dbPath?: string;
    identitySecret?: string;
  }): { server: Server; close: () => Promise<void> };
}

/** Origini da cui il relay accetta connessioni: quelle da cui si apre l'app. */
export function allowRelayOrigins(publicUrl: string): void {
  const url = new URL(publicUrl);
  const origins = new Set([url.origin]);
  if (url.hostname === "localhost") origins.add(url.origin.replace("localhost", "127.0.0.1"));
  if (url.hostname === "127.0.0.1") origins.add(url.origin.replace("127.0.0.1", "localhost"));
  // Il relay legge ALLOWED_ORIGINS a ogni richiesta: aggiornarla basta.
  process.env.ALLOWED_ORIGINS = [...origins].join(",");
}

/**
 * Avvia il relay sulla porta di COLLAB_URL. Un fallimento non ferma Sestante:
 * la collaborazione risulterà non raggiungibile su /api/collab/status e il
 * client lo dichiara, come quando il relay esterno è spento.
 */
export async function startEmbeddedRelay(): Promise<string> {
  if (!existsSync(config.collab.relayFile)) {
    return `non avviata: manca ${config.collab.relayFile} (npm run build:geolibre)`;
  }
  const { port, hostname } = new URL(config.collab.url);
  // createRequire, non require: nell'eseguibile require() carica solo i moduli
  // integrati di Node, non file dal disco.
  const load = createRequire(join(appRoot, "noop.js"));
  const relayModule = load(config.collab.relayFile) as RelayModule;
  const relay = relayModule.createRelay({
    dbPath: join(config.dataDir, "collab.sqlite"),
    identitySecret: config.collab.identitySecret,
  });
  allowRelayOrigins(config.publicUrl);

  return new Promise((resolve) => {
    relay.server.once("error", (error: NodeJS.ErrnoException) => {
      resolve(`non avviata: ${error.code === "EADDRINUSE" ? `porta ${port} occupata` : error.message}`);
    });
    relay.server.listen(Number(port) || 8787, hostname, () => {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
          relay.close().finally(() => process.exit(0));
        });
      }
      resolve(`${config.collab.url} (relay nel processo)`);
    });
  });
}
