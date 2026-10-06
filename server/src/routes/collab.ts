/**
 * Ponte verso il relay di collaborazione di GeoLibre (geolibre-collab-node).
 *
 * Il client non parla mai direttamente al relay per creare una sessione né si
 * firma da solo l'identità: passa da qui. Due ragioni, entrambe sostanziali.
 *
 *  1. `COLLAB_IDENTITY_SECRET` non deve mai raggiungere il browser. È il
 *     segreto con cui il relay distingue un utente verificato da un anonimo:
 *     chi lo possiede può presentarsi come chiunque.
 *  2. Il ruolo nella sessione deve derivare dall'ACL di Sestante, non dalla
 *     buona volontà del client.
 *
 * ── Chi può scrivere nella sessione ─────────────────────────────────────────
 * Le sessioni nascono **in sola lettura** (`view-only`) e con identità
 * obbligatoria. Scrive solo chi presenta un invito `co-edit`, e quell'invito
 * il server lo consegna soltanto a chi in Sestante è editor; il proprietario
 * entra come host con lo hostToken. Così un lettore che manomettesse il proprio
 * browser resterebbe comunque un lettore per il relay — che rifiuta i suoi
 * snapshot — invece di poter scrivere modifiche che il browser di un editor
 * salverebbe poi nel database.
 *
 * Quando i permessi su una mappa si restringono la sessione viene sostituita
 * (`resetCollabSession`): un invito già usato non si può ritirare a un
 * partecipante, quindi si apre una sessione nuova con un invito nuovo.
 */
import type { FastifyInstance } from "fastify";
import { collabBrowserWsBase, collabEnabled, collabInMap, config } from "../config.js";
import { db, now, type MapRow, type UserRow } from "../db.js";
import { canEdit, loadMapFor } from "../acl.js";
import { signIdentityToken } from "../identity-token.js";
import { ensureEditInvite, evictGuests } from "../relay-host.js";
import { requireUser } from "./maps.js";

interface RelaySession {
  sessionId: string;
  hostToken: string;
  mode: "co-edit" | "view-only";
  requireIdentity: boolean;
}

/** Motivo dell'espulsione quando una sessione viene sostituita: il client lo riconosce. */
export const SESSION_REPLACED = "sestante:session-replaced";

function identityFor(user: UserRow): string {
  return signIdentityToken(
    {
      userId: user.id,
      username: user.display_name,
      provider: "sestante",
      exp: Math.floor(Date.now() / 1000) + config.collab.identityTtl,
    },
    config.collab.identitySecret,
  );
}

