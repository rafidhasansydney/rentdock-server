import { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { validId } from "./database.js";
import { adminError, adminQuery, userChanges, moderation, adminEquipment, rentalChanges, managementVersion } from "./policy.js";

export function createAdministrationRoutes({ administration, analytics, authentication }) {
  const router = Router(), auth = createAuthorization({ auth: authentication.auth, settings: authentication.settings });
  router.use("/admin", auth.verifyToken, auth.verifyAdmin);
  const run = action => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await action(req)); }
    catch (error) { const safe = error.adminError && [400, 403, 404, 409, 503].includes(error.status); res.status(safe ? error.status : 503).json({ error: { code: "MANAGEMENT_REQUEST_FAILED", message: safe ? error.message : "Management information could not be loaded or saved. Please try again." } }); }
  };
  const id = req => { if (!validId(req.params.id)) throw adminError("This record was not found.", 404); return req.params.id; };
  router.get("/admin/analytics", run(req => { if (Object.keys(req.query).length) throw adminError("No analytics filters are supported here."); return analytics.summary(); }));
  router.get("/owner/analytics", auth.verifyToken, auth.verifyOwner, run(req => { if (Object.keys(req.query).length) throw adminError("No analytics filters are supported here."); return analytics.summary(req.user.id); }));
  router.get("/admin/users", run(req => administration.users(adminQuery(req.query, "users"))));
  router.patch("/admin/users/:id", run(req => administration.changeUser(req.user.id, id(req), userChanges(req.body))));
  router.get("/admin/equipment", run(req => administration.equipment(adminQuery(req.query, "equipment"))));
  router.get("/admin/equipment/:id", run(req => administration.equipmentItem(id(req))));
  router.patch("/admin/equipment/:id/review", run(req => administration.moderate(req.user.id, id(req), moderation(req.body))));
  router.patch("/admin/equipment/:id", run(req => administration.updateEquipment(req.user.id, id(req), adminEquipment(req.body))));
  router.delete("/admin/equipment/:id", run(req => {
    if (Object.keys(req.query).some(key => key !== "version") || typeof req.query.version !== "string") throw adminError("Reload the listing before deleting it.");
    return administration.deleteEquipment(req.user.id, id(req), managementVersion(Number(req.query.version)));
  }));
  router.get("/admin/rentals", run(req => administration.rentals(adminQuery(req.query, "rentals"))));
  router.patch("/admin/rentals/:id", run(req => administration.manageRental(req.user.id, id(req), rentalChanges(req.body))));
  return router;
}
