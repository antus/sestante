/**
 * GeoLibre servito da Sestante, sotto /gis/, sulla stessa origine dell'app.
 *
 * È il build statico prodotto da scripts/build-geolibre.mjs a partire dal
 * sorgente originale, a un commit fissato: nessun fork, nessun CDN. Stare sulla
 * stessa origine è ciò che rende possibili, senza configurazioni incrociate, il
 * cookie di sessione sulle letture dei file, l'API embed e l'assenza del blocco
 * https→http.
 *
 * Due file non sono statici, perché dipendono dall'installazione e non dal
 * build — è lo stesso meccanismo con cui l'immagine Docker di GeoLibre si
 * riconfigura a ogni avvio (docker/entrypoint.sh), qui fatto dal server:
 *
 *  - geolibre-runtime-config.js → window.__GEOLIBRE_DEPLOYMENT_ENV__
 *    (origini embed, server di condivisione, catalogo servizi, relay) e, con
 *    la collaborazione nella mappa attiva, l'aggancio di geolibre-bridge.ts;
 *
 * Le intestazioni ricalcano docker/nginx.conf di GeoLibre, così il build si
 * comporta come nell'immagine ufficiale.
 */
import { readFileSync } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { collabBrowserWsBase, collabInMap, config } from "../config.js";
import { GEOLIBRE_COLLAB_BRIDGE } from "../geolibre-bridge.js";

const PREFIX = "/gis/";

/**
 * CSP dell'app, da docker/nginx.conf. Rispetto all'originale mancano solo i
 * segnaposto di Clerk e Auth0 (non li usiamo: l'accesso lo fa Sestante) e c'è
 * frame-ancestors, perché GeoLibre si incorpori solo dentro Sestante.
 */
/**
 * Il relay pubblico, se non è già coperto dalle voci di loopback (che valgono
 * solo per ws://: un wss://localhost, come nel compose locale, va aggiunto).
 */
const collabConnectSrc = (() => {
  if (!collabInMap) return "";
  const url = new URL(collabBrowserWsBase());
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return url.protocol === "ws:" && loopback ? "" : ` ${url.origin}`;
})();