async function createRelaySession(): Promise<RelaySession | null> {
  const response = await fetch(`${config.collab.url}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: config.publicUrl },
    body: JSON.stringify({ mode: "view-only", requireIdentity: true }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) return null;
  return (await response.json()) as RelaySession;
}

/**
 * La sessione della mappa con il suo invito co-edit, aperta o creata.
 *
 * Una sessione registrata senza invito è di prima di questo schema (nata
 * `co-edit`, scrivibile da chiunque): non la si riusa. Una sessione che il relay
 * non conosce più si ricrea. Solo il proprietario crea: gli altri ricevono null
 * e aspettano che la mappa venga aperta da lui.
 */
async function openSession(
  map: MapRow,
  isOwner: boolean,
  verify: boolean,
): Promise<{ sessionId: string; hostToken: string; editInvite: string } | "not-open" | "relay-error"> {
  if (map.collab_session_id && map.collab_host_token) {
    const row = await db().get<{ edit_invite: string }>(
      "SELECT edit_invite FROM collab_invites WHERE session_id = ?",
      map.collab_session_id,
    );
    if (row && !verify) {
      return { sessionId: map.collab_session_id, hostToken: map.collab_host_token, editInvite: row.edit_invite };
    }
    if (row) {
      // Verifica richiesta dal client (il relay ha rifiutato la sessione):
      // se il relay la conosce ancora, l'invito torna valido così com'è.
      const invite = await ensureEditInvite(map.collab_session_id, map.collab_host_token);
      if (invite) {
        return { sessionId: map.collab_session_id, hostToken: map.collab_host_token, editInvite: invite };
      }
    }
  }

  if (!isOwner) return "not-open";

  const session = await createRelaySession().catch(() => null);
  if (!session) return "relay-error";
  const editInvite = await ensureEditInvite(session.sessionId, session.hostToken);
  if (!editInvite) return "relay-error";

  await db().run("DELETE FROM collab_invites WHERE map_id = ?", map.id);
  await db().run(
    "INSERT INTO collab_invites (session_id, map_id, edit_invite, created_at) VALUES (?, ?, ?, ?)",
    session.sessionId,
    map.id,
    editInvite,
    now(),
  );
  await db().run(
    "UPDATE maps SET collab_session_id = ?, collab_host_token = ?, updated_at = ? WHERE id = ?",
    session.sessionId,
    session.hostToken,
    now(),
    map.id,
  );
  return { sessionId: session.sessionId, hostToken: session.hostToken, editInvite };
}

/**
 * Sostituisce la sessione di una mappa: da chiamare quando i permessi si
 * restringono (ruolo ridotto, condivisione revocata, accesso generale
 * cambiato). Gli ospiti della sessione vecchia vengono fatti uscire con un
 * motivo che il loro client riconosce, e rientrano nella nuova con il ruolo
 * aggiornato; la nuova la crea il proprietario alla prossima apertura.
 */
export async function resetCollabSession(mapId: string): Promise<void> {
  const map = await db().get<MapRow>("SELECT * FROM maps WHERE id = ?", mapId);
  if (!map?.collab_session_id) return;
  const { collab_session_id: sessionId, collab_host_token: hostToken } = map;
  await db().run("DELETE FROM collab_invites WHERE map_id = ?", mapId);
  await db().run(
    "UPDATE maps SET collab_session_id = NULL, collab_host_token = NULL WHERE id = ?",
    mapId,
  );
  if (collabEnabled && sessionId && hostToken) {
    await evictGuests(sessionId, hostToken, SESSION_REPLACED).catch(() => undefined);
  }
}

export async function collabRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/collab/status", async () => {
    if (!collabEnabled) return { enabled: false, reachable: false, inMap: false };
    try {
      const response = await fetch(`${config.collab.url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const body = (await response.json()) as { identitySupported?: boolean };
      return {
        enabled: true,
        reachable: response.ok,
        identitySupported: body.identitySupported === true,
        inMap: collabInMap,
      };
    } catch {
      return { enabled: true, reachable: false, inMap: collabInMap };
    }
  });

  /**
   * Apre (o riaggancia) la sessione collaborativa di una mappa e restituisce al
   * client tutto ciò che gli serve per entrare: codice sessione, endpoint
   * WebSocket, identityToken firmato, e la credenziale del suo ruolo — lo
   * hostToken al proprietario, l'invito co-edit agli editor, niente ai lettori.
   *
   * `{ verify: true }` nel corpo: il relay ha rifiutato la sessione registrata,
   * va controllata (ed eventualmente ricreata) invece che restituita com'è.
   */
  app.post("/api/maps/:id/collab/session", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!collabEnabled) return reply.code(503).send({ error: "collab-disabled" });

    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    const { verify = false } = (request.body ?? {}) as { verify?: boolean };

    let session: Awaited<ReturnType<typeof openSession>>;
    try {
      session = await openSession(found.map, found.role === "owner", verify === true);
    } catch (error) {
      request.log.error({ err: error }, "relay non raggiungibile");
      return reply.code(502).send({ error: "relay-unavailable" });
    }
    // Solo il proprietario può creare la sessione. Chi arriva prima riceve
    // 409: la mappa non è ancora "live" e non tocca a lui aprirla.
    if (session === "not-open") return reply.code(409).send({ error: "session-not-open" });
    if (session === "relay-error") return reply.code(502).send({ error: "relay-unavailable" });

    const isOwner = found.role === "owner";
    const editor = canEdit(found.role);
    return {
      sessionId: session.sessionId,
      wsUrl: `${collabBrowserWsBase()}/sessions/${session.sessionId}/ws`,
      // Lo hostToken è la chiave della moderazione: esce solo verso chi possiede
      // la mappa. L'invito co-edit solo verso chi in Sestante può modificare.
      hostToken: isOwner ? session.hostToken : null,
      inviteToken: !isOwner && editor ? session.editInvite : null,
      canEdit: editor,
      identityToken: identityFor(user),
      displayName: user.display_name,
      color: user.color,
      inMap: collabInMap,
    };
  });

  app.delete("/api/maps/:id/collab/session", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (found.role !== "owner") return reply.code(403).send({ error: "owner-only" });

    await resetCollabSession(id);
    return { ok: true };
  });

  /**
   * Rinnovo del solo identityToken, per una sessione che resta aperta oltre il
   * TTL. Non crea né tocca la sessione del relay.
   */
  app.post("/api/collab/identity-token", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    if (!collabEnabled) return reply.code(503).send({ error: "collab-disabled" });

    return { identityToken: identityFor(user), expiresIn: config.collab.identityTtl };
  });
}
