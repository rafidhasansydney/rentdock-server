import { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { parseCatalogQuery, validEquipmentId } from "./query.js";

export function createCatalogRoutes({ catalog, authentication }) {
  const router = Router();
  router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  const unavailable = res => res.status(503).json({ error: { code: "CATALOG_UNAVAILABLE", message: "Equipment could not be loaded. Please try again shortly." } });
  const missing = res => res.status(404).json({ error: { code: "EQUIPMENT_NOT_FOUND", message: "This equipment is no longer available." } });
  router.get("/equipment", async (req, res) => {
    let query;
    try { query = parseCatalogQuery(req.query); } catch (error) { return res.status(400).json({ error: { code: "INVALID_FILTERS", message: error.message } }); }
    try { res.json(await catalog.list(query)); } catch { unavailable(res); }
  });
  router.get("/equipment-highlights", async (req, res) => {
    try { res.json(await catalog.highlights()); } catch { unavailable(res); }
  });
  if (authentication) {
    const permissions = createAuthorization({ auth: authentication.auth, settings: authentication.settings });
    router.get("/equipment/:id", permissions.verifyToken, async (req, res) => {
      if (!validEquipmentId(req.params.id)) return missing(res);
      try {
        const item = await catalog.details(req.params.id);
        if (!item) return missing(res);
        const favorite = req.user.role === "customer" && await catalog.favoriteStatus(req.user.id, req.params.id);
        res.json({ item, favorite });
      } catch { unavailable(res); }
    });
    router.get("/favorites", permissions.verifyToken, permissions.verifyRenter, async (req, res) => {
      const page = Number(req.query.page || 1);
      if (Object.keys(req.query).some(key => key !== "page") || !Number.isSafeInteger(page) || page < 1 || page > 100000) return res.status(400).json({ error: { code: "INVALID_PAGE", message: "Choose a valid favorites page." } });
      try { res.json(await catalog.favorites(req.user.id, page)); } catch { unavailable(res); }
    });
    router.put("/favorites/:id", permissions.verifyToken, permissions.verifyRenter, async (req, res) => {
      if (!validEquipmentId(req.params.id)) return missing(res);
      try {
        if (!await catalog.addFavorite(req.user.id, req.params.id)) return missing(res);
        res.json({ favorite: true });
      } catch { unavailable(res); }
    });
    router.delete("/favorites/:id", permissions.verifyToken, permissions.verifyRenter, async (req, res) => {
      if (!validEquipmentId(req.params.id)) return missing(res);
      try { await catalog.removeFavorite(req.user.id, req.params.id); res.json({ favorite: false }); } catch { unavailable(res); }
    });
  }
  return router;
}
