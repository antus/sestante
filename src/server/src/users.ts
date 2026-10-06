/** Accesso agli utenti: lettura, creazione locale e upsert da Keycloak. */
import { db, newId, now, type UserRow } from "./db.js";
import { hashPassword } from "./auth/passwords.js";

/** Palette dei colori di presenza, la stessa che il relay valida come esadecimale. */
const COLORS = ["#2563eb", "#059669", "#d946ef", "#f59e0b", "#0891b2", "#e11d48", "#7c3aed"];

export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length] as string;
}

export async function userById(id: string): Promise<UserRow | null> {
  return (await db().get<UserRow>("SELECT * FROM users WHERE id = ?", id)) ?? null;
}

export async function userByEmail(email: string): Promise<UserRow | null> {
  return (
    (await db().get<UserRow>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase())) ??
    null
  );
}

export async function createLocalUser(
  email: string,
  displayName: string,
  password: string,
): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const id = newId();
  await db().run(
    `INSERT INTO users (id, email, display_name, provider, password_hash, color, locale, theme, accent, created_at)
     VALUES (?, ?, ?, 'local', ?, ?, 'it', 'system', 'blue', ?)`,
    id,
    normalized,
    displayName.trim() || normalized,
    await hashPassword(password),
    colorFor(normalized),
    now(),
  );
  return (await userById(id)) as UserRow;
}

/**
 * Un utente Keycloak esistente viene riconosciuto per `sub`; se è la prima
 * volta ma l'email corrisponde a un utente locale, i due account vengono
 * collegati invece di creare un doppione. È il caso reale di chi ha usato
 * l'accesso locale durante i test e poi passa all'SSO.
 */
export async function upsertKeycloakUser(
  subject: string,
  email: string,
  displayName: string,
): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();

  const bySubject = await db().get<UserRow>("SELECT * FROM users WHERE external_id = ?", subject);
  if (bySubject) {
    await db().run(
      "UPDATE users SET email = ?, display_name = ? WHERE id = ?",
      normalized,
      displayName,
      bySubject.id,
    );
    return (await userById(bySubject.id)) as UserRow;
  }

  const byEmail = await userByEmail(normalized);
  if (byEmail) {
    await db().run(
      "UPDATE users SET external_id = ?, provider = 'keycloak', display_name = ? WHERE id = ?",
      subject,
      displayName,
      byEmail.id,
    );
    return (await userById(byEmail.id)) as UserRow;
  }

  const id = newId();
  await db().run(
    `INSERT INTO users (id, email, display_name, provider, password_hash, external_id, color, locale, theme, accent, created_at)
     VALUES (?, ?, ?, 'keycloak', NULL, ?, ?, 'it', 'system', 'blue', ?)`,
    id,
    normalized,
    displayName,
    subject,
    colorFor(normalized),
    now(),
  );
  return (await userById(id)) as UserRow;
}

/** Proiezione sicura verso il client: mai password_hash, mai external_id. */
export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    provider: user.provider,
    color: user.color,
    locale: user.locale,
    theme: user.theme,
    accent: user.accent,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
