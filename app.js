import express from "express";
import { createHostedHandler } from "./src/hosting.js";
const app = express();
app.disable("x-powered-by");
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ status: "ok", service: "rentdock-server", version: "0.1.0" });
});
app.use(createHostedHandler());
export default app;