const APP_CSP = [
  "default-src 'self'",
  `connect-src 'self' https: data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*${collabConnectSrc}`,
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data: https://js.arcgis.com/",
  "script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/ https://cdn.jsdelivr.net/pyodide/ https://js.arcgis.com/ https://api.mapbox.com/mapbox-gl-js/",
  "child-src 'self'",
  "frame-src 'self'",
  "worker-src blob: 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** CSP del notebook JupyterLite incluso nel build, anch'essa da nginx.conf. */
const JUPYTERLITE_CSP = [
  "default-src 'self'",
  "connect-src 'self' https: data: blob:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' blob: 'unsafe-eval' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/ https://cdn.jsdelivr.net/pyodide/ https://api.mapbox.com/mapbox-gl-js/",
  "worker-src blob: 'self'",
  "frame-ancestors 'self'",
].join("; ");

/** Asset con hash nel nome: immutabili. Tutto il resto si rivalida. */
const IMMUTABLE = /\.(?:css|js|mjs|png|jpg|jpeg|gif|ico|svg|webp|avif|wasm|woff2?|ttf|otf)$/i;
const ALWAYS_REVALIDATE = new Set(["index.html", "sw.js", "manifest.webmanifest"]);

function cacheControl(relativePath: string): string {
  const path = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (ALWAYS_REVALIDATE.has(path) || path.startsWith("plugins/")) return "no-cache, must-revalidate";
  if (path.startsWith("jupyterlite/")) return "no-cache";
  return IMMUTABLE.test(path) ? "public, max-age=31536000, immutable" : "no-cache, must-revalidate";
}

interface ServiceEntry {
  id: string;
  name: string;
  kind: string;
  fields: Record<string, string | number | boolean>;
  category?: string;
}

const SERVICE_KINDS = new Set(["wms", "wfs", "wmts", "xyz", "arcgis", "csw"]);

/**
 * Catalogo servizi, con gli stessi controlli dell'entrypoint di GeoLibre. Un
 * file sbagliato ferma l'avvio: meglio un errore chiaro adesso che un catalogo
 * vuoto senza spiegazioni.
 */
function loadServices(): string | undefined {
  if (!config.geolibre.servicesFile) return undefined;
  const raw = JSON.parse(readFileSync(config.geolibre.servicesFile, "utf8")) as {
    services?: unknown;
  };
  if (!Array.isArray(raw.services)) {
    throw new Error(`${config.geolibre.servicesFile}: serve un oggetto con un array "services"`);
  }
  const ids = new Set<string>();
  const services = raw.services.map((entry: ServiceEntry, index: number) => {
    const where = `${config.geolibre.servicesFile}, servizio ${index + 1}`;
    if (!entry?.id?.trim() || !entry?.name?.trim()) throw new Error(`${where}: id e name sono obbligatori`);
    if (ids.has(entry.id.trim())) throw new Error(`${where}: id duplicato`);
    if (!SERVICE_KINDS.has(entry.kind)) throw new Error(`${where}: kind non valido (${entry.kind})`);
    if (!entry.fields || typeof entry.fields !== "object" || !Object.keys(entry.fields).length) {
      throw new Error(`${where}: fields deve essere un oggetto non vuoto`);
    }
    ids.add(entry.id.trim());
    const service: ServiceEntry = {
      id: entry.id.trim(),
      name: entry.name.trim(),
      kind: entry.kind,
      fields: entry.fields,
    };
    if (typeof entry.category === "string") service.category = entry.category;
    return service;
  });
  return JSON.stringify({ services });
}

function requestOrigin(request: FastifyRequest): string {
  return `${request.protocol}://${request.host}`;
}

export async function geolibreRoutes(app: FastifyInstance): Promise<void> {
  if (!config.geolibre.selfHosted) return;

  const services = loadServices();

  // Le intestazioni valgono per tutto ciò che sta sotto /gis/, statico o no.
  app.addHook("onSend", async (request, reply) => {
    if (!request.url.startsWith(PREFIX)) return;
    const path = request.url.slice(PREFIX.length).split("?")[0] ?? "";
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "strict-origin-when-cross-origin");
    reply.header(
      "content-security-policy",
      path.startsWith("jupyterlite/") ? JUPYTERLITE_CSP : APP_CSP,
    );
  });

  app.get("/gis", async (request, reply) => {
    const query = request.url.slice("/gis".length);
    // Verso l'indirizzo pubblico, con il percorso dell'app davanti.
    return reply.redirect(`${config.geolibre.prefix}${query.startsWith("?") ? query : ""}`, 301);
  });

  app.get(`${PREFIX}geolibre-runtime-config.js`, async (request, reply) => {
    // Le origini a cui GeoLibre accetta comandi: quella pubblica e quella da
    // cui la pagina è arrivata davvero (localhost e 127.0.0.1 sono origini
    // diverse per il browser, e l'eseguibile si apre su una delle due).
    const origins = [...new Set([new URL(config.publicUrl).origin, requestOrigin(request)])];
    const deployment: Record<string, string> = {
      VITE_GEOLIBRE_EMBED_ORIGINS: origins.join(","),
      VITE_GEOLIBRE_SHARE_URL: "off",
    };
    if (services) deployment.VITE_GEOLIBRE_SERVICES = services;
    // Il relay a cui GeoLibre si collega da sé, nella sessione che Sestante
    // gli indica con ?collab=. Senza, GeoLibre nasconde la collaborazione.
    if (collabInMap) deployment.VITE_GEOLIBRE_COLLAB_URL = collabBrowserWsBase();
    if (config.geolibre.builtinServices === "off") deployment.VITE_GEOLIBRE_BUILTIN_SERVICES = "off";

    reply
      .type("text/javascript; charset=utf-8")
      .header("cache-control", "no-store")
      .send(
        `window.__GEOLIBRE_DEPLOYMENT_ENV__ = ${JSON.stringify(deployment)};\n` +
          (collabInMap ? GEOLIBRE_COLLAB_BRIDGE : ""),
      );
  });

  await app.register(fastifyStatic, {
    root: config.geolibre.dir,
    prefix: PREFIX,
    // Il client React registra già sendFile: qui una seconda istanza, senza
    // ridecorare la reply.
    decorateReply: false,
    cacheControl: false,
    setHeaders(res, path) {
      res.header("cache-control", cacheControl(path.slice(config.geolibre.dir.length)));
    },
  });
}
