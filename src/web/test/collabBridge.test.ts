/**
 * Il ponte con GeoLibre: ciò che GeoLibre legge da window.__sestanteCollab e i
 * messaggi del relay che tornano a Sestante come eventi di un "socket".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabTicket } from "../src/lib/api";

const ticket = { sessionCode: "S1", identityToken: "id-1" } as unknown as CollabTicket;

async function freshBridge() {
  vi.resetModules();
  return import("../src/lib/collabBridge");
}

beforeEach(() => {
  delete window.__sestanteCollab;
});

describe("ponte della collaborazione", () => {
  it("senza biglietto GeoLibre non entra in nessuna sessione", async () => {
    await freshBridge();
    expect(window.__sestanteCollab?.ticket()).toBeNull();
  });

  it("il via libera arriva solo quando la mappa è pronta", async () => {
    const { bridgeSocket, setBridgeReady } = await freshBridge();
    bridgeSocket(ticket);
    expect(window.__sestanteCollab?.ticket()).toMatchObject({ identityToken: "id-1", joinNow: false });
    setBridgeReady(true);
    expect(window.__sestanteCollab?.ticket()?.joinNow).toBe(true);
  });

  it("i messaggi del relay arrivano alla presenza come eventi", async () => {
    const { bridgeSocket } = await freshBridge();
    const socket = bridgeSocket(ticket);
    const messages: unknown[] = [];
    const closes: unknown[] = [];
    socket.addEventListener("message", (e) => messages.push(JSON.parse(e.data!)));
    socket.addEventListener("close", (e) => closes.push([e.code, e.reason]));

    window.__sestanteCollab?.onRelayMessage({ type: "participants", participants: [] });
    window.__sestanteCollab?.onRelayClose(4001, "sestante:session-replaced");
    expect(messages).toEqual([{ type: "participants", participants: [] }]);
    expect(closes).toEqual([[4001, "sestante:session-replaced"]]);
  });

  it("una nuova sessione sostituisce la precedente, che non riceve più nulla", async () => {
    const { bridgeSocket } = await freshBridge();
    const old = bridgeSocket(ticket);
    const seen: string[] = [];
    old.addEventListener("message", () => seen.push("vecchia"));
    const current = bridgeSocket({ ...ticket, identityToken: "id-2" } as CollabTicket);
    current.addEventListener("message", () => seen.push("nuova"));

    window.__sestanteCollab?.onRelayMessage({ type: "ping" });
    expect(seen).toEqual(["nuova"]);
    expect(window.__sestanteCollab?.ticket()?.identityToken).toBe("id-2");
  });

  it("il rinnovo dell'identità vale per le riconnessioni di GeoLibre", async () => {
    const { bridgeSocket, refreshBridgeIdentity } = await freshBridge();
    bridgeSocket(ticket);
    refreshBridgeIdentity("id-rinnovato");
    expect(window.__sestanteCollab?.ticket()?.identityToken).toBe("id-rinnovato");
  });

  it("se GeoLibre non riesce a entrare, la presenza lo sa", async () => {
    const { bridgeSocket } = await freshBridge();
    const socket = bridgeSocket(ticket);
    const codes: number[] = [];
    socket.addEventListener("close", (e) => codes.push(e.code!));
    window.__sestanteCollab?.onJoinTimeout();
    expect(codes).toEqual([4408]);
  });
});
