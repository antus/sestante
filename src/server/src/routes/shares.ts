/**
 * Condivisione: invito per email, cambio ruolo, revoca e link d'invito.
 *
 * Invitare un indirizzo che non ha ancora un account crea un utente in attesa
 * (senza password e senza provider Keycloak): al primo accesso — locale o SSO —
 * quella riga viene riconciliata e la condivisione è già lì. È il comportamento
 * che ci si aspetta da uno strumento di lavoro, invece di perdere l'invito.
 */
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { db, logActivity, newId, now, type InviteRow, type UserRow } from "../db.js";
import { canManageSharing, loadMapFor } from "../acl.js";
import { colorFor, publicUser, userByEmail, userById } from "../users.js";
import { requireUser } from "./maps.js";
import { resetCollabSession } from "./collab.js";
import { config } from "../config.js";

async function pendingUser(email: string): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const existing = await userByEmail(normalized);
  if (existing) return existing;

  const id = newId();
  await db().run(
    `INSERT INTO users (id, email, display_name, provider, password_hash, color, locale, theme, accent, created_at)
     VALUES (?, ?, ?, 'pending', NULL, ?, 'it', 'system', 'blue', ?)`,
    id,
    normalized,
    normalized.split("@")[0] ?? normalized,
    colorFor(normalized),
    now(),
  );
  return (await userById(id)) as UserRow;
}

export async function shareRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/maps/:id/shares", async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });

    const owner = await userById(found.map.owner_id);
    // Alias espliciti: `s.id` e `u.id` hanno lo stesso nome, e con `u.*` quale
    // dei due finisce in `row.id` dipende dal driver.
    const rows = await db().all<UserRow & { share_id: string; share_role: string }>(
      `SELECT u.*, s.id AS share_id, s.role AS share_role
         FROM shares s JOIN users u ON u.id = s.user_id
        WHERE s.map_id = ? ORDER BY s.created_at`,
      id,
    );

    const invites = canManageSharing(found.role)
      ? await db().all<InviteRow>("SELECT * FROM invites WHERE map_id = ? ORDER BY created_at DESC", id)
      : [];

    return {
      owner: owner ? publicUser(owner) : null,
      people: rows.map((row) => ({
        shareId: row.share_id,
        role: row.share_role,
        user: publicUser(row),
      })),
      generalAccess: found.map.general_access,
      generalRole: found.map.general_role,
      shareUrl: `${config.publicUrl}/m/${id}`,
      invites: invites.map((i) => ({
        token: i.token,
        role: i.role,
        uses: i.uses,
        maxUses: i.max_uses,
        url: `${config.publicUrl}/m/${id}?invito=${i.token}`,
      })),
      canManage: canManageSharing(found.role),
    };
  });

  app.post("/api/maps/:id/shares", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    const body = (request.body ?? {}) as { email?: unknown; role?: string };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = body.role === "editor" ? "editor" : "viewer";

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.code(400).send({ error: "invalid-email" });
    }

    const target = await pendingUser(email);
    if (target.id === found.map.owner_id) {
      return reply.code(400).send({ error: "already-owner" });
    }

    const previous = await db().get<{ role: string }>(
      "SELECT role FROM shares WHERE map_id = ? AND user_id = ?",
      id,
      target.id,
    );

    // UPSERT: reinvitare qualcuno già presente ne aggiorna il ruolo invece di
    // fallire con un vincolo violato.
    await db().run(
      `INSERT INTO shares (id, map_id, user_id, role, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
      newId(),
      id,
      target.id,
      role,
      now(),
      user.id,
    );
    await logActivity(id, user.id, "shared", `${email}:${role}`);
    // Da editor a lettore: chi è nella sessione collaborativa ha ancora
    // l'invito di scrittura, quindi la sessione si sostituisce.
    if (previous?.role === "editor" && role === "viewer") await resetCollabSession(id);

    return reply.code(201).send({ user: publicUser(target), role });
  });

  app.patch("/api/maps/:id/shares/:shareId", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id, shareId } = request.params as { id: string; shareId: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    const body = (request.body ?? {}) as { role?: string };
    if (body.role !== "viewer" && body.role !== "editor") {
      return reply.code(400).send({ error: "invalid-role" });
    }

    const result = await db().run(
      "UPDATE shares SET role = ? WHERE id = ? AND map_id = ?",
      body.role,
      shareId,
      id,
    );
    if (result.changes === 0) return reply.code(404).send({ error: "share-not-found" });
    await logActivity(id, user.id, "role-changed", `${shareId}:${body.role}`);
    if (body.role === "viewer") await resetCollabSession(id);

    return { ok: true, role: body.role };
  });

  app.delete("/api/maps/:id/shares/:shareId", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id, shareId } = request.params as { id: string; shareId: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    await db().run("DELETE FROM shares WHERE id = ? AND map_id = ?", shareId, id);
    await logActivity(id, user.id, "unshared", shareId);
    await resetCollabSession(id);
    return { ok: true };
  });

  /** Link d'invito con ruolo, speculare al `mint-invite` del relay GeoLibre. */
  app.post("/api/maps/:id/invites", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    const body = (request.body ?? {}) as { role?: string; maxUses?: number; expiresInDays?: number };
    const role = body.role === "editor" ? "editor" : "viewer";
    const token = randomBytes(18).toString("base64url");
    const expiresAt =
      typeof body.expiresInDays === "number" && body.expiresInDays > 0
        ? now() + body.expiresInDays * 86_400_000
        : null;

    await db().run(
      `INSERT INTO invites (token, map_id, role, expires_at, max_uses, uses, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      token,
      id,
      role,
      expiresAt,
      body.maxUses ?? null,
      now(),
      user.id,
    );

    return reply.code(201).send({
      token,
      role,
      url: `${config.publicUrl}/m/${id}?invito=${token}`,
    });
  });

  app.delete("/api/maps/:id/invites/:token", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id, token } = request.params as { id: string; token: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    await db().run("DELETE FROM invites WHERE token = ? AND map_id = ?", token, id);
    return { ok: true };
  });

  /** Riscatto di un link d'invito: trasforma il token in una condivisione. */
  app.post("/api/invites/:token/redeem", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { token } = request.params as { token: string };

    const invite = await db().get<InviteRow>("SELECT * FROM invites WHERE token = ?", token);
    if (!invite) return reply.code(404).send({ error: "invalid-invite" });
    if (invite.expires_at && invite.expires_at < now()) {
      return reply.code(410).send({ error: "invite-expired" });
    }
    if (invite.max_uses !== null && invite.uses >= invite.max_uses) {
      return reply.code(410).send({ error: "invite-exhausted" });
    }

    const map = await db().get<{ owner_id: string }>(
      "SELECT owner_id FROM maps WHERE id = ?",
      invite.map_id,
    );
    if (!map) return reply.code(404).send({ error: "not-found" });

    if (map.owner_id !== user.id) {
      await db().run(
        `INSERT INTO shares (id, map_id, user_id, role, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
        newId(),
        invite.map_id,
        user.id,
        invite.role,
        now(),
        invite.created_by,
      );
    }
    await db().run("UPDATE invites SET uses = uses + 1 WHERE token = ?", token);
    await logActivity(invite.map_id, user.id, "invite-redeemed", invite.role);

    return { mapId: invite.map_id, role: invite.role };
  });
}
