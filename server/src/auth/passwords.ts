/**
 * Hashing delle password per l'autenticazione locale.
 *
 * scrypt di `node:crypto`: è memory-hard, sta nella libreria standard e non
 * richiede una dipendenza nativa (argon2 e bcrypt la richiedono, ed è proprio
 * quello che rende doloroso un `npm install` su una postazione Windows senza
 * build tools). I parametri sono quelli raccomandati da OWASP per scrypt:
 * N=2^15, r=8, p=1 — circa 32 MB di memoria per verifica.
 *
 * Il formato memorizzato porta con sé i parametri, così un domani si possono
 * alzare senza invalidare gli hash esistenti: le vecchie righe continuano a
 * verificare con i propri, e si ri-hasha al primo login riuscito.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
// scrypt richiede maxmem >= 128 * N * r; il default di Node (32 MB) è al limite
// e fallisce con N=2^15, quindi lo si alza esplicitamente.
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, "base64url");
    expected = Buffer.from(parts[5] as string, "base64url");
  } catch {
    return false;
  }

  let actual: Buffer;
  try {
    actual = await scrypt(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 128 * n * r * 2,
    });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Requisiti minimi, volutamente sobri: la policy vera la impone Keycloak. */
export function passwordProblem(password: string): string | null {
  if (typeof password !== "string" || password.length < 10) return "too-short";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "too-simple";
  return null;
}
