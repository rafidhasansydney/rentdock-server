import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { createAuthentication } from "../src/auth/authentication.js";
import { createApp } from "../src/app.js";
test("initial Admin password setup is self-scoped, rejects existing credentials and permits subsequent email login", async () => {
  const store = { user: [], session: [], account: [], verification: [], jwks: [], rateLimit: [] };
  const settings = { authBaseUrl: "http://127.0.0.1:3000/api/auth", clientOrigin: "http://127.0.0.1:3000", authSecret: "password-setup-test".repeat(4) };
  const authentication = await createAuthentication({ adapter: memoryAdapter(store), settings });
  const server = createServer(createApp({ authentication, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "", token = "";
  async function call(path, body) {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { Origin: settings.clientOrigin, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    return { status: response.status, body: await response.json() };
  }
  try {
    assert.equal((await call("/profile/password")).status, 401);
    const signed = await call("/auth/sign-up/email", { name: "Temporary Password Check", email: "password-check@example.test", password: "Original123", image: "https://example.test/photo.png" });
    assert.equal(signed.status, 200);
    token = (await call("/auth/token")).body.token;
    assert.equal((await call("/profile/password")).status, 403);
    const context = await authentication.auth.$context;
    await context.internalAdapter.updateUser(signed.body.user.id, { role: "admin" });
    assert.deepEqual((await call("/profile/password")).body, { hasPassword: true });
    assert.equal((await call("/profile/password", { newPassword: "Replacement123" })).status, 409);
    const original = store.account[0].password;
    assert.equal((await call("/profile/password", { newPassword: "Replacement123", userId: "other-user" })).status, 400);
    assert.equal(store.account[0].password, original);
    store.account.splice(0);
    assert.deepEqual((await call("/profile/password")).body, { hasPassword: false });
    assert.equal((await call("/profile/password", { newPassword: "weakpassword" })).status, 400);
    assert.equal((await call("/profile/password", { newPassword: "NewAdmin123" })).status, 200);
    assert.equal(store.account.length, 1); assert.equal(store.account[0].providerId, "credential"); assert.notEqual(store.account[0].password, "NewAdmin123");
    assert.equal((await call("/profile/password", { newPassword: "Different123" })).status, 409);
    await call("/auth/sign-out", {}); token = ""; cookie = "";
    const login = await call("/auth/sign-in/email", { email: "password-check@example.test", password: "NewAdmin123" });
    assert.equal(login.status, 200); assert.equal(login.body.user.role, "admin");
    token = (await call("/auth/token")).body.token;
    assert.equal((await call("/dashboard/admin")).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
