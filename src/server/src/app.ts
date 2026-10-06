/**
 * L'applicazione Fastify, senza avviarla: la usa index.ts per mettersi in
 * ascolto e i test d'integrazione per interrogarla con app.inject().
 */
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { config } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { mapRoutes } from "./routes/maps.js";
import { shareRoutes } from "./routes/shares.js";
import { collabRoutes } from "./routes/collab.js";
import { fileRoutes } from "./routes/files.js";
import { geolibreRoutes } from "./routes/geolibre.js";
import { webRoutes } from "./web-static.js";

/** Toglie il percorso dell'app dall'URL di una richiesta. */
export function stripBase(url: string, base = config.appBase): string {
  if (base === "/") return url;
  const bare = base.slice(0, -1); // "/sestante"
  if (url === bare || url.startsWith(`${bare}?`)) return `/${url.slice(bare.length)}`;
  if (url.startsWith(base)) return `/${url.slice(base.length)}`;
  return url;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    // Nessun transport pino-pretty: è una comodità che costa una dipendenza in
    // più e un avvio che fallisce se non è installata.
    logger: { level: config.isProduction ? "info" : "warn" },
    trustProxy: true,
    // Il limite predefinito di Fastify è 1 MiB, cioè meno del progetto che
    // PATCH /api/maps/:id dichiara di accettare (10 MiB): senza questa riga il
    // rifiuto arriverebbe dal parser, con un errore generico, prima ancora che
    // la rotta possa dire `project-too-large`. Il caricamento dei file alza il
    // proprio limite per conto suo, sulla singola rotta.
    bodyLimit: 12 * 1024 * 1024,
    // Pubblicata sotto un percorso (APP_BASE, o il percorso di PUBLIC_URL), l'app
    // riceve /sestante/api/…: il prefisso si toglie qui, all'ingresso, così ogni
    // rotta resta scritta una volta sola. Le richieste senza prefisso passano
    // com'erano: le usano il controllo di salute del container e chi parla al
    // server direttamente, senza passare dal proxy.
    rewriteUrl: (request) => stripBase(request.url ?? "/"),
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error }, "richiesta fallita");
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? "internal-error" : error.message });
  });

  // Intestazioni di sicurezza su ogni risposta. GeoLibre (/gis/) ha già la sua
  // CSP, più ricca: qui si aggiunge solo ciò che manca. Le pagine dell'app non
  // si incorporano in siti altrui (frame-ancestors).
  app.addHook("onSend", async (_request, reply, payload) => {
    if (!reply.hasHeader("x-content-type-options")) reply.header("x-content-type-options", "nosniff");
    if (!reply.hasHeader("referrer-policy")) reply.header("referrer-policy", "strict-origin-when-cross-origin");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.startsWith("text/html") && !reply.hasHeader("content-security-policy")) {
      reply.header("content-security-policy", "frame-ancestors 'self'");
      reply.header("x-frame-options", "SAMEORIGIN");
    }
    return payload;
  });

  await app.register(cookie);
  await app.register(authRoutes);
  await app.register(mapRoutes);
  await app.register(shareRoutes);
  await app.register(collabRoutes);
  await app.register(fileRoutes);
  await app.register(geolibreRoutes);

  // Il server serve anche il client, così app, API e GeoLibre stanno sulla
  // stessa origine e il cookie di sessione non è mai cross-site.
  await webRoutes(app);
  return app;
}
