/**
 * Configurazione centralizzata, letta una sola volta all'avvio.
 *
 * Regola: nessuna funzionalità opzionale rompe l'avvio se non configurata.
 * Senza KEYCLOAK_ISSUER l'SSO è spento e resta l'autenticazione locale; senza
 * COLLAB_URL la presenza è spenta e l'editor funziona in solitaria. Il server
 * dichiara cosa è attivo su GET /api/config e il client si adatta.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { appRoot, defaultDataDir, defaultGeolibreDir, isPackaged } from "./paths.js";

/** .env minimale: niente dipendenze, e le variabili d'ambiente reali vincono. */
function loadDotEnv(): void {
  const candidates = isPackaged
    ? [join(appRoot, "sestante.env"), join(appRoot, ".env")]
    : [resolve(appRoot, ".env"), resolve(appRoot, "../.env")];
  for (const candidate of candidates) {
    let raw: string;
    try {
      raw = readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return;
  }
}
loadDotEnv();

function str(key: string, fallback = ""): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}
function num(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

/**
 * `local`: una postazione, un utente o pochi, tutto su 127.0.0.1. È il default
 * e quello dell'eseguibile. `server`: installazione condivisa dietro un proxy
 * TLS, dove i segreti vanno configurati e non generati.
 */
export type Mode = "local" | "server";
const mode: Mode = str("SESTANTE_MODE", "local") === "server" ? "server" : "local";

const isProduction = str("NODE_ENV") === "production";
const dataDir = resolve(appRoot, str("DATA_DIR", defaultDataDir));
const port = num("PORT", 4000);

/**
 * In locale il segreto di sessione si genera al primo avvio e si conserva nella
 * cartella dei dati: chi scompatta lo zip non deve configurare nulla, e le
 * sessioni sopravvivono a un riavvio. In server va dato esplicitamente.
 */
/** Segreto generato al primo avvio e conservato nella cartella dei dati. */
function persistedSecret(name: string): string {
  const file = join(dataDir, name);
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dirname(file), { recursive: true });
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function resolveSessionSecret(): string {
  const configured = str("SESSION_SECRET");
  if (configured && configured !== "dev-only-change-me") return configured;
  if (mode === "server" || isProduction) {
    throw new Error(
      "SESSION_SECRET non configurato. In modalità server va impostato a un valore casuale: " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
    );
  }
  return persistedSecret(".session-secret");
}

/**
 * Relay ospitato nel processo del server (COLLAB_EMBEDDED=1): è come
 * l'eseguibile offre la collaborazione senza un secondo programma. Server e
 * relay sono lo stesso processo, quindi il segreto condiviso si genera da sé e
 * non può divergere.
 */
const collabEmbedded = bool("COLLAB_EMBEDDED", false);

/** "/x/y/" con una barra sola all'inizio e alla fine; "/" per la radice. */
export function normalizeBase(value: string): string {
  const trimmed = value.trim().replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/**
 * Indirizzo pubblico e percorso dell'app, una sola fonte. Il percorso si legge
 * da PUBLIC_URL (https://host/sestante → /sestante/); APP_BASE lo impone
 * esplicitamente, e in quel caso finisce anche in PUBLIC_URL.
 */
const publicUrlRaw = str(
  "PUBLIC_URL",
  isPackaged ? `http://localhost:${port}` : "http://localhost:5173",
).replace(/\/+$/, "");
const appBase = normalizeBase(str("APP_BASE", new URL(publicUrlRaw).pathname));
const publicUrl = `${new URL(publicUrlRaw).origin}${appBase}`.replace(/\/$/, "");

/**
 * GeoLibre servito da noi su <base>gis/ se il build c'è; altrimenti l'istanza
 * pubblica, così un checkout senza `npm run build:geolibre` resta usabile.
 *
 * Il percorso è fissato nel build di GeoLibre (i suoi asset, il service worker,
 * i worker lo usano in assoluto): un build fatto per /gis/ non funziona sotto
 * /sestante/gis/. Lo si legge dall'index.html del build e lo si confronta con
 * quello che serve, invece di servire una mappa che non si caricherebbe.
 */
const geolibreDir = resolve(appRoot, str("GEOLIBRE_DIST", defaultGeolibreDir));
const geolibreExpectedBase = `${appBase}gis/`;
const geolibreBuiltBase = (() => {
  try {
    const html = readFileSync(join(geolibreDir, "index.html"), "utf8");
    return html.match(/src="([^"]*)geolibre-runtime-config\.js"/)?.[1] ?? null;
  } catch {
    return null;
  }
})();
const geolibreBaseMismatch =
  geolibreBuiltBase !== null && geolibreBuiltBase !== geolibreExpectedBase
    ? `GeoLibre in ${geolibreDir} è compilato per ${geolibreBuiltBase}, ma l'app è su ${appBase}: ` +
      `ricompilalo con  APP_BASE=${appBase} npm run build:geolibre`
    : "";
const geolibreSelfHosted = geolibreBuiltBase !== null && !geolibreBaseMismatch;

export const config = {
  mode,
  isPackaged,
  isProduction,
  port,
  host: str("HOST", mode === "server" ? "0.0.0.0" : "127.0.0.1"),
  /**
   * Origine pubblica: per i redirect OIDC e i link di condivisione. Mutabile
   * solo per l'eseguibile, che può ripiegare su un'altra porta se 4000 è
   * occupata (vedi index.ts).
   */
  publicUrl,
  /**
   * Percorso sotto cui è pubblicata l'app ("/" o "/sestante/"). Il server
   * risponde sia sotto il percorso sia alla radice (vedi index.ts), il client
   * lo riceve come <base href> nella pagina.
   */
  appBase,
  sessionSecret: resolveSessionSecret(),
  sessionTtlSeconds: num("SESSION_TTL", 60 * 60 * 12),
  dataDir,
  /**
   * `postgres://…` per usare PostgreSQL; vuoto = SQLite in `databasePath`. I
   * file caricati restano comunque su disco, in `uploadsPath`.
   */
  databaseUrl: /^postgres(ql)?:\/\//.test(str("DATABASE_URL")) ? str("DATABASE_URL") : "",
  // Un percorso esplicito si legge, come sempre, rispetto alla radice; il
  // default sta nella cartella dei dati.
  databasePath: str("DATABASE_PATH")
    ? resolve(appRoot, str("DATABASE_PATH"))
    : join(dataDir, "sestante.sqlite"),
  /**
   * I file caricati stanno accanto al database, non dentro: un blob in SQLite
   * costringerebbe a leggerlo tutto in memoria per servirlo, e renderebbe il
   * passaggio a un object store una migrazione di dati invece che di codice.
   */
  uploadsPath: str("UPLOADS_PATH")
    ? resolve(appRoot, str("UPLOADS_PATH"))
    : join(dataDir, "uploads"),
  /** Tetto per singolo file caricato, in byte. */
  uploadMaxBytes: num("UPLOAD_MAX_BYTES", 64 * 1024 * 1024),

  allowLocalSignup: bool("ALLOW_LOCAL_SIGNUP", true),
  orgDomain: str("ORG_DOMAIN", "example.org").toLowerCase(),
  orgLabel: str("ORG_LABEL", "example.org"),

  keycloak: {
    issuer: str("KEYCLOAK_ISSUER").replace(/\/+$/, ""),
    /**
     * Da dove il server legge la configurazione OIDC, se diverso dall'emittente
     * pubblico: in Docker il server raggiunge Keycloak in rete interna. Il
     * controllo dell'`iss` dei token resta sull'emittente pubblico.
     */
    internalIssuer: str("KEYCLOAK_INTERNAL_ISSUER", str("KEYCLOAK_ISSUER")).replace(/\/+$/, ""),
    clientId: str("KEYCLOAK_CLIENT_ID", "sestante"),
    clientSecret: str("KEYCLOAK_CLIENT_SECRET"),
    redirectUri: str("KEYCLOAK_REDIRECT_URI", "http://localhost:4000/api/auth/keycloak/callback"),
    scopes: str("KEYCLOAK_SCOPES", "openid profile email"),
  },

  collab: {
    embedded: collabEmbedded,
    /** relay.cjs prodotto da build:geolibre, caricato quando embedded. */
    relayFile: resolve(
      appRoot,
      str("COLLAB_RELAY_FILE", isPackaged ? "relay/relay.cjs" : "geolibre-dist/relay/relay.cjs"),
    ),
    url: str("COLLAB_URL", collabEmbedded ? "http://127.0.0.1:8787" : "").replace(/\/+$/, ""),
    /**
     * Indirizzo del relay visto dal browser, se diverso da COLLAB_URL: dietro
     * un proxy il server lo raggiunge in rete interna (http://relay:8787),
     * il browser in wss://mappe.example.org/collab.
     */
    publicUrl: str("COLLAB_PUBLIC_URL").replace(/\/+$/, ""),
    identitySecret: str(
      "COLLAB_IDENTITY_SECRET",
      collabEmbedded ? persistedSecret(".collab-secret") : "",
    ),
    identityTtl: num("COLLAB_IDENTITY_TTL", 900),
  },

  geolibre: {
    /** Cartella del build servito su /gis/, se presente. */
    dir: geolibreDir,
    selfHosted: geolibreSelfHosted,
    /** Dove GeoLibre deve stare: <base>gis/. */
    prefix: geolibreExpectedBase,
    /** Messaggio d'errore se il build di GeoLibre è per un altro percorso. */
    baseMismatch: geolibreBaseMismatch,
    /** Catalogo servizi (WMS/WMTS…) pubblicato a GeoLibre, se configurato. */
    servicesFile: str("GEOLIBRE_SERVICES_FILE") ? resolve(appRoot, str("GEOLIBRE_SERVICES_FILE")) : "",
    /** "off" toglie dal catalogo i servizi di esempio di GeoLibre. */
    builtinServices: str("GEOLIBRE_BUILTIN_SERVICES", "on"),
  },

  /**
   * URL dell'istanza GeoLibre da incorporare. Relativo (/gis/) quando la
   * serviamo noi: il client lo risolve sulla propria origine.
   */
  geolibreUrl: str(
    "GEOLIBRE_URL",
    geolibreSelfHosted ? geolibreExpectedBase : "https://web.geolibre.app",
  ).replace(/(?<=.)\/+$/, "/"),
};

export function setPublicUrl(url: string): void {
  config.publicUrl = url.replace(/\/+$/, "");
}

/** L'SSO è attivo solo se issuer e segreto client ci sono entrambi. */
export const keycloakEnabled = Boolean(config.keycloak.issuer && config.keycloak.clientSecret);

/**
 * La presenza è attiva solo se il relay è raggiungibile *e* il segreto di firma
 * è configurato: senza segreto ogni identityToken verifica a null lato relay e
 * gli utenti entrerebbero anonimi, che è peggio del non averla.
 */
export const collabEnabled = Boolean(config.collab.url && config.collab.identitySecret);

/** Base WebSocket del relay per il browser: wss://… o ws://… */
export function collabBrowserWsBase(): string {
  return (config.collab.publicUrl || config.collab.url)
    .replace(/^http:/, "ws:")
    .replace(/^https:/, "wss:");
}

/**
 * Collaborazione dentro la mappa: GeoLibre stesso entra nella sessione del
 * relay. Serve un GeoLibre servito da noi (è lì che si aggancia, vedi
 * routes/geolibre.ts) e un indirizzo che GeoLibre accetti: wss://, oppure
 * ws:// solo su localhost.
 */
export const collabInMap = (() => {
  if (!collabEnabled || !config.geolibre.selfHosted) return false;
  try {
    const url = new URL(collabBrowserWsBase());
    return (
      url.protocol === "wss:" ||
      (url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
})();
