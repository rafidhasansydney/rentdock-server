import express, { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { imageTypes, maxImageBytes } from "./service.js";

export function createImageRoutes({ uploads, authentication }) {
  const router = Router();
  const permissions = authentication && createAuthorization({ auth: authentication.auth, settings: authentication.settings });
  router.get("/uploads/config", (req, res) => { res.set("Cache-Control", "no-store"); res.json({ enabled: uploads.enabled, maxBytes: maxImageBytes, types: imageTypes }); });
  router.post("/uploads/image", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.headers.authorization) {
      if (!permissions) return res.status(503).json({ error: { code: "UPLOAD_UNAVAILABLE", message: "Image upload is currently unavailable." } });
      return permissions.verifyToken(req, res, next);
    }
    next();
  }, express.raw({ type: imageTypes, limit: maxImageBytes }), async (req, res) => {
    try {
      const result = await uploads.upload({ bytes: req.body, type: req.get("Content-Type")?.split(";")[0], userId: req.user?.id, address: req.socket.remoteAddress || "unknown" });
      res.status(201).json(result);
    } catch (error) {
      const controlled = [400, 429, 502, 503].includes(error.status);
      const status = controlled ? error.status : 503;
      res.status(status).json({ error: { code: "IMAGE_UPLOAD_FAILED", message: controlled ? error.message : "The image could not be saved. Please try again." } });
    }
  });
  return router;
}
