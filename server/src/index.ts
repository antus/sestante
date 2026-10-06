/** Bootstrap del server Sestante. */
import { spawn } from "node:child_process";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { collabEnabled, config, keycloakEnabled, setPublicUrl } from "./config.js";
import { initDb } from "./db.js";
import { authRoutes } from "./routes/auth.js";
import { mapRoutes } from "./routes/maps.js";
import { shareRoutes } from "./routes/shares.js";
import { collabRoutes } from "./routes/collab.js";
import { fileRoutes } from "./routes/files.js";
import { geolibreRoutes } from "./routes/geolibre.js";
import { webRoutes } from "./web-static.js";
import { startEmbeddedRelay } from "./embedded-relay.js";
import { ensureDefaultUser } from "./bootstrap.js";

/** Toglie il percorso dell'app dall'URL di una richiesta. */
export function stripBase(url: string, base = config.appBase): string {
  if (base === "/") return url;
  const bare = base.slice(0, -1); // "/sestante"
  if (url === bare || url.startsWith(`${bare}?`)) return `/${url.slice(bare.length)}`;
  if (url.startsWith(base)) return `/${url.slice(base.length)}`;
  return url;
}

/** Quante porte successive prova l'eseguibile se quella configurata è occupata. */
const PORT_ATTEMPTS = 10;

async function build(): Promise<FastifyInstance> {
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

/**
 * L'eseguibile non deve fallire perché la 4000 è occupata da qualcos'altro: chi
 * fa doppio clic non ha modo di cambiare una variabile d'ambiente. Prova le
 * porte successive e aggiorna l'origine pubblica di conseguenza. Fuori
 * dall'eseguibile una porta occupata resta un errore: lì la porta è configurata
 * e il proxy di Vite la dà per scontata.
 */
async function listen(app: FastifyInstance): Promise<number> {
  const attempts = config.isPackaged && !process.env.PORT ? PORT_ATTEMPTS : 1;
  for (let i = 0; i < attempts; i++) {
    const port = config.port + i;
    try {
      await app.listen({ port, host: config.host });
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || i === attempts - 1) throw error;
    }
  }
  throw new Error("unreachable");
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command as string, args as string[], { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  // Il database prima di tutto: apre la connessione e applica lo schema prima
  // di accettare richieste, e con PostgreSQL irraggiungibile l'avvio fallisce qui.
  await initDb();
  // Al primo avvio, a database vuoto: l'account con cui entrare (bootstrap.ts).
  const defaultUser = await ensureDefaultUser();
  const app = await build();

  const port = await listen(app);
  if (config.isPackaged && !process.env.PUBLIC_URL) setPublicUrl(`http://localhost:${port}`);
  // Dopo listen: le origini ammesse dal relay dipendono dalla porta effettiva.
  const collabStatus = config.collab.embedded
    ? await startEmbeddedRelay()
    : collabEnabled
      ? config.collab.url
      : "disattivata";

  const line = (label: string, value: string) => `  ${label.padEnd(22)}${value}`;
  console.log(
    [
      "",
      "  Sestante — server avviato",
      line("Modalità", config.mode),
      line("API", `http://${config.host}:${port}`),
      line("Client", config.publicUrl),
      ...(config.appBase !== "/" ? [line("Percorso", config.appBase)] : []),
      line("Dati", config.dataDir),
      line(
        "Database",
        config.databaseUrl ? `PostgreSQL ${config.databaseUrl.replace(/\/\/[^@]*@/, "//…@")}` : config.databasePath,
      ),
      line("File caricati", config.uploadsPath),
      line("Autenticazione", keycloakEnabled ? "locale + Keycloak" : "solo locale"),
      line("Collaborazione", collabStatus),
      ...(defaultUser
        ? [
            "",
            "  Primo avvio: creato l'utente di default",
            line("Email", defaultUser.email),
            line(
              "Password",
              defaultUser.configured
                ? "quella di DEFAULT_USER_PASSWORD"
                : defaultUser.generated
                  ? `${defaultUser.password}   (generata ora: annotala, non verrà più mostrata)`
                  : defaultUser.password,
            ),
          ]
        : []),
      line(
        "GeoLibre",
        config.geolibre.selfHosted ? `${config.geolibreUrl} (${config.geolibre.dir})` : config.geolibreUrl,
      ),
      ...(config.geolibre.baseMismatch ? ["", `  ATTENZIONE: ${config.geolibre.baseMismatch}`] : []),
      "",
      ...(config.isPackaged ? ["  Chiudi questa finestra per fermare Sestante.", ""] : []),
    ].join("\n"),
  );

  if (config.isPackaged && process.env.SESTANTE_NO_BROWSER !== "1") openBrowser(config.publicUrl);
}

main().catch((error: unknown) => {
  console.error("\n  Avvio non riuscito:", error instanceof Error ? error.message : error, "\n");
  // Nell'eseguibile la finestra si chiuderebbe portandosi via il messaggio.
  if (config.isPackaged) setTimeout(() => process.exit(1), 30_000);
  else process.exit(1);
});
