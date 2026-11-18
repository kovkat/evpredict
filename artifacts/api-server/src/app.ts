import express, { type Express, type ErrorRequestHandler } from "express";
import cookieParser from "cookie-parser";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.set("trust proxy", 1);
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

app.use("/api", router);

// невідомі адреси API і непередбачені помилки повертаються як JSON, щоб клієнт показав зрозуміле повідомлення
app.use("/api", (_req, res) => { res.status(404).json({ error: "Невідомий запит" }); });
const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err?.type === "entity.too.large") return void res.status(413).json({ error: "Забагато даних в одному запиті" });
  if (err?.type === "entity.parse.failed") return void res.status(400).json({ error: "Некоректний JSON" });
  logger.error({ err }, "request failed");
  res.status(500).json({ error: "Внутрішня помилка сервера" });
};
app.use(onError);

export default app;
