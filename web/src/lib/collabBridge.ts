/**
 * Lato Sestante dell'aggancio con GeoLibre per la collaborazione nella mappa.
 *
 * Lo script che il server inserisce in GeoLibre (server/src/geolibre-bridge.ts)
 * cerca `window.parent.__sestanteCollab` e lo usa in due direzioni:
 *
 *  - chiede `ticket()`: sessione, identità e credenziale del ruolo da mettere
 *    nel messaggio `join`, e `joinNow`, il via libera a entrare;
 *  - consegna i messaggi del relay della sua connessione (`onRelayMessage`,
 *    `onRelayClose`).
 *
 * Qui quei messaggi diventano gli eventi di un oggetto che si comporta come un
 * WebSocket (`message`, `close`): così la presenza (collab.ts) usa lo stesso
 * codice sia con la propria connessione sia con quella di GeoLibre, e ogni
 * utente compare una volta sola fra i partecipanti.
 */
import type { CollabTicket } from "./api";

type Listener = (event: { data?: string; code?: number; reason?: string }) => void;

/** Ciò che collab.ts usa di un WebSocket. */
export interface SocketLike {
  addEventListener(type: "open" | "message" | "close" | "error", listener: Listener): void;
  send(data: string): void;
  close(): void;
}

interface BridgeState {
  ticket: CollabTicket | null;
  /** La mappa ha finito di caricare il progetto: GeoLibre può entrare. */
  ready: boolean;
  socket: BridgeSocket | null;
}

const state: BridgeState = { ticket: null, ready: false, socket: null };

class BridgeSocket implements SocketLike {
  private listeners = new Map<string, Set<Listener>>();
  private closed = false;

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  emit(type: string, event: { data?: string; code?: number; reason?: string }): void {
    if (this.closed && type !== "close") return;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /** Il `join` lo manda GeoLibre: da qui non si invia nulla. */
  send(): void {}

  close(): void {
    this.closed = true;
    if (state.socket === this) state.socket = null;
  }
}

declare global {
  interface Window {
    __sestanteCollab?: {
      ticket(): (CollabTicket & { joinNow: boolean }) | null;
      onRelayMessage(frame: unknown): void;
      onRelayClose(code: number, reason: string): void;
      onJoinTimeout(): void;
    };
  }
}

window.__sestanteCollab = {
  ticket: () => (state.ticket ? { ...state.ticket, joinNow: state.ready } : null),
  onRelayMessage: (frame) => state.socket?.emit("message", { data: JSON.stringify(frame) }),
  onRelayClose: (code, reason) => state.socket?.emit("close", { code, reason }),
  onJoinTimeout: () => state.socket?.emit("close", { code: 4408, reason: "join-timeout" }),
};

/** Una "connessione" alimentata da GeoLibre, per il biglietto indicato. */
export function bridgeSocket(ticket: CollabTicket): SocketLike {
  state.socket?.close();
  state.ticket = ticket;
  const socket = new BridgeSocket();
  state.socket = socket;
  return socket;
}

/** Aggiorna il solo identityToken: le riconnessioni di GeoLibre leggono questo. */
export function refreshBridgeIdentity(identityToken: string): void {
  if (state.ticket) state.ticket = { ...state.ticket, identityToken };
}

/** Via libera all'ingresso: lo dà MapFrame quando il progetto è al suo posto. */
export function setBridgeReady(ready: boolean): void {
  state.ready = ready;
}
