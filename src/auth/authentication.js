import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { jwt } from "better-auth/plugins";
import { config } from "../config.js";
import { passwordError, profileError } from "./policy.js";

export async function createAuthentication({ database, client, settings = config, adapter }) {
  if (!settings.authSecret) throw new Error("Configure BETTER_AUTH_SECRET before starting authentication.");
  const googleEnabled = Boolean(settings.googleClientId && settings.googleClientSecret);
  const auth = betterAuth({
    appName: "RentDock",
    baseURL: settings.authBaseUrl,
    basePath: "/api/auth",
    secret: settings.authSecret,
    database: adapter ?? mongodbAdapter(database, { ...(client ? { client } : {}) }),
    trustedOrigins: [settings.clientOrigin],
    emailAndPassword: { enabled: true, minPasswordLength: 6, maxPasswordLength: 128, requireEmailVerification: false, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    socialProviders: googleEnabled ? { google: { clientId: settings.googleClientId, clientSecret: settings.googleClientSecret } } : {},
    user: {
      additionalFields: {
        role: { type: ["customer", "owner", "admin"], required: false, defaultValue: "customer", input: false },
        suspended: { type: "boolean", required: false, defaultValue: false, input: false },
        phone: { type: "string", required: false, defaultValue: "" },
        address: { type: "string", required: false, defaultValue: "" },
      },
    },
    disabledPaths: ["/request-password-reset", "/reset-password", "/send-verification-email", "/verify-email", "/change-email"],
    databaseHooks: {
      user: { create: { before: async user => ({ data: { ...user, role: "customer", suspended: false } }) } },
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (context.path === "/sign-up/email") {
          const issue = passwordError(context.body?.password) || profileError(context.body, { registration: true });
          if (issue) throw new APIError("BAD_REQUEST", { message: issue });
          context.body.name = context.body.name.trim();
        }
        if (context.path === "/update-user") {
          const issue = profileError(context.body);
          if (issue) throw new APIError("BAD_REQUEST", { message: issue });
        }
      }),
    },
    plugins: [jwt({
      disableSettingJwtHeader: true,
      jwt: {
        issuer: settings.authBaseUrl,
        audience: settings.clientOrigin,
        expirationTime: "5m",
        definePayload: ({ user, session }) => ({ sub: user.id, sid: session.id }),
      },
    })],
    advanced: { cookiePrefix: "rentdock", useSecureCookies: settings.clientOrigin.startsWith("https:") },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60, customRules: { "/sign-in/email": { window: 60, max: 10 }, "/sign-up/email": { window: 60, max: 5 } } },
  });
  await auth.$context;
  return { auth, googleEnabled, settings };
}
