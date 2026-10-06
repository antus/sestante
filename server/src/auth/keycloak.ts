/**
 * Autenticazione Keycloak via OpenID Connect, Authorization Code + PKCE.
 *
 * Scritto a mano invece di adottare una libreria OIDC per tre ragioni: la
 * superficie usata è piccola (discovery, authorize, token, JWKS), tutto ciò che
 * serve è già in `node:crypto`, e il codice di autenticazione è esattamente
 * quello che in un contesto operativo si vuole poter leggere per intero senza
 * seguire un albero di dipendenze.
 *
 * Verifiche effettuate sull'id_token, nell'ordine: firma RS256/ES256 contro la
 * chiave del JWKS indicata dal `kid`, emittente, audience, scadenza e `nonce`.
 * Il codice di autorizzazione viene scambiato server-to-server con il
 * client_secret, quindi la firma è una seconda linea di difesa — ma è quella
 * che rende l'implementazione difendibile in una revisione di sicurezza.
 */
import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

export interface KeycloakProfile {
  subject: string;
  email: string;
  displayName: string;
}

/** Stato in volo di un login, con scadenza breve: 10 minuti bastano e avanzano. */
interface PendingLogin {
  verifier: string;
  nonce: string;
  returnTo: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;
const pending = new Map<string, PendingLogin>();

let discoveryCache: { value: Discovery; fetchedAt: number } | null = null;
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sweepPending(): void {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [key, value] of pending) if (value.createdAt < cutoff) pending.delete(key);
}

async function discover(): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.fetchedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.value;
  }
  // Dall'indirizzo interno quando c'è (container: http://keycloak:8080/…):
  // con KC_HOSTNAME fisso e backchannel dinamico, Keycloak risponde con
  // l'emittente e la pagina di accesso pubblici e con token e JWKS interni.
  const url = `${config.keycloak.internalIssuer}/.well-known/openid-configuration`;
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Discovery OIDC fallita (${response.status}) su ${url}`);
  }
  const value = (await response.json()) as Discovery;
  // Letta dall'indirizzo interno, la discovery deve comunque dichiarare
  // l'emittente pubblico: altrimenti Keycloak non ha un KC_HOSTNAME fisso, e
  // ogni id_token verrebbe rifiutato più avanti con un errore meno chiaro.
  if (value.issuer && value.issuer.replace(/\/+$/, "") !== config.keycloak.issuer) {
    throw new Error(
      `Keycloak dichiara l'emittente ${value.issuer}, ma KEYCLOAK_ISSUER è ${config.keycloak.issuer}: ` +
        "imposta KC_HOSTNAME su Keycloak (o correggi KEYCLOAK_ISSUER).",
    );
  }
  if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
    throw new Error("Discovery OIDC incompleta: mancano gli endpoint richiesti.");
  }
  discoveryCache = { value, fetchedAt: Date.now() };
  return value;
}

