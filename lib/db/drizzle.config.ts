import { defineConfig } from "drizzle-kit";
import path from "path";

// Генерація міграцій (drizzle-kit generate) не потребує підключення; для push потрібна змінна DATABASE_URL
export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  out: path.join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost/evpredict" },
});
