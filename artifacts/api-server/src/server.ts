// Запуск сервера: API за адресою /api і, якщо клієнт зібрано, його статичні файли з того самого джерела
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import app from "./app.js";
import { database } from "./lib/db.js";
import { logger } from "./lib/logger.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = process.env.STATIC_DIR ?? path.resolve(here, "../../evpredict/dist/public");

if (existsSync(path.join(staticDir, "index.html"))) {
  app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
  // маршрутизація односторінкового застосунку: усі адреси, крім /api, віддають index.html
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  logger.info({ staticDir }, "serving client");
}

const port = Number(process.env.PORT ?? 5000);
await database();
app.listen(port, "0.0.0.0", () => logger.info({ port }, "EVPredict server listening"));
