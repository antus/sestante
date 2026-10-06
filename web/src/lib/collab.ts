/**
 * Presenza: chi è connesso a questa mappa, adesso.
 *
 * Sestante non reimplementa la collaborazione — la usa. Il relay è
 * `geolibre-collab-node`, lo stesso che GeoLibre avvia per le sue sessioni
 * live, e il protocollo è il suo (`packages/collab-core/src/protocol.ts`):
 * messaggi JSON piatti discriminati su `type`.
 *
 * Questo modulo apre la sola parte che serve alla barra superiore: entra nella
 * sessione e resta in ascolto dell'elenco partecipanti. Non spinge snapshot di
 * progetto — quello lo fa GeoLibre dentro l'iframe, se e quando lo si collega
 * alla stessa sessione. Tenere le due cose separate significa che la barra
 * mostra gli utenti connessi anche mentre la mappa è in sola lettura.
 *
 * Il `clientId` inviato nel join è un segnaposto: il relay lo ignora e ne
 * assegna uno proprio (lo restituisce nel `welcome`), perché altrimenti un
 * partecipante potrebbe rivendicare l'identità di un altro.
 *
 * ── Partecipanti e persone ──────────────────────────────────────────────────
 * Il relay elenca **connessioni**, non persone: due schede dello stesso utente
 * sono due partecipanti con `clientId` diversi, ed è corretto così dal suo
 * punto di vista. La barra di Sestante deve invece mostrare *chi* c'è, quindi
 * le connessioni vengono raggruppate per `identity.userId` — il claim che il
 * relay popola solo dopo aver verificato la firma del token. Vedi
 * `distinctPeople()` più sotto.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type CollabTicket } from "./api";
import { bridgeSocket, refreshBridgeIdentity, type SocketLike } from "./collabBridge";

/** Il server entra per un istante come host per moderare: non è una persona. */
const SERVER_PARTICIPANT_ID = "sestante:server";
/** Motivo con cui il server fa uscire gli ospiti di una sessione sostituita. */
const SESSION_REPLACED = "sestante:session-replaced";
/** Rinnovo dell'identità per le riconnessioni di GeoLibre (il token dura 15 minuti). */
const IDENTITY_REFRESH_MS = 5 * 60_000;
/** Ogni quanto chiedere se il proprietario ha aperto la sessione. */
const SESSION_POLL_MS = 15_000;

export interface Participant {
  clientId: string;
  displayName: string;
  color: string;
  role: "host" | "guest";
  editOverride: boolean | null;
  identity?: { provider: string; userId: string; username: string } | null;
}

/** Una persona, non una connessione: più schede dello stesso utente = una voce. */
export interface Person {
  key: string;
  displayName: string;
  color: string;
  /** Quante connessioni ha aperto (schede, finestre): utile nel tooltip. */
  connections: number;
  /** Vero quando l'identità è stata verificata dal relay. */
  verified: boolean;
  isSelf: boolean;
}

export type CollabState =
  | { status: "off" }
  | { status: "connecting" }
  | { status: "live"; participants: Participant[]; selfId: string; canEdit: boolean }
  | { status: "error"; reason: string };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

/**
 * Raggruppa le connessioni in persone.
 *
 * Chiave: `identity.userId` quando c'è — cioè quando il relay ha verificato il
 * token firmato da Sestante — altrimenti il `clientId`, che tiene separati fra
 * loro gli ospiti anonimi invece di fonderli in uno solo.
 *
 * `selfUserId` identifica l'utente in sessione: serve perché escludersi
 * confrontando il solo `selfId` non basta. Una scheda aperta due volte, o una
 * connessione precedente che il relay non ha ancora chiuso, sono partecipanti
 * con `clientId` diverso ma stessa identità: senza questo confronto l'utente
 * vedrebbe comparire sé stesso fra i "connessi".
 */
