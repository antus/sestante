/**
 * Sessioni via cookie firmato.
 *
 * Stesso schema a due segmenti dell'identityToken di GeoLibre — payload
 * base64url + HMAC-SHA256 sul segmento codificato — riusato qui di proposito:
 * un solo primitivo crittografico nel progetto è un solo posto dove sbagliare,
 * e non introduce una dipendenza JWT per firmare tre campi.
 *
 * Il cookie è HttpOnly e SameSite=Lax: Lax e non Strict perché il ritorno da
 * Keycloak è una navigazione cross-site, e con Strict il cookie appena emesso
 * non verrebbe inviato al primo caricamento dell'app.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export const SESSION_COOKIE = "sestante_session";

interface SessionClaims {
  uid: string;
  exp: number;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(encodedPayload, "utf8")
    .digest("base64url");
}

export function createSessionToken(userId: string): string {
  const claims: SessionClaims = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function readSessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;

  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(encoded);
  if (signature.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

  try {
    const claims = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.uid !== "string" || !claims.uid) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
    return claims.uid;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, userId: string): void {
  reply.setCookie(SESSION_COOKIE, createSessionToken(userId), {
    // Il cookie vale per l'app, non per tutto l'host.
    path: config.appBase,
    httpOnly: true,
    sameSite: "lax",
    // Dipende da come l'app è raggiunta, non da NODE_ENV: l'eseguibile locale
    // è un build di produzione servito in http su localhost.
    secure: config.publicUrl.startsWith("https:"),
    maxAge: config.sessionTtlSeconds,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: config.appBase });
  reply.clearCookie(ID_TOKEN_COOKIE, { path: config.appBase });
}

/**
 * L'id_token dell'accesso con Keycloak, conservato solo per l'uscita
 * (id_token_hint). HttpOnly e limitato al percorso dell'app come la sessione:
 * non è una credenziale per Sestante, che si fida soltanto del cookie firmato.
 */
export const ID_TOKEN_COOKIE = "sestante_idt";

export function setIdTokenCookie(reply: FastifyReply, idToken: string): void {
  reply.setCookie(ID_TOKEN_COOKIE, idToken, {
    path: config.appBase,
    httpOnly: true,
    sameSite: "lax",
    secure: config.publicUrl.startsWith("https:"),
    maxAge: config.sessionTtlSeconds,
  });
}

export function currentUserId(request: FastifyRequest): string | null {
  return readSessionToken(request.cookies[SESSION_COOKIE]);
}
