// Паролі і сеанси входу.
// Пароль зберігається як хеш scrypt (вбудований у Node.js crypto) з випадковою сіллю.
// Сеанс: випадковий токен у cookie з прапорцями HttpOnly і SameSite=Lax; у базі лише його хеш SHA-256.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { and, eq, gt } from "drizzle-orm";
import { sessions, users, type Db } from "@workspace/db";

const scrypt = promisify(scryptCb) as (pwd: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(key, expected);
}

export const SESSION_COOKIE = "evp_session";
const SESSION_DAYS = 30;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
  maxAge: SESSION_DAYS * 86400000,
});

export async function startSession(db: Db, res: Response, userId: number) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000) });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function endSession(db: Db, req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string") await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

export interface SessionUser { id: number; email: string; name: string | null }

export async function currentUser(db: Db, req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || token.length < 20) return null;
  const rows = await db.select({ id: users.id, email: users.email, name: users.name }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return rows[0] ?? null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user: SessionUser } }
}

/** Пропускає далі лише запити з чинним сеансом */
export const requireUser: RequestHandler = (req, res, next) => {
  currentUser(req.db, req).then((u) => {
    if (!u) return void res.status(401).json({ error: "Потрібно увійти в обліковий запис" });
    req.user = u;
    next();
  }).catch(next);
};

/** Просте обмеження частоти спроб входу: не більше 10 спроб на адресу за 10 хвилин */
const attempts = new Map<string, { n: number; since: number }>();
export function tooManyAttempts(key: string): boolean {
  const now = Date.now(), a = attempts.get(key);
  if (!a || now - a.since > 10 * 60000) { attempts.set(key, { n: 1, since: now }); return false; }
  a.n += 1;
  return a.n > 10;
}
export const resetAttempts = (key: string) => attempts.delete(key);
