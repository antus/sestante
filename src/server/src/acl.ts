/**
 * Permessi sulle mappe. Unico punto in cui si decide chi può fare cosa.
 *
 * Il ruolo effettivo si calcola nello stesso ordine che usa GeoLibre per i
 * permessi di sessione — il più specifico vince:
 *
 *   1. il proprietario può sempre tutto;
 *   2. una condivisione esplicita per quell'utente;
 *   3. l'accesso generale della mappa (privata / organizzazione / link).
 *
 * `null` significa nessun accesso: le rotte lo traducono in 404, non 403, per
 * non rivelare l'esistenza di una mappa a chi non la può vedere.
 */
import { db, type GeneralAccess, type MapRow, type Role, type UserRow } from "./db.js";
import { config } from "./config.js";

export type EffectiveRole = Role | null;

export async function effectiveRole(map: MapRow, user: UserRow | null): Promise<EffectiveRole> {
  if (user && map.owner_id === user.id) return "owner";

  if (user) {
    const share = await db().get<{ role: Exclude<Role, "owner"> }>(
      "SELECT role FROM shares WHERE map_id = ? AND user_id = ?",
      map.id,
      user.id,
    );
    if (share) return share.role;
  }

  return generalRoleFor(map.general_access, map.general_role, user);
}

function generalRoleFor(
  access: GeneralAccess,
  role: Exclude<Role, "owner">,
  user: UserRow | null,
): EffectiveRole {
  if (access === "private") return null;
  if (access === "link") return role;
  if (access === "org") {
    if (!user) return null;
    const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
    return domain === config.orgDomain ? role : null;
  }
  return null;
}

export function canView(role: EffectiveRole): boolean {
  return role !== null;
}

export function canEdit(role: EffectiveRole): boolean {
  return role === "owner" || role === "editor";
}

export function canManageSharing(role: EffectiveRole): boolean {
  return role === "owner";
}

/**
 * Carica una mappa applicando i permessi. Restituisce null quando l'utente non
 * ha titolo a sapere che quella mappa esiste.
 */
export async function loadMapFor(
  mapId: string,
  user: UserRow | null,
): Promise<{ map: MapRow; role: Role } | null> {
  const map = await db().get<MapRow>("SELECT * FROM maps WHERE id = ?", mapId);
  if (!map) return null;
  const role = await effectiveRole(map, user);
  if (!role) return null;
  return { map, role };
}
