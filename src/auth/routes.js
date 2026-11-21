import { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { profileError, publicUser } from "./policy.js";

export function createAccountRoutes({ auth, settings }) {
  const router = Router();
  const permissions = createAuthorization({ auth, settings });
  router.use(["/profile", "/dashboard"], permissions.verifyToken);
  router.get("/profile", (req, res) => res.json({ user: req.user }));
  router.patch("/profile", async (req, res) => {
    const fields = ["name", "image", "phone", "address"];
    const issue = profileError(req.body);
    if (issue || Object.keys(req.body ?? {}).some(key => !fields.includes(key))) return res.status(400).json({ error: { code: "INVALID_PROFILE", message: issue || "Only name, photo, phone and address can be updated here." } });
    const update = Object.fromEntries(Object.entries(req.body).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value]));
    try {
      await auth.api.updateUser({ body: update, headers: req.authHeaders });
      const active = await auth.api.getSession({ headers: req.authHeaders, query: { disableCookieCache: true } });
      if (!active) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in again to view your profile." } });
      res.json({ user: publicUser(active.user) });
    } catch {
      res.status(503).json({ error: { code: "PROFILE_UPDATE_FAILED", message: "Your profile could not be saved. Please try again." } });
    }
  });
  router.get("/dashboard/customer", permissions.verifyRenter, (req, res) => res.json({ user: req.user }));
  router.get("/dashboard/owner", permissions.verifyOwner, (req, res) => res.json({ user: req.user }));
  router.get("/dashboard/admin", permissions.verifyAdmin, (req, res) => res.json({ user: req.user }));
  return router;
}
