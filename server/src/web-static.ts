/**
 * Il client React, servito dalla stessa origine delle API.
 *
 * Fuori dall'eseguibile è la cartella web/dist (se il client è stato
 * compilato). Dentro Sestante.exe è un insieme di asset incorporati, con un
 * indice `web/manifest.json` scritto da scripts/build-exe.mjs: l'API degli asset
 * di Node legge una chiave alla volta e non sa elencarle su tutte le versioni.
 *
 * ── Il percorso dell'app ────────────────────────────────────────────────────
 * Il client è compilato con indirizzi relativi (./assets/…, api/…). La pagina
 * index.html la serve sempre il server, con dentro `<base href="<percorso>">`:
 * così lo stesso build funziona alla radice e sotto /sestante/, anche sulle
 * rotte profonde come /sestante/m/<id>.
 */
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { isPackaged, packagedAsset, webDistDir } from "./paths.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".map": "application/json; charset=utf-8",
};

/** Percorsi che non sono del client: non vanno mai risolti in index.html. */
const isServerPath = (url: string) => url.startsWith("/api/") || url.startsWith("/gis/");

/** index.html con il percorso dell'app, come primo elemento di <head>. */
function withBase(html: string): string {
  const tag = `<base href="${config.appBase}" />`;
  return html.includes("<base ") ? html : html.replace(/<head>/i, `<head>\n    ${tag}`);
}

function sendIndex(reply: FastifyReply, html: string) {
  return reply.type(TYPES[".html"]!).header("cache-control", "no-cache").send(html);
}

export async function webRoutes(app: FastifyInstance): Promise<boolean> {
  if (isPackaged) {
    const manifest = packagedAsset("web/manifest.json");
    if (!manifest) return false;
    const files = new Set<string>(JSON.parse(manifest.toString("utf8")) as string[]);
    const index = withBase(packagedAsset("web/index.html")!.toString("utf8"));

    app.get("/*", async (request, reply) => {
      const path = decodeURIComponent(request.url.split("?")[0] ?? "/").replace(/^\/+/, "");
      if (path !== "index.html" && files.has(path)) {
        const body = packagedAsset(`web/${path}`)!;
        return reply
          .type(TYPES[extname(path)] ?? "application/octet-stream")
          .header(
            "cache-control",
            path.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
          )
          .send(body);
      }
      if (isServerPath(request.url)) return reply.code(404).send({ error: "not-found" });
      return sendIndex(reply, index);
    });
    return true;
  }

  const indexPath = join(webDistDir, "index.html");
  if (!existsSync(indexPath)) return false;
  const index = withBase(readFileSync(indexPath, "utf8"));
  // index: false — la pagina non la serve fastify-static: "/" e le rotte del
  // client cadono nel gestore qui sotto, che la manda con il percorso dentro.
  await app.register(fastifyStatic, { root: webDistDir, prefix: "/", index: false });
  // La radice è una cartella: senza indice fastify-static risponderebbe 403.
  app.get("/", async (_request, reply) => sendIndex(reply, index));
  app.setNotFoundHandler((request, reply) => {
    if (isServerPath(request.url)) return reply.code(404).send({ error: "not-found" });
    return sendIndex(reply, index);
  });
  return true;
}