export function distinctPeople(
  participants: Participant[],
  selfId: string,
  selfUserId: string | null,
): Person[] {
  const byKey = new Map<string, Person>();

  for (const participant of participants) {
    const userId = participant.identity?.userId ?? null;
    if (userId === SERVER_PARTICIPANT_ID) continue;
    const key = userId ?? participant.clientId;
    const isSelf =
      participant.clientId === selfId || (userId !== null && userId === selfUserId);

    const existing = byKey.get(key);
    if (existing) {
      existing.connections += 1;
      // Basta che una delle connessioni sia la nostra perché la persona sia noi.
      existing.isSelf = existing.isSelf || isSelf;
      continue;
    }

    byKey.set(key, {
      key,
      displayName: participant.identity?.username ?? participant.displayName,
      color: participant.color,
      connections: 1,
      verified: Boolean(participant.identity),
      isSelf,
    });
  }

  return [...byKey.values()];
}

export function useCollabPresence(
  mapId: string | null,
  /** null = non ancora noto: non si decide nulla, nemmeno "nessuna sessione". */
  enabled: boolean | null,
  selfUserId: string | null,
): CollabState & {
  people: Person[];
  others: Person[];
  /**
   * Sessione in cui GeoLibre deve entrare, quando la collaborazione è nella
   * mappa; null se non c'è; undefined finché il primo biglietto non è arrivato.
   */
  inMapSession: string | null | undefined;
  /** Rilegge il biglietto: dopo un cambio di permessi la sessione può essere nuova. */
  refresh: () => void;
} {
  const [state, setState] = useState<CollabState>({ status: "off" });
  const [inMapSession, setInMapSession] = useState<string | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  const attemptRef = useRef(0);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);

  useEffect(() => {
    if (enabled === null) return;
    if (!mapId || !enabled) {
      setState({ status: "off" });
      setInMapSession(null);
      return;
    }

    /**
     * Annullamento locale a questa esecuzione dell'effetto, non un ref
     * condiviso. Con un ref, in sviluppo React monta ed esegue gli effetti due
     * volte (StrictMode): il primo `connect()` è ancora sospeso sulla chiamata
     * HTTP quando la pulizia alza il flag, ma il secondo montaggio lo riabbassa
     * subito dopo — così la continuazione del primo riprende, apre un secondo
     * socket e l'utente si vede comparire due volte nella barra. Una variabile
     * catturata nella closure non può essere riabbassata da un montaggio
     * successivo, e il socket fantasma non nasce.
     */
    let cancelled = false;
    let socket: SocketLike | WebSocket | null = null;
    let timer: number | undefined;
    let identityTimer: number | undefined;
    /** Il relay ha rifiutato la sessione: al prossimo biglietto il server la verifichi. */
    let verifyNext = false;
    /**
     * Tentativi chiusi senza mai ricevere `welcome`. Il caso tipico è un codice
     * di sessione che il relay non conosce più — riavviato con un archivio
     * vuoto, o sessione scaduta per inattività (COLLAB_IDLE_TTL_MS): l'upgrade
     * risponde 404, il socket si chiude subito e senza questo contatore il
     * client resterebbe in "Caricamento…" per sempre. Al secondo fallimento si
     * chiede al server di verificare la sessione: se il relay non la conosce
     * più, il server ne crea una nuova (se a chiedere è il proprietario) o
     * risponde che la mappa non è ancora aperta.
     */
    let joinFailures = 0;
    setState({ status: "connecting" });

    const connect = async (): Promise<void> => {
      if (cancelled) return;

      let ticket: CollabTicket;
      try {
        ticket = await api.openCollabSession(mapId, verifyNext);
        verifyNext = false;
      } catch (error) {
        if (cancelled) return;
        // Senza biglietto la mappa si apre comunque, fuori da ogni sessione.
        setInMapSession((current) => (current === undefined ? null : current));
        // 409 = la sessione non è stata ancora aperta dal proprietario: non è
        // un errore da mostrare, è semplicemente una mappa non ancora "live".
        const code = (error as { code?: string }).code ?? "generic";
        setState(
          code === "session-not-open" ? { status: "off" } : { status: "error", reason: code },
        );
        // Si riprova con calma: quando il proprietario apre la mappa (o la
        // riapre dopo un cambio di permessi) la sessione c'è, e si entra da soli.
        if (code === "session-not-open") timer = window.setTimeout(connect, SESSION_POLL_MS);
        return;
      }
      if (cancelled) return;

      // Collaborazione nella mappa: la connessione è quella di GeoLibre, che
      // l'aggancio ci inoltra; qui non se ne apre una seconda.
      setInMapSession(ticket.inMap ? ticket.sessionId : null);
      socket = ticket.inMap ? bridgeSocket(ticket) : new WebSocket(ticket.wsUrl);
      const current = socket;
      let welcomed = false;
      if (ticket.inMap && identityTimer === undefined) {
        identityTimer = window.setInterval(() => {
          void api
            .refreshCollabIdentity()
            .then(({ identityToken }) => refreshBridgeIdentity(identityToken))
            .catch(() => undefined);
        }, IDENTITY_REFRESH_MS);
      }

      current.addEventListener("open", () => {
        if (cancelled) {
          current.close();
          return;
        }
        attemptRef.current = 0;
        current.send(
          JSON.stringify({
            type: "join",
            clientId: "pending",
            displayName: ticket.displayName,
            color: ticket.color,
            ...(ticket.hostToken ? { hostToken: ticket.hostToken } : {}),
            identityToken: ticket.identityToken,
          }),
        );
      });

      current.addEventListener("message", (event) => {
        if (cancelled) return;
        let frame: {
          type?: string;
          participants?: Participant[];
          clientId?: string;
          role?: string;
          reason?: string;
        };
        try {
          frame = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (frame.type === "welcome") {
          welcomed = true;
          joinFailures = 0;
          setState({
            status: "live",
            participants: frame.participants ?? [],
            selfId: frame.clientId ?? "",
            canEdit: ticket.canEdit,
          });
        } else if (frame.type === "participants") {
          setState((previous) =>
            previous.status === "live"
              ? { ...previous, participants: frame.participants ?? [] }
              : previous,
          );
        } else if (frame.type === "kicked") {
          if (frame.reason === SESSION_REPLACED) {
            // I permessi sulla mappa sono cambiati e il server ha aperto una
            // sessione nuova: si rientra lì, con il ruolo aggiornato.
            current.close();
            setState({ status: "connecting" });
            timer = window.setTimeout(connect, RECONNECT_BASE_MS);
            return;
          }
          cancelled = true;
          current.close();
          setState({ status: "error", reason: "kicked" });
        }
      });

      current.addEventListener("close", () => {
        if (cancelled) return;

        if (!welcomed) {
          joinFailures += 1;
          if (joinFailures >= 2) {
            joinFailures = 0;
            // Il codice di sessione non vale più: il server lo verifichi al
            // prossimo biglietto, senza aspettare il backoff lungo.
            verifyNext = true;
            setState({ status: "connecting" });
            timer = window.setTimeout(connect, RECONNECT_BASE_MS);
            return;
          }
        }

        // Backoff esponenziale con tetto: un relay che riparte non deve
        // prendersi una raffica di riconnessioni da ogni scheda aperta.
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** attemptRef.current, RECONNECT_MAX_MS);
        attemptRef.current += 1;
        setState({ status: "connecting" });
        timer = window.setTimeout(connect, delay);
      });

      current.addEventListener("error", () => current.close());
    };

    void connect();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      if (identityTimer !== undefined) window.clearInterval(identityTimer);
      // Un socket ancora in apertura non si chiude con close(): l'handler di
      // "open" qui sopra lo richiude appena il canale è pronto.
      socket?.close();
      socket = null;
    };
  }, [mapId, enabled, generation]);

  const people = useMemo(
    () =>
      state.status === "live" ? distinctPeople(state.participants, state.selfId, selfUserId) : [],
    [state, selfUserId],
  );

  return {
    ...state,
    people,
    others: people.filter((person) => !person.isSelf),
    inMapSession,
    refresh,
  };
}
