import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { notFound, errorHandler } from "./errors.js";
const app = express();
app.disable("x-powered-by");
app.use(cors({ origin(origin, callback) {
  if (!origin || origin === config.clientOrigin) return callback(null, true);
  const error = new Error("Origin is not allowed.");
  error.status = 403;
  callback(error);
}, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "100kb" }));
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "ok", service: "rentdock-server", version: "0.1.0" });
});
app.use(notFound);
app.use(errorHandler);
export default app;
