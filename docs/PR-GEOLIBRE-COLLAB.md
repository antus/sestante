# Proposta di PR a GeoLibre: ingresso in collaborazione dall'API embed

Questo è il testo da proporre a [opengeos/GeoLibre](https://github.com/opengeos/GeoLibre):
titolo e descrizione in inglese, come il resto del progetto. Quando la PR sarà
accettata e il commit in `geolibre/geolibre.lock.json` la includerà,
l'aggancio in `server/src/geolibre-bridge.ts` si potrà togliere (vedi "Dopo la
PR", in fondo).

Riferimenti verificati sul commit `0692da3f` (GeoLibre 3.0.0).

---

## Title

embed: let a trusted host page join a collaboration session (with identity, host or invite token)

## Description

### Problem

A page that embeds GeoLibre and runs its own sign-in (an intranet portal, a
GIS workspace, a CMS) can already self-host the relay (`workers/collab-node`),
create sessions server-side (`POST /sessions`) and mint HMAC identity tokens
with `signIdentityToken` from `@geolibre/collab-core`. The relay accepts
`identityToken`, `hostToken` and `inviteToken` in the `join` frame
(`packages/collab-core/src/protocol.ts`, `JoinMessage`).

The embedded app, however, has no way to be told to join:

- `?collab=CODE` only pre-fills the Collaborate dialog; the user still has to
  type a name and click Join (`CollaborateDialog.tsx`).
- No caller ever passes `identityToken` or `inviteToken` to
  `useCollaboration().join()`, and `join()` hard-codes `hostToken` to
  `undefined` (`hooks/useCollaboration.ts`, `join` → `connect(..., undefined, options)`),
  so an owner reloading the page re-enters as a guest.
- The embed API (`lib/embed-api.ts`) has no collaboration verb, and the
  plugin API exposes none.

As a result a session created with `requireIdentity: true` rejects every
embedded guest with `identity-required`, and the host role cannot be resumed
after a reload.

### Proposal

1. **`useCollaboration.join()` accepts a host token.** Widen the options type
   to `{ inviteToken?: string; identityToken?: string; hostToken?: string }`
   and pass `options?.hostToken` to `connect()` instead of `undefined`. The
   relay already decides the role by comparing it with the persisted host
   token; nothing changes for existing callers.

2. **Two embed API commands**, allowlisted like the others by
   `VITE_GEOLIBRE_EMBED_ORIGINS`:

   ```ts
   | { type: "joinCollaboration";
       sessionId: string;
       displayName: string;
       color?: string;            // #rrggbb, validated like the dialog's palette
       identityToken?: string;
       hostToken?: string;
       inviteToken?: string; }
   | { type: "leaveCollaboration" }
   ```

   - `parseEmbedRequest` validates the strings (non-empty, length-limited).
   - `useEmbedApi` receives the `CollaborationApi` from `DesktopShell`
     (`useEmbedApi(mapControllerRef, mapAppAPI, mapReadyGeneration, collaboration)`)
     and calls `collaboration.join(...)` / `leave()`.
   - The `ack` reports the relay's result (`welcome` role, or the error code
     such as `identity-required`), so the host page can react.
   - Gated on `project:edit`, the capability that already covers Collaborate.

3. **Token refresh for reconnects.** `CollabConnection` re-sends the same
   `join` on every reconnect, so a short-lived identity token can expire
   mid-session. Optional third command:
   `{ type: "refreshCollaborationIdentity"; identityToken: string }`, which
   replaces the token used by the next `attach()`.

4. **Event to the host page**: `collaborationChanged` with
   `{ status, role, participants }` on `welcome`, `participants`, `kicked` and
   close, so the host can render presence without opening a second socket.

Tokens travel by `postMessage` to an allowlisted origin, never in the URL
(where they would end up in history, logs and `Referer`).

### Why it is safe

- Same trust boundary as the existing commands: only origins listed in
  `VITE_GEOLIBRE_EMBED_ORIGINS` can send them.
- No new authority on the client: every token is still verified by the relay
  (`verifyIdentityToken`, host token comparison, invite claim).
- Default builds are unaffected: without an allowlist the commands do not
  exist, and without `VITE_GEOLIBRE_COLLAB_URL` collaboration stays hidden.

### Tests

- `embed-api` parser: accepts a valid `joinCollaboration`, rejects missing
  `sessionId`, oversized strings, invalid colors.
- `useCollaboration`: `join(..., { hostToken })` sends it in the `join` frame
  and the client adopts the `host` role from `welcome`.
- e2e against `workers/collab-node` with `COLLAB_IDENTITY_SECRET` set and a
  `requireIdentity` session: an embedded guest joins with an identity token;
  without it, the `ack` reports `identity-required`.

---

## Dopo la PR

Quando il commit fissato includerà i comandi:

1. In `web/src/components/MapFrame.tsx`, al posto di `?collab=` e del via
   libera a `setBridgeReady`, inviare `joinCollaboration` con il client
   `@geolibre/embed` già connesso, a progetto ripristinato.
2. In `web/src/lib/collab.ts`, alimentare la presenza dall'evento
   `collaborationChanged` invece che dal ponte, e rinnovare l'identità con
   `refreshCollaborationIdentity`.
3. Togliere `server/src/geolibre-bridge.ts`, la sua inclusione in
   `routes/geolibre.ts`, `web/src/lib/collabBridge.ts` e il controllo dei
   punti di appoggio in `scripts/build-geolibre.mjs`.

Il resto non cambia: sessioni in sola lettura, invito co-edit agli editor,
sostituzione della sessione quando i permessi si restringono.
