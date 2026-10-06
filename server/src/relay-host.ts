/**
 * Il server Sestante come host di una sessione del relay, per pochi istanti.
 *
 * Il relay di GeoLibre accetta le azioni di moderazione — creare inviti,
 * espellere partecipanti — solo dentro una connessione WebSocket aperta con lo
 * hostToken: non esiste un'API REST per farlo. Il server quello hostToken ce
 * l'ha (lo riceve creando la sessione), quindi apre una connessione, compie
 * l'azione e la chiude.
 *
 * Il server entra con un'identità firmata riconoscibile (`sestante:server`),
 * così la barra della presenza può escluderlo: per un istante compare
 * nell'elenco dei partecipanti degli altri, e non deve sembrare una persona.
 */
import { collabBrowserWsBase, config } from "./config.js";
import { signIdentityToken } from "./identity-token.js";

export const SERVER_PARTICIPANT_ID = "sestante:server";
const TIMEOUT_MS = 5000;

interface Welcome {
  type: "welcome";
  clientId: string;
  role: "host" | "guest";
  participants: { clientId: string; role: string; identity?: { userId: string } | null }[];
  invites?: { token: string; role: string; revoked: boolean }[];
}

type Frame = { type?: string } & Record<string, unknown>;

export interface HostConnection {
  welcome: Welcome;
  send(message: Record<string, unknown>): void;
  /** Il primo messaggio del tipo indicato, o null allo scadere del tempo. */
  next(type: string): Promise<Frame | null>;
}

/** Il server raggiunge il relay all'indirizzo interno, non a quello pubblico. */
function internalWsBase(): string {
  return config.collab.url.replace(/^http:/, "ws:").replace(/^https:/, "wss:") || collabBrowserWsBase();
}

/**
 * Entra come host, esegue `action`, esce. Restituisce null se la sessione non
 * esiste più sul relay (riavviato con un archivio vuoto, o scaduta) o se il
 * relay non risponde: per il chiamante significa "crea una sessione nuova".
 */
export async function asHost<T>(
  sessionId: string,
  hostToken: string,
  action: (connection: HostConnection) => Promise<T>,
): Promise<T | null> {
  const socket = new WebSocket(`${internalWsBase()}/sessions/${sessionId}/ws`);
  const waiting = new Map<string, (frame: Frame) => void>();
  let welcome: Welcome | null = null;

  const opened = new Promise<Welcome | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    socket.addEventListener("open", () => {
      socket.send(
        JSON.stringify({
          type: "join",
          clientId: "pending",
          displayName: "Sestante",
          color: "#64748b",
          hostToken,
          identityToken: signIdentityToken(
            {
              userId: SERVER_PARTICIPANT_ID,
              username: "Sestante",
              provider: "sestante",
              exp: Math.floor(Date.now() / 1000) + 60,
            },
            config.collab.identitySecret,
          ),
        }),
      );
    });
    socket.addEventListener("message", (event) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data)) as Frame;
      } catch {
        return;
      }
      if (frame.type === "welcome" && !welcome) {
        clearTimeout(timer);
        welcome = frame as unknown as Welcome;
        resolve(welcome);
        return;
      }
      const waiter = frame.type ? waiting.get(frame.type) : undefined;
      if (waiter) {
        waiting.delete(frame.type as string);
        waiter(frame);
      }
    });
    // Sessione sconosciuta: il relay chiude subito (1008) senza welcome.
    socket.addEventListener("close", () => {
      clearTimeout(timer);
      resolve(welcome);
    });
    socket.addEventListener("error", () => resolve(null));
  });

  try {
    const joined = await opened;
    if (!joined || joined.role !== "host") return null;
    return await action({
      welcome: joined,
      send: (message) => socket.send(JSON.stringify(message)),
      next: (type) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            waiting.delete(type);
            resolve(null);
          }, TIMEOUT_MS);
          waiting.set(type, (frame) => {
            clearTimeout(timer);
            resolve(frame);
          });
        }),
    });
  } finally {
    socket.close(1000, "Sestante: azione completata");
  }
}

/** L'invito co-edit valido della sessione, creato se manca. */
export async function ensureEditInvite(sessionId: string, hostToken: string): Promise<string | null> {
  return asHost(sessionId, hostToken, async ({ welcome, send, next }) => {
    const existing = welcome.invites?.find((i) => i.role === "co-edit" && !i.revoked);
    if (existing) return existing.token;
    send({ type: "mint-invite", role: "co-edit" });
    const created = (await next("invite-created")) as { invite?: { token?: string } } | null;
    return created?.invite?.token ?? null;
  });
}

/**
 * Fa uscire tutti gli ospiti di una sessione che sta per essere sostituita,
 * con un motivo che il client riconosce e a cui reagisce entrando nella nuova.
 * Il proprietario (host) non si può espellere: lo riallinea il suo client.
 */
export async function evictGuests(sessionId: string, hostToken: string, reason: string): Promise<void> {
  await asHost(sessionId, hostToken, async ({ welcome, send }) => {
    for (const participant of welcome.participants) {
      if (participant.role === "host") continue;
      send({ type: "kick-participant", clientId: participant.clientId, reason });
    }
    // Il tempo che i messaggi partano prima della chiusura del socket.
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}
