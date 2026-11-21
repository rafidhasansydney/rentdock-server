import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { startServer } from "../src/runtime.js";
import { closeDatabase } from "../src/database.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

const deadline = setTimeout(() => { console.error("Authentication verification timed out. Check Atlas access and the application's outgoing IP."); process.exit(1); }, 120000);
let runtime;
let accountId;
const email = `rentdock-check-${randomUUID()}@example.test`;
const password = `Ab${randomUUID()}`;
const jar = new Map();

try {
  runtime = await startServer({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const context = await runtime.authentication.auth.$context;
  async function call(path, { body, token, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method, signal: AbortSignal.timeout(20000),
      headers: {
        Origin: config.clientOrigin,
        "X-Forwarded-For": "127.0.0.1",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(jar.size ? { Cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    let result;
    try { result = JSON.parse(text); } catch { result = {}; }
    return { status: response.status, data: result };
  }

  const weak = await call("/auth/sign-up/email", { body: { name: "Connection Check", email, password: "weakpass", image: "https://images.example/avatar.png" } });
  assert.equal(weak.status, 400, "Weak password should be rejected");
  console.log("PASS server-side assignment password rules");
  const registration = await call("/auth/sign-up/email", { body: { name: "Connection Check", email, password, image: "https://images.example/avatar.png" } });
  assert.equal(registration.status, 200, `Registration failed: ${registration.data.code ?? registration.data.error?.code ?? registration.status}`);
  accountId = registration.data.user.id;
  assert.equal(registration.data.user.role, "customer");
  console.log("PASS Better Auth registration persisted in MongoDB; default Customer role");
  const session = await call("/auth/get-session");
  assert.equal(session.data.user.id, accountId);
  const tokenResult = await call("/auth/token");
  assert.equal(tokenResult.status, 200);
  const token = tokenResult.data.token;
  assert.equal((await call("/profile", { token })).status, 200);
  console.log("PASS session reload, signed JWT and protected profile");
  assert.equal((await call("/profile", { token: `${token.slice(0, -6)}abcdef` })).status, 401);
  assert.equal((await call("/dashboard/owner", { token })).status, 403);
  assert.equal((await call("/dashboard/admin", { token })).status, 403);
  assert.equal((await call("/profile", { token, method: "PATCH", body: { role: "admin" } })).status, 400);
  console.log("PASS invalid JWT and Customer role-escalation attempts rejected");
  const updated = await call("/profile", { token, method: "PATCH", body: { name: "Updated Connection Check", phone: "01712345678", address: "Dhaka" } });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.user.phone, "01712345678");
  await context.internalAdapter.updateUser(accountId, { role: "owner" });
  assert.equal((await call("/dashboard/owner", { token })).status, 200);
  assert.equal((await call("/dashboard/customer", { token })).status, 403);
  await context.internalAdapter.updateUser(accountId, { role: "admin" });
  assert.equal((await call("/dashboard/admin", { token })).status, 200);
  await context.internalAdapter.updateUser(accountId, { suspended: true });
  assert.equal((await call("/profile", { token })).status, 403);
  await context.internalAdapter.updateUser(accountId, { role: "customer", suspended: false });
  console.log("PASS profile persistence, current Owner/Admin permissions and suspension checks");
  const staleCookies = new Map(jar);
  assert.equal((await call("/auth/sign-out", { body: {} })).status, 200);
  jar.clear();
  for (const [name, value] of staleCookies) jar.set(name, value);
  assert.equal((await call("/profile", { token })).status, 401);
  const login = await call("/auth/sign-in/email", { body: { email, password } });
  assert.equal(login.status, 200);
  console.log("PASS logout revokes old session/JWT access; email login works");
  await context.internalAdapter.deleteUser(accountId);
  assert.equal(await context.internalAdapter.findUserById(accountId), null);
  accountId = undefined;
  console.log("PASS temporary verification account, sessions and credentials removed");
  console.log(runtime.authentication.googleEnabled ? "Google credentials are configured; browser OAuth consent/callback still requires a separate live test." : "Google OAuth credentials are not configured; Google sign-in remains pending.");
  console.log("Email authentication live verification passed.");
} catch (error) {
  const failure = describeDatabaseFailure(error);
  console.error(`Authentication verification failed: ${error.name === "AssertionError" ? error.message.split("\n")[0] : failure.codes.join(", ")}`);
  if (error.name !== "AssertionError") console.error(failure.hint);
  process.exitCode = 1;
} finally {
  try {
    if (runtime && accountId) {
      const context = await runtime.authentication.auth.$context;
      const user = await context.internalAdapter.findUserById(accountId);
      if (user?.email === email) await context.internalAdapter.deleteUser(accountId);
    }
    if (runtime) await runtime.stop();
    else await closeDatabase();
  } catch { console.error("Verification cleanup could not finish. Review only the temporary rentdock-check account."); process.exitCode = 1; }
  clearTimeout(deadline);
}
