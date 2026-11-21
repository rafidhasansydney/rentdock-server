import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { notFound, errorHandler } from "./errors.js";
import { databaseService } from "./database.js";
import { toNodeHandler } from "better-auth/node";
import { createAccountRoutes } from "./auth/routes.js";

export function createApp({ database = databaseService, isShuttingDown = () => false, authentication } = {}) {
  const app = express();
  const settings = authentication?.settings ?? config;
  app.disable("x-powered-by");
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === settings.clientOrigin) return callback(null, true);
      const error = new Error("Origin is not allowed.");
      error.status = 403;
      callback(error);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }));
  app.get("/api/auth-config", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ available: Boolean(authentication), google: Boolean(authentication?.googleEnabled) });
  });
  if (authentication) app.all("/api/auth/{*splat}", toNodeHandler(authentication.auth));
  app.use(express.json({ limit: "100kb" }));
  if (authentication) app.use("/api", createAccountRoutes({ auth: authentication.auth, settings: authentication.settings }));
  app.get("/api/health", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok", service: "rentdock-server", version: "0.1.0" });
  });
  app.get("/api/ready", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (isShuttingDown()) return res.status(503).json({ status: "not_ready", database: "unavailable" });
    try {
      await database.ping();
      if (isShuttingDown()) return res.status(503).json({ status: "not_ready", database: "unavailable" });
      res.json({ status: "ready", database: "ok" });
    } catch {
      res.status(503).json({ status: "not_ready", database: "unavailable" });
    }
  });
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
