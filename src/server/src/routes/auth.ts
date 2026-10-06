/** Rotte di autenticazione: locale (email + password) e Keycloak (OIDC). */
import type { FastifyInstance } from "fastify";
import { config, keycloakEnabled } from "../config.js";
import { clearSessionCookie, currentUserId, setSessionCookie, ID_TOKEN_COOKIE, setIdTokenCookie } from "../auth/session.js";
import { passwordProblem, verifyPassword } from "../auth/passwords.js";
import { completeLogin, endSessionUrl, startLogin } from "../auth/keycloak.js";
import { createLocalUser, publicUser, userByEmail, userById } from "../users.js";

/**
 * Limitatore di tentativi in memoria, per chiave (email + IP). Non sostituisce
 * un rate limiter a monte, ma impedisce che un form di login su una rete
 * interna diventi un oracolo per password deboli.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 5 * 60 * 1000;

function tooManyAttempts(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry || Date.now() > entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}
function recordFailure(key: string): void {
  const entry = attempts.get(key);
  if (!entry || Date.now() > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}
function clearFailures(key: string): void {
  attempts.delete(key);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/config", async () => ({
    keycloakEnabled,
    allowLocalSignup: config.allowLocalSignup,
    orgLabel: config.orgLabel,
    orgDomain: config.orgDomain,
    geolibreUrl: config.geolibreUrl,
  }));

  app.get("/api/me", async (request, reply) => {
    const id = currentUserId(request);
    const user = id ? await userById(id) : null;
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return { user: publicUser(user) };
  });

  app.post("/api/auth/login", async (request, reply) => {
    const body = (request.body ?? {}) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const key = `${email}|${request.ip}`;

    if (!email || !password) return reply.code(400).send({ error: "missing-credentials" });
    if (tooManyAttempts(key)) return reply.code(429).send({ error: "too-many-attempts" });

    const user = await userByEmail(email);
    // Si verifica comunque contro un hash fittizio quando l'utente non esiste,
    // così il tempo di risposta non rivela quali email sono registrate.
    const ok = await verifyPassword(password, user?.password_hash ?? null);

    if (!user || !ok || user.provider !== "local") {
      recordFailure(key);
      return reply.code(401).send({ error: "invalid-credentials" });
    }

    clearFailures(key);
    setSessionCookie(reply, user.id);
    return { user: publicUser(user) };
  });

  app.post("/api/auth/register", async (request, reply) => {
    if (!config.allowLocalSignup) return reply.code(403).send({ error: "signup-disabled" });

    const body = (request.body ?? {}) as {
      email?: string;
      password?: string;
      displayName?: string;
    };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: "invalid-email" });
    }
    const problem = passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    if (await userByEmail(email)) return reply.code(409).send({ error: "email-taken" });

    const user = await createLocalUser(email, body.displayName ?? "", password);
    setSessionCookie(reply, user.id);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  // ── Keycloak ───────────────────────────────────────────────────────────────

  app.get("/api/auth/keycloak/start", async (request, reply) => {
    if (!keycloakEnabled) return reply.code(404).send({ error: "keycloak-disabled" });
    const query = (request.query ?? {}) as { returnTo?: string };
    // Solo percorsi relativi: un returnTo assoluto sarebbe un open redirect.
    const returnTo =
      typeof query.returnTo === "string" && query.returnTo.startsWith("/") ? query.returnTo : "/";
    try {
      return reply.redirect(await startLogin(returnTo));
    } catch (error) {
      request.log.error({ err: error }, "avvio login Keycloak fallito");
      return reply.redirect(`${config.publicUrl}/?auth_error=discovery`);
    }
  });

  app.get("/api/auth/keycloak/callback", async (request, reply) => {
    if (!keycloakEnabled) return reply.code(404).send({ error: "keycloak-disabled" });
    const query = (request.query ?? {}) as { code?: string; state?: string; error?: string };

    if (query.error) return reply.redirect(`${config.publicUrl}/?auth_error=${query.error}`);
    if (!query.code || !query.state) {
      return reply.redirect(`${config.publicUrl}/?auth_error=missing_code`);
    }

    try {
      const { profile, returnTo, idToken } = await completeLogin(query.code, query.state);
      const { upsertKeycloakUser } = await import("../users.js");
      const user = await upsertKeycloakUser(profile.subject, profile.email, profile.displayName);
      setSessionCookie(reply, user.id);
      setIdTokenCookie(reply, idToken);
      return reply.redirect(`${config.publicUrl}${returnTo}`);
    } catch (error) {
      request.log.error({ err: error }, "callback Keycloak fallita");
      return reply.redirect(`${config.publicUrl}/?auth_error=exchange`);
    }
  });

  app.get("/api/auth/keycloak/logout", async (request, reply) => {
    const idToken = request.cookies[ID_TOKEN_COOKIE];
    clearSessionCookie(reply);
    const url = keycloakEnabled ? await endSessionUrl(idToken) : null;
    return reply.redirect(url ?? config.publicUrl);
  });
}
