// Підключення до бази даних.
// Якщо задано DATABASE_URL, використовується сервер PostgreSQL (node-postgres).
// Без нього для розробки і тестів запускається вбудований PostgreSQL (PGlite): у каталозі PGLITE_DIR
// (за замовчуванням .data/pglite) або в пам'яті, якщо PGLITE_DIR=memory.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  kind: "postgres" | "pglite";
  close: () => Promise<void>;
}

export async function openDatabase(opts: { migrationsFolder: string; url?: string; pgliteDir?: string }): Promise<DbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: opts.migrationsFolder });
    return { db, kind: "postgres", close: () => pool.end() };
  }
  const dir = opts.pgliteDir ?? process.env.PGLITE_DIR ?? ".data/pglite";
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzleLite } = await import("drizzle-orm/pglite");
  const { migrate: migrateLite } = await import("drizzle-orm/pglite/migrator");
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  const lite = drizzleLite(client, { schema });
  await migrateLite(lite, { migrationsFolder: opts.migrationsFolder });
  // інтерфейс запитів Drizzle однаковий для обох драйверів
  return { db: lite as unknown as Db, kind: "pglite", close: () => client.close() };
}

export * from "./schema";
