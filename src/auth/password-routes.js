import { passwordError } from "./policy.js";
export function mountAdminPasswordRoutes(router, auth, permissions) {
  router.get("/profile/password", permissions.verifyAdmin, async (req, res) => {
    try {
      const context = await auth.$context;
      const account = await context.internalAdapter.findCredentialAccount(req.user.id);
      res.json({ hasPassword: Boolean(account?.password) });
    } catch { res.status(503).json({ error: { code: "ACCOUNT_UNAVAILABLE", message: "Sign-in settings could not be loaded. Please try again." } }); }
  });
  router.post("/profile/password", permissions.verifyAdmin, async (req, res) => {
    const body = req.body;
    const issue = !body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "newPassword") ? "Enter only your new sign-in password." : passwordError(body.newPassword);
    if (issue) return res.status(400).json({ error: { code: "INVALID_PASSWORD", message: issue } });
    try {
      const context = await auth.$context;
      const account = await context.internalAdapter.findCredentialAccount(req.user.id);
      if (account?.password) return res.status(409).json({ error: { code: "PASSWORD_ALREADY_SET", message: "Email/password sign-in is already available. Your existing password was kept." } });
      await auth.api.setPassword({ body: { newPassword: body.newPassword }, headers: req.authHeaders });
      res.json({ saved: true });
    } catch { res.status(400).json({ error: { code: "PASSWORD_SETUP_FAILED", message: "Your password could not be added. Sign out and sign in with Google again, then retry. An existing password cannot be replaced here." } }); }
  });
}
