import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { createAuthentication } from "../src/auth/authentication.js";
import { createApp } from "../src/app.js";

test("real Better Auth registration, JWT, fresh roles, profile and logout enforce permissions", async () => {
  const store = { user: [], session: [], account: [], verification: [], jwks: [], rateLimit: [] };
  const settings = { authBaseUrl: "http://127.0.0.1:3000/api/auth", clientOrigin: "http://127.0.0.1:3000", authSecret: "test-secret-".repeat(5), googleClientId: "", googleClientSecret: "" };
  const authentication = await createAuthentication({ adapter: memoryAdapter(store), settings });
  const server = createServer(createApp({ authentication, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = new Map();
  async function call(path, { body, token, method = body ? "POST" : "GET", cookie = true } = {}) {
    const response = await fetch(`${base}/api${path}`, { method, headers: {
      Origin: settings.clientOrigin,
      "X-Forwarded-For": "127.0.0.1",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie && jar.size ? { Cookie: [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(";")[0];
      const separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    return { status: response.status, body: payload };
  }
  try {
    const details = { name: "Test Customer", email: "phase3@example.com", image: "https://images.example/avatar.png", password: "Abc12345" };
    assert.equal((await call("/auth/sign-up/email", { body: { ...details, password: "weakpass" } })).status, 400);
    const registration = await call("/auth/sign-up/email", { body: details });
    assert.equal(registration.status, 200, JSON.stringify(registration.body));
    assert.equal(registration.body.user.role, "customer");
    assert.equal((await call("/profile")).status, 401);
    const issued = await call("/auth/token");
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    const token = issued.body.token;
    assert.equal((await call("/profile", { token })).status, 200);
    assert.equal((await call("/profile", { token, cookie: false })).status, 401);
    assert.equal((await call("/profile", { token: `${token.slice(0, -6)}abcdef` })).status, 401);
    assert.equal((await call("/dashboard/customer", { token })).status, 200);
    assert.equal((await call("/dashboard/owner", { token })).status, 403);
    assert.equal((await call("/dashboard/admin", { token })).status, 403);
    assert.equal((await call("/profile", { token, method: "PATCH", body: { role: "admin" } })).status, 400);
    const saved = await call("/profile", { token, method: "PATCH", body: { name: "Updated Name", phone: "01712345678", address: "Dhaka" } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.user.name, "Updated Name");
    assert.equal(saved.body.user.phone, "01712345678");
    const context = await authentication.auth.$context;
    await context.internalAdapter.updateUser(registration.body.user.id, { role: "owner" });
    assert.equal((await call("/dashboard/owner", { token })).status, 200);
    assert.equal((await call("/dashboard/customer", { token })).status, 403);
    await context.internalAdapter.updateUser(registration.body.user.id, { role: "admin" });
    assert.equal((await call("/dashboard/admin", { token })).status, 200);
    await context.internalAdapter.updateUser(registration.body.user.id, { suspended: true });
    assert.equal((await call("/profile", { token })).status, 403);
    await context.internalAdapter.updateUser(registration.body.user.id, { suspended: false });
    const oldCookies = new Map(jar);
    assert.equal((await call("/auth/sign-out", { body: {} })).status, 200);
    jar.clear();
    for (const [name, value] of oldCookies) jar.set(name, value);
    assert.equal((await call("/profile", { token })).status, 401);
    const login = await call("/auth/sign-in/email", { body: { email: details.email, password: details.password } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const freshToken = (await call("/auth/token")).body.token;
    assert.equal((await call("/profile", { token: freshToken })).status, 200);
    assert.equal((await call("/auth/request-password-reset", { body: { email: details.email } })).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
