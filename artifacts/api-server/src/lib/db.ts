// Єдине підключення до бази даних на процес. Відкривається під час першого запиту, якому потрібна база,
// і виконує міграції зі спільного каталогу lib/db/drizzle.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestHandler } from "express";
import { openDatabase, type Db, type DbHandle } from "@workspace/db";
import { logger } from "./logger.js";

// каталог міграцій lib/db/drizzle шукається вгору від цього модуля: він лежить у dist (зібраний сервер) або в src/lib (тести)
function findMigrations(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "lib", "db", "drizzle");
    if (existsSync(path.join(candidate, "meta", "_journal.json"))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error("lib/db/drizzle not found; set DB_MIGRATIONS");
}
const migrationsFolder = process.env.DB_MIGRATIONS ?? findMigrations();

let pending: Promise<DbHandle> | null = null;

export function database(): Promise<DbHandle> {
  pending ??= openDatabase({ migrationsFolder }).then((h) => {
    logger.info({ kind: h.kind }, "database ready");
    return h;
  }).catch((e) => { pending = null; throw e; });
  return pending;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { db: Db } }
}

/** Додає до запиту підключення до бази; якщо база недоступна, відповідає 503 */
export const withDb: RequestHandler = (req, res, next) => {
  database().then((h) => { req.db = h.db; next(); }).catch((e) => {
    logger.error({ err: e }, "database unavailable");
    res.status(503).json({ error: "База даних тимчасово недоступна" });
  });
};
