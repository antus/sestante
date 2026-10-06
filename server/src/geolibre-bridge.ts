/**
 * L'aggancio di Sestante dentro GeoLibre, per la collaborazione nella mappa.
 *
 * ── Perché esiste ───────────────────────────────────────────────────────────
 * GeoLibre sa entrare in una sessione del relay, ma solo dal proprio dialogo
 * "Collabora", e senza poter presentare né l'identità firmata né lo hostToken
 * né un invito: il relay li accetta, il client non li invia mai. Nessuna API
 * (URL, embed, plugin) permette di farlo da fuori. La strada pulita è una
 * modifica a GeoLibre (vedi docs/PR-GEOLIBRE-COLLAB.md); finché non c'è, questo
 * script fa da ponte senza toccare il codice di GeoLibre.
 *
 * ── Come ────────────────────────────────────────────────────────────────────
 * Viaggia dentro /gis/geolibre-runtime-config.js, che index.html di GeoLibre
 * carica prima del proprio bundle: è il file di configurazione per chi ospita
 * GeoLibre, ed è nostro. Parla con la pagina Sestante che lo incorpora
 * attraverso `window.parent.__sestanteCollab` (stessa origine), e fa tre cose:
 *
 *  1. completa il messaggio `join` diretto alla sessione di Sestante con
 *     identityToken, hostToken o inviteToken, colore e nome — letti al momento
 *     dell'invio, così anche le riconnessioni portano un token fresco;
 *  2. inoltra alla pagina i messaggi del relay di quella connessione (welcome,
 *     participants, kicked, chiusura): la barra della presenza li usa invece di
 *     aprire una seconda connessione;
 *  3. quando la pagina dà il via (`ticket().joinNow`), compila e conferma il
 *     dialogo "Collabora" che GeoLibre apre da sé con `?collab=<codice>`.
 *
 * Ciò su cui si appoggia di GeoLibre — `?collab=`, gli id `collab-name` e
 * `collab-code`, il pulsante dopo il campo codice, il messaggio `join` — è
 * verificato a ogni build da scripts/build-geolibre.mjs: se cambia, il build
 * si ferma invece di produrre una collaborazione che non entra.
 *
 * Fuori da Sestante (nessun `__sestanteCollab` nella pagina madre) non fa nulla.
 */
export const GEOLIBRE_COLLAB_BRIDGE = String.raw`
(function () {
  var host;
  try {
    host = window.parent !== window ? window.parent.__sestanteCollab : null;
  } catch (e) {
    host = null;
  }
  if (!host || typeof host.ticket !== "function") return;

  var NativeWebSocket = window.WebSocket;
  if (!NativeWebSocket || NativeWebSocket.__sestante) return;
  var nativeSend = NativeWebSocket.prototype.send;

  function ours(socket, ticket) {
    return ticket && typeof socket.url === "string" &&
      socket.url.indexOf("/sessions/" + ticket.sessionId + "/ws") !== -1;
  }

  function observe(socket) {
    if (socket.__sestanteObserved) return;
    socket.__sestanteObserved = true;
    socket.addEventListener("message", function (event) {
      var frame;
      try { frame = JSON.parse(String(event.data)); } catch (e) { return; }
      try { host.onRelayMessage && host.onRelayMessage(frame); } catch (e) {}
      if (frame && frame.type === "welcome") joined = true;
    });
    socket.addEventListener("close", function (event) {
      try { host.onRelayClose && host.onRelayClose(event.code, event.reason); } catch (e) {}
    });
  }

  NativeWebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string" && data.indexOf('"join"') !== -1) {
        var ticket = host.ticket();
        var message = JSON.parse(data);
        if (message && message.type === "join" && ours(this, ticket)) {
          message.identityToken = ticket.identityToken;
          if (ticket.hostToken) message.hostToken = ticket.hostToken;
          if (ticket.inviteToken) message.inviteToken = ticket.inviteToken;
          if (ticket.color) message.color = ticket.color;
          if (ticket.displayName) message.displayName = ticket.displayName;
          data = JSON.stringify(message);
          observe(this);
        }
      }
    } catch (e) {}
    return nativeSend.call(this, data);
  };
  NativeWebSocket.__sestante = true;

  // ── Ingresso automatico dal dialogo "Collabora" ────────────────────────────
  var joined = false;
  var clicked = false;
  var startedAt = Date.now();
  var valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;

  function typeInto(input, value) {
    if (input.value === value) return;
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function closeDialog() {
    var escape = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true };
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", escape));
  }

  var timer = setInterval(function () {
    if (Date.now() - startedAt > 120000) {
      clearInterval(timer);
      try { host.onJoinTimeout && host.onJoinTimeout(); } catch (e) {}
      return;
    }
    if (joined) {
      clearInterval(timer);
      // Il dialogo resta aperto sulla sessione attiva: lo si chiude, la
      // presenza la mostra già Sestante.
      if (document.getElementById("collab-name") || document.querySelector('[role="dialog"]')) closeDialog();
      return;
    }
    var ticket = host.ticket();
    if (!ticket || !ticket.joinNow || clicked) return;
    var name = document.getElementById("collab-name");
    var code = document.getElementById("collab-code");
    if (!name || !code) return;
    typeInto(name, ticket.displayName || "Sestante");
    if (!code.value) typeInto(code, ticket.sessionId);
    var button = code.parentElement && code.parentElement.nextElementSibling;
    if (!button || button.tagName !== "BUTTON" || button.disabled) return;
    clicked = true;
    button.click();
  }, 250);
})();
`;
