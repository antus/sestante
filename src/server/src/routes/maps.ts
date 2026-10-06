/** CRUD delle mappe e liste per la dashboard. */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { db, logActivity, newId, now, type MapRow, type UserRow } from "../db.js";
import { currentUserId } from "../auth/session.js";
import { canEdit, canManageSharing, loadMapFor } from "../acl.js";
import { publicUser, userById } from "../users.js";
import { storage } from "../storage.js";
import { resetCollabSession } from "./collab.js";

export async function requireUser(request: FastifyRequest): Promise<UserRow | null> {
  const id = currentUserId(request);
  return id ? userById(id) : null;
}

const THUMBS = ["lazio", "italia", "alpi", "medit", "europa", "mondo", "adriat"];

interface MapSummary {
  id: string;
  name: string;
  description: string;
  thumb: string;
  role: string;
  generalAccess: string;
  generalRole: string;
  updatedAt: number;
  owner: { id: string; displayName: string; color: string };
  collaborators: { id: string; displayName: string; color: string; role: string }[];
  liveSession: boolean;
}

async function summarize(map: MapRow, role: string): Promise<MapSummary> {
  const owner = await userById(map.owner_id);
  const rows = await db().all<{ id: string; display_name: string; color: string; role: string }>(
    `SELECT u.id, u.display_name, u.color, s.role
       FROM shares s JOIN users u ON u.id = s.user_id
      WHERE s.map_id = ? ORDER BY s.created_at`,
    map.id,
  );

  return {
    id: map.id,
    name: map.name,
    description: map.description,
    thumb: map.thumb,
    role,
    generalAccess: map.general_access,
    generalRole: map.general_role,
    updatedAt: map.updated_at,
    owner: {
      id: owner?.id ?? map.owner_id,
      displayName: owner?.display_name ?? "—",
      color: owner?.color ?? "#64748b",
    },
    collaborators: rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      color: r.color,
      role: r.role,
    })),
    liveSession: Boolean(map.collab_session_id),
  };
}

