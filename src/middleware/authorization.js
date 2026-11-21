import { createLocalJWKSet, jwtVerify } from "jose";
import { fromNodeHeaders } from "better-auth/node";
import { config } from "../config.js";
import { publicUser, roles } from "../auth/policy.js";

export function createAuthorization({ auth, settings = config }) {
  async function verifyToken(req, res, next) {
    res.set("Cache-Control", "no-store");
    const header = req.headers.authorization ?? "";
    if (!/^Bearer [^\s]+$/.test(header)) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } });
    let active;
    let jwks;
    try {
      active = await auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableCookieCache: true } });
      if (!active) return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again." } });
      jwks = await auth.api.getJwks();
    } catch {
      return res.status(503).json({ error: { code: "AUTH_UNAVAILABLE", message: "Account services are temporarily unavailable. Please try again." } });
    }
    try {
      const { payload } = await jwtVerify(header.slice(7), createLocalJWKSet(jwks), {
        issuer: settings.authBaseUrl,
        audience: settings.clientOrigin,
        algorithms: ["EdDSA"],
        requiredClaims: ["sub", "sid", "exp"],
      });
      if (payload.sub !== active.user.id || payload.sid !== active.session.id) throw new Error("Session mismatch");
    } catch {
      return res.status(401).json({ error: { code: "INVALID_TOKEN", message: "Your access token has expired or is invalid. Please sign in again." } });
    }
    if (active.user.suspended || !roles.includes(active.user.role)) return res.status(403).json({ error: { code: "ACCOUNT_UNAVAILABLE", message: "This account cannot access the service." } });
    req.user = publicUser(active.user);
    req.authHeaders = fromNodeHeaders(req.headers);
    next();
  }

  function requireRole(role) {
    return (req, res, next) => {
      if (!req.user || req.user.role !== role) return res.status(403).json({ error: { code: "FORBIDDEN", message: "This page is not available for your account role." } });
      next();
    };
  }

  return { verifyToken, verifyRenter: requireRole("customer"), verifyOwner: requireRole("owner"), verifyAdmin: requireRole("admin") };
}
