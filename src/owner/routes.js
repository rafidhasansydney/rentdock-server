import { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { validEquipmentId } from "../catalog/query.js";
import { parseOwnerQuery, validateOwnerEquipment } from "./policy.js";

export function createOwnerRoutes({ owner, authentication }) {
  const router = Router();
  const permissions = createAuthorization({ auth: authentication.auth, settings: authentication.settings });
  router.use("/owner", permissions.verifyToken, permissions.verifyOwner);
  const missing = res => res.status(404).json({ error: { code: "LISTING_NOT_FOUND", message: "This listing is not available in your equipment." } });
  const failed = res => res.status(503).json({ error: { code: "OWNER_UNAVAILABLE", message: "Your equipment could not be updated or loaded. Please try again." } });
  const conflict = res => res.status(409).json({ error: { code: "LISTING_CONFLICT", message: "This listing changed or has active rentals. Reload it before editing or deleting." } });
  const invalid = (res, message) => res.status(400).json({ error: { code: "INVALID_LISTING", message } });
  router.get("/owner/summary", async (req, res) => { try { res.json(await owner.summary(req.user.id)); } catch { failed(res); } });
  router.get("/owner/equipment", async (req, res) => {
    let query;
    try { query = parseOwnerQuery(req.query); } catch (error) { return invalid(res, error.message); }
    try { res.json(await owner.list(req.user.id, query)); } catch { failed(res); }
  });
  router.get("/owner/equipment/:id", async (req, res) => {
    if (!validEquipmentId(req.params.id)) return missing(res);
    try { const item = await owner.get(req.user.id, req.params.id); if (!item) return missing(res); res.json({ item }); } catch { failed(res); }
  });
  router.post("/owner/equipment", async (req, res) => {
    let input;
    try { input = validateOwnerEquipment(req.body); } catch (error) { return invalid(res, error.message); }
    try { res.status(201).json({ item: await owner.create(req.user, input) }); } catch { failed(res); }
  });
  router.patch("/owner/equipment/:id", async (req, res) => {
    if (!validEquipmentId(req.params.id)) return missing(res);
    let input;
    try { input = validateOwnerEquipment(req.body, { update: true }); } catch (error) { return invalid(res, error.message); }
    try { const result = await owner.update(req.user.id, req.params.id, input); if (result.item) return res.json(result); return result.conflict ? conflict(res) : missing(res); } catch { failed(res); }
  });
  router.delete("/owner/equipment/:id", async (req, res) => {
    if (!validEquipmentId(req.params.id)) return missing(res);
    const version = Number(req.query.version);
    if (Object.keys(req.query).some(key => key !== "version") || !Number.isSafeInteger(version) || version < 1) return invalid(res, "Reload the listing before deleting it.");
    try { const result = await owner.remove(req.user.id, req.params.id, version); if (result.removed) return res.json({ removed: true }); return result.conflict ? conflict(res) : missing(res); } catch { failed(res); }
  });
  return router;
}
