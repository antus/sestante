/** Bootstrap del server Sestante. */
import { spawn } from "node:child_process";
import type { FastifyInstance } from "fastify";
import { collabEnabled, config, keycloakEnabled, setPublicUrl } from "./config.js";
import { initDb } from "./db.js";
import { buildApp } from "./app.js";
import { startEmbeddedRelay } from "./embedded-relay.js";
import { ensureDefaultUser } from "./bootstrap.js";

/** Quante porte successive prova l'eseguibile se quella configurata è occupata. */
const PORT_ATTEMPTS = 10;

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
  const app = await buildApp();

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