function mapById(id: string): Promise<MapRow | undefined> {
  return db().get<MapRow>("SELECT * FROM maps WHERE id = ?", id);
}

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  /** Elenco: `scope` = mine | shared | all. */
  app.get("/api/maps", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const { scope = "all" } = (request.query ?? {}) as { scope?: string };
    const owned = await db().all<MapRow>(
      "SELECT * FROM maps WHERE owner_id = ? ORDER BY updated_at DESC",
      user.id,
    );
    // Il ruolo arriva con la stessa query: una riga per mappa condivisa.
    const shared = await db().all<MapRow & { share_role: string }>(
      `SELECT m.*, s.role AS share_role FROM maps m JOIN shares s ON s.map_id = m.id
        WHERE s.user_id = ? ORDER BY m.updated_at DESC`,
      user.id,
    );

    const mine = () => Promise.all(owned.map((m) => summarize(m, "owner")));
    const others = () => Promise.all(shared.map((m) => summarize(m, m.share_role ?? "viewer")));
    const items =
      scope === "mine" ? await mine() : scope === "shared" ? await others() : [...(await mine()), ...(await others())];

    return {
      items,
      counts: { mine: owned.length, shared: shared.length },
    };
  });

  app.post("/api/maps", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });

    const body = (request.body ?? {}) as { name?: string; description?: string; thumb?: string };
    const id = newId();
    const timestamp = now();
    const thumb = THUMBS.includes(body.thumb ?? "") ? (body.thumb as string) : "italia";

    await db().run(
      `INSERT INTO maps (id, owner_id, name, description, project_json, thumb,
                         general_access, general_role, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'private', 'viewer', ?, ?)`,
      id,
      user.id,
      (body.name ?? "").trim() || "Mappa senza titolo",
      (body.description ?? "").trim(),
      thumb,
      timestamp,
      timestamp,
    );
    await logActivity(id, user.id, "created");

    const map = (await mapById(id)) as MapRow;
    return reply.code(201).send({ map: await summarize(map, "owner") });
  });

  app.get("/api/maps/:id", async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });

    return {
      map: await summarize(found.map, found.role),
      project: found.map.project_json ? JSON.parse(found.map.project_json) : null,
      role: found.role,
    };
  });

  app.patch("/api/maps/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canEdit(found.role)) return reply.code(403).send({ error: "read-only" });

    const body = (request.body ?? {}) as {
      name?: string;
      description?: string;
      project?: unknown;
    };

    if (typeof body.name === "string") {
      await db().run("UPDATE maps SET name = ? WHERE id = ?", body.name.trim() || "Mappa senza titolo", id);
    }
    if (typeof body.description === "string") {
      await db().run("UPDATE maps SET description = ? WHERE id = ?", body.description.trim(), id);
    }
    if (body.project !== undefined) {
      const serialized = JSON.stringify(body.project);
      // Stesso ordine di grandezza del limite del relay: una mappa che non
      // passa di lì non deve neanche entrare nel database.
      if (serialized.length > 10 * 1024 * 1024) {
        return reply.code(413).send({ error: "project-too-large" });
      }
      await db().run("UPDATE maps SET project_json = ? WHERE id = ?", serialized, id);
    }

    await db().run("UPDATE maps SET updated_at = ? WHERE id = ?", now(), id);
    await logActivity(id, user.id, "updated");

    const map = (await mapById(id)) as MapRow;
    return { map: await summarize(map, found.role) };
  });

  /** Accesso generale: privata, organizzazione, chiunque abbia il link. */
  app.patch("/api/maps/:id/access", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (!canManageSharing(found.role)) return reply.code(403).send({ error: "owner-only" });

    const body = (request.body ?? {}) as { generalAccess?: string; generalRole?: string };
    const access = body.generalAccess;
    const role = body.generalRole;
    if (access && !["private", "org", "link"].includes(access)) {
      return reply.code(400).send({ error: "invalid-access" });
    }
    if (role && !["viewer", "editor"].includes(role)) {
      return reply.code(400).send({ error: "invalid-role" });
    }

    await db().run(
      "UPDATE maps SET general_access = ?, general_role = ?, updated_at = ? WHERE id = ?",
      access ?? found.map.general_access,
      role ?? found.map.general_role,
      now(),
      id,
    );
    await logActivity(
      id,
      user.id,
      "access-changed",
      `${access ?? found.map.general_access}/${role ?? found.map.general_role}`,
    );
    // L'accesso generale decide chi entra e con che ruolo anche nella sessione
    // collaborativa: se cambia, la sessione si sostituisce.
    if (
      (access && access !== found.map.general_access) ||
      (role && role !== found.map.general_role)
    ) {
      await resetCollabSession(id);
    }

    const map = (await mapById(id)) as MapRow;
    return { map: await summarize(map, found.role) };
  });

  app.delete("/api/maps/:id", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });
    if (found.role !== "owner") return reply.code(403).send({ error: "owner-only" });

    await db().run("DELETE FROM maps WHERE id = ?", id);
    // Le righe in `files` se ne vanno con ON DELETE CASCADE; i byte su disco
    // no, e nessuno li cancellerebbe mai piu'.
    await storage.removeMap(id);
    return { ok: true };
  });

  app.get("/api/maps/:id/activity", async (request, reply) => {
    const user = await requireUser(request);
    const { id } = request.params as { id: string };
    const found = await loadMapFor(id, user);
    if (!found) return reply.code(404).send({ error: "not-found" });

    const rows = await db().all<{
      action: string;
      detail: string;
      created_at: number;
      display_name: string;
      color: string;
    }>(
      `SELECT a.action, a.detail, a.created_at, u.display_name, u.color
         FROM activity a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.map_id = ? ORDER BY a.created_at DESC LIMIT 50`,
      id,
    );

    return {
      items: rows.map((r) => ({
        action: r.action,
        detail: r.detail,
        at: r.created_at,
        by: { displayName: r.display_name ?? "—", color: r.color ?? "#64748b" },
      })),
    };
  });

  app.get("/api/users/search", async (request, reply) => {
    const user = await requireUser(request);
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    const { q = "" } = (request.query ?? {}) as { q?: string };
    if (q.trim().length < 2) return { items: [] };

    // LOWER su entrambi i lati: LIKE ignora le maiuscole in SQLite ma non in
    // PostgreSQL, e la ricerca deve comportarsi allo stesso modo.
    const pattern = `%${q.trim().toLowerCase()}%`;
    const rows = await db().all<UserRow>(
      "SELECT * FROM users WHERE (LOWER(email) LIKE ? OR LOWER(display_name) LIKE ?) AND id != ? LIMIT 8",
      pattern,
      pattern,
      user.id,
    );
    return { items: rows.map(publicUser) };
  });
}