async function jwks(jwksUri: string, forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(jwksUri, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`JWKS non raggiungibile (${response.status})`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/** Primo passo: costruisce l'URL di authorize e memorizza verifier e nonce. */
export async function startLogin(returnTo: string): Promise<string> {
  sweepPending();
  const d = await discover();

  const state = base64url(randomBytes(24));
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const nonce = base64url(randomBytes(16));

  pending.set(state, { verifier, nonce, returnTo, createdAt: Date.now() });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.keycloak.clientId,
    redirect_uri: config.keycloak.redirectUri,
    scope: config.keycloak.scopes,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${d.authorization_endpoint}?${params.toString()}`;
}

/** Secondo passo: scambia il codice e valida l'id_token. */
export async function completeLogin(
  code: string,
  state: string,
): Promise<{ profile: KeycloakProfile; returnTo: string; idToken: string }> {
  sweepPending();
  const entry = pending.get(state);
  // Consumo immediato: uno state vale per un solo scambio, riusarlo è un replay.
  pending.delete(state);
  if (!entry) throw new Error("Stato di login sconosciuto o scaduto.");

  const d = await discover();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.keycloak.redirectUri,
    client_id: config.keycloak.clientId,
    client_secret: config.keycloak.clientSecret,
    code_verifier: entry.verifier,
  });

  const response = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Scambio del codice fallito (${response.status}): ${text.slice(0, 200)}`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Risposta senza id_token.");

  const claims = await verifyIdToken(tokens.id_token, d, entry.nonce);
  const email = typeof claims.email === "string" ? claims.email : "";
  if (!email) throw new Error("L'id_token non contiene una email: verifica lo scope 'email'.");

  const displayName =
    (typeof claims.name === "string" && claims.name) ||
    (typeof claims.preferred_username === "string" && claims.preferred_username) ||
    email.split("@")[0] ||
    email;

  return {
    profile: { subject: String(claims.sub), email: email.toLowerCase(), displayName },
    returnTo: entry.returnTo,
    // Serve all'uscita come id_token_hint (vedi endSessionUrl).
    idToken: tokens.id_token,
  };
}

async function verifyIdToken(
  idToken: string,
  d: Discovery,
  expectedNonce: string,
): Promise<Record<string, unknown>> {
  const segments = idToken.split(".");
  if (segments.length !== 3) throw new Error("id_token malformato.");
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];

  const header = JSON.parse(Buffer.from(headerSegment, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  const algorithm = header.alg ?? "";
  // "none" e gli HMAC non hanno posto qui: la chiave pubblica del realm firma
  // in asimmetrico, e accettare HS256 significherebbe accettare un token
  // firmato con un segreto che il client conosce.
  const verifierName =
    algorithm === "RS256"
      ? "RSA-SHA256"
      : algorithm === "RS384"
        ? "RSA-SHA384"
        : algorithm === "RS512"
          ? "RSA-SHA512"
          : algorithm === "ES256"
            ? "sha256"
            : null;
  if (!verifierName) throw new Error(`Algoritmo id_token non ammesso: ${algorithm || "assente"}`);

  let keys = await jwks(d.jwks_uri);
  let key = keys.find((k) => k.kid === header.kid);
  if (!key) {
    // Rotazione delle chiavi: una sola rilettura forzata, poi si arrende.
    keys = await jwks(d.jwks_uri, true);
    key = keys.find((k) => k.kid === header.kid);
  }
  if (!key) throw new Error("Chiave di firma dell'id_token non trovata nel JWKS.");

  const publicKey = createPublicKey({ key: key as never, format: "jwk" });
  const verifier = createVerify(verifierName);
  verifier.update(`${headerSegment}.${payloadSegment}`);
  verifier.end();
  const signature = Buffer.from(signatureSegment, "base64url");
  const valid = algorithm.startsWith("ES")
    ? verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
    : verifier.verify(publicKey, signature);
  if (!valid) throw new Error("Firma dell'id_token non valida.");

  const claims = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;

  if (claims.iss !== d.issuer) throw new Error("Emittente dell'id_token inatteso.");

  const audience = claims.aud;
  const audienceOk = Array.isArray(audience)
    ? audience.includes(config.keycloak.clientId)
    : audience === config.keycloak.clientId;
  if (!audienceOk) throw new Error("Audience dell'id_token inattesa.");

  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) {
    throw new Error("id_token scaduto.");
  }

  const nonce = typeof claims.nonce === "string" ? claims.nonce : "";
  if (
    nonce.length !== expectedNonce.length ||
    !timingSafeEqual(Buffer.from(nonce), Buffer.from(expectedNonce))
  ) {
    throw new Error("Nonce dell'id_token non corrispondente.");
  }

  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("id_token senza subject.");
  return claims;
}

/**
 * Indirizzo di uscita da Keycloak. Con `idTokenHint` (l'id_token ricevuto
 * all'accesso) Keycloak sa che la richiesta viene dall'app e chiude la sessione
 * senza chiedere conferma; senza, mostra la pagina "Vuoi disconnetterti?".
 */
export async function endSessionUrl(idTokenHint?: string): Promise<string | null> {
  try {
    const d = await discover();
    if (!d.end_session_endpoint) return null;
    const params = new URLSearchParams({
      ...(idTokenHint ? { id_token_hint: idTokenHint } : {}),
      client_id: config.keycloak.clientId,
      // Con la barra: il client Keycloak ammette "<url>/*", e senza un'app sotto
      // /sestante non combacerebbe.
      post_logout_redirect_uri: `${config.publicUrl}/`,
    });
    return `${d.end_session_endpoint}?${params.toString()}`;
  } catch {
    return null;
  }
}
