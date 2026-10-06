/**
 * Emissione degli identityToken per il relay di collaborazione di GeoLibre.
 *
 * Il formato non è una nostra invenzione: è quello che il relay verifica in
 * `@geolibre/collab-core` (packages/collab-core/src/identity.ts).
 *
 *   <base64url(payloadJSON)>.<base64url(hmacSha256(base64url(payloadJSON))))>
 *
 * Due dettagli sono vincolanti e vanno rispettati alla lettera:
 *
 *  1. La firma è calcolata sul segmento payload **già codificato**, non
 *     sull'oggetto decodificato. Così la verifica non deve ri-serializzare il
 *     JSON e non è aggirabile riordinando le chiavi o cambiando gli spazi.
 *  2. Il base64url è senza padding (`=` rimossi). Un token con padding non
 *     supera il confronto costante-tempo lato relay.
 *
 * Claim ammessi: { userId, username, provider?, exp? }. `exp` è in **secondi**
 * epoch, non millisecondi: il relay fa `claims.exp * 1000 <= nowMs`.
 *
 * Questo è il ponte fra la vostra identità (locale o Keycloak) e la presenza
 * dentro la mappa: senza di esso i partecipanti entrano anonimi e il badge
 * "verificato" nel roster non compare.
 */
import { createHmac } from "node:crypto";

export interface IdentityTokenPayload {
  userId: string;
  username: string;
  provider?: string;
  /** Epoch in secondi. */
  exp?: number;
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function signIdentityToken(payload: IdentityTokenPayload, secret: string): string {
  if (!secret) throw new Error("COLLAB_IDENTITY_SECRET non configurato");
  if (!payload.userId) throw new Error("identityToken: userId mancante");
  if (!payload.username) throw new Error("identityToken: username mancante");

  const encodedPayload = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signature = base64url(createHmac("sha256", secret).update(encodedPayload, "utf8").digest());
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifica locale, usata dai test e da un eventuale endpoint di diagnostica.
 * Replica la semantica del relay: qualunque fallimento restituisce null, senza
 * distinguere il motivo — distinguerlo permetterebbe di sondare il segreto.
 */
export function verifyIdentityToken(
  token: unknown,
  secret: string | undefined | null,
  nowMs: number = Date.now(),
): { provider: string; userId: string; username: string } | null {
  if (typeof secret !== "string" || !secret) return null;
  if (typeof token !== "string" || !token) return null;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".") || dot === token.length - 1) return null;

  const encodedPayload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) return null;

  const expected = base64url(
    createHmac("sha256", secret).update(encodedPayload, "utf8").digest(),
  );
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  let claims: Record<string, unknown>;
  try {
    const padded = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    claims = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (typeof claims.userId !== "string" || !claims.userId) return null;
  if (typeof claims.username !== "string" || !claims.username) return null;
  if (claims.exp !== undefined) {
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) return null;
    if (claims.exp * 1000 <= nowMs) return null;
  }

  return {
    provider: typeof claims.provider === "string" && claims.provider ? claims.provider : "geolibre",
    userId: claims.userId,
    username: claims.username,
  };
}
