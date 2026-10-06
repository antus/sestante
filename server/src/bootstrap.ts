/**
 * L'utente di default: il primo account, creato al primo avvio.
 *
 * Ogni distribuzione deve potersi usare appena installata, anche quando la
 * registrazione è chiusa (installazioni server, dove si entra con Keycloak o
 * con gli account creati da chi amministra). Per questo, se il database non ha
 * ancora nessun utente, il server ne crea uno locale:
 *
 *   DEFAULT_USER_EMAIL     default admin@example.org
 *   DEFAULT_USER_NAME      default "Amministratore"
 *   DEFAULT_USER_PASSWORD  vedi sotto
 *   DEFAULT_USER=off       per non crearlo affatto
 *
 * La password: quella di DEFAULT_USER_PASSWORD se c'è. Altrimenti, in modalità
 * `local` (eseguibile, servizio Windows: il server ascolta solo su 127.0.0.1)
 * una password nota e documentata; in modalità `server` una password casuale,
 * scritta una volta sola nel log di avvio — un server condiviso non deve
 * partire con una password che conoscono tutti.
 *
 * Solo a database vuoto: non si ricrea un utente cancellato, né si reimposta
 * una password cambiata, a ogni riavvio.
 */
import { randomBytes, randomInt } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";
import { passwordProblem } from "./auth/passwords.js";
import { createLocalUser } from "./users.js";

/** Password dell'utente di default in modalità local, se non configurata. */
export const LOCAL_DEFAULT_PASSWORD = "sestante2026";

export interface DefaultUserReport {
  email: string;
  password: string;
  /** La password è stata generata ora: va mostrata, non la sa nessun altro. */
  generated: boolean;
  /** Viene da DEFAULT_USER_PASSWORD: un segreto configurato non va nel log. */
  configured: boolean;
}

function env(key: string): string {
  return (process.env[key] ?? "").trim();
}

export async function ensureDefaultUser(): Promise<DefaultUserReport | null> {
  if (env("DEFAULT_USER").toLowerCase() === "off") return null;
  const existing = await db().get<{ n: number }>("SELECT COUNT(*) AS n FROM users");
  if (Number(existing?.n ?? 0) > 0) return null;

  const email = (env("DEFAULT_USER_EMAIL") || "admin@example.org").toLowerCase();
  const name = env("DEFAULT_USER_NAME") || "Amministratore";
  let password = env("DEFAULT_USER_PASSWORD");
  const configured = Boolean(password);
  let generated = false;
  if (!password) {
    if (config.mode === "server") {
      // Una lettera e due cifre garantite: la sola parte casuale potrebbe non
      // averne, e la regola sulle password (lettere e numeri) la rifiuterebbe.
      password = `S${randomBytes(12).toString("base64url")}${randomInt(10, 100)}`;
      generated = true;
    } else {
      password = LOCAL_DEFAULT_PASSWORD;
    }
  }
  const problem = passwordProblem(password);
  if (problem) {
    throw new Error(
      `DEFAULT_USER_PASSWORD non valida (${problem}): almeno 10 caratteri, con lettere e numeri.`,
    );
  }

  await createLocalUser(email, name, password);
  return { email, password, generated, configured };
}
