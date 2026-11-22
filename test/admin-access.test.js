import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { createAuthentication } from "../src/auth/authentication.js";
import { createApp } from "../src/app.js";
test("all management endpoints require fresh Admin access while Owner analytics is scoped to the current Owner", async () => {
  const store = { user: [], session: [], account: [], verification: [], jwks: [], rateLimit: [] };
  const settings = { authBaseUrl: "http://127.0.0.1:3000/api/auth", clientOrigin: "http://127.0.0.1:3000", authSecret: "admin-access-test-secret".repeat(3) };
  const authentication = await createAuthentication({ adapter: memoryAdapter(store), settings });
  const calls = [];
  const administration = {
    users: async query => ({ items: [], ...query }), equipment: async () => ({ items: [] }), rentals: async () => ({ items: [] }),
    equipmentItem: async () => ({ item: {} }), changeUser: async (actor, id, input) => { calls.push({ actor, id, input }); return { saved: true }; },
    moderate: async () => ({ saved: true }), updateEquipment: async () => ({ saved: true }), deleteEquipment: async () => ({ removed: true }), manageRental: async () => ({ saved: true }),
  };
  const analytics = { summary: async id => { calls.push({ ownerId: id }); return { total: 0 }; } };
  const server = createServer(createApp({ authentication, administration, analytics, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "", token;
  async function call(path, body, method = body ? "PATCH" : "GET") {
    const response = await fetch(base + path, { method, headers: { Origin: settings.clientOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    return { status: response.status, body: await response.json() };
  }
  const paths = ["/admin/users", "/admin/equipment", "/admin/equipment/id", "/admin/rentals", "/admin/analytics"];
  try {
    for (const path of paths) assert.equal((await call(path)).status, 401);
    const signup = await call("/auth/sign-up/email", { name: "Admin Check", email: "admin-access@example.test", image: "https://example.test/photo.png", password: "Abc12345" }, "POST");
    token = (await call("/auth/token")).body.token;
    for (const path of paths) assert.equal((await call(path)).status, 403);
    assert.equal((await call("/admin/users/id", { role: "owner", suspended: false, version: 0 })).status, 403);
    const context = await authentication.auth.$context;
    await context.internalAdapter.updateUser(signup.body.user.id, { role: "owner" });
    assert.equal((await call("/owner/analytics")).status, 200);
    assert.equal(calls.at(-1).ownerId, signup.body.user.id);
    assert.equal((await call("/owner/analytics?ownerId=other")).status, 400);
    await context.internalAdapter.updateUser(signup.body.user.id, { role: "admin" });
    for (const path of paths) assert.equal((await call(path)).status, 200);
    assert.equal((await call("/admin/users?role=superuser")).status, 400);
    assert.equal((await call("/admin/users/id", { role: "owner", suspended: false, version: 0, actorId: "forged" })).status, 400);
    assert.equal((await call("/admin/users/id", { role: "owner", suspended: false, version: 0 })).status, 200);
    assert.equal(calls.at(-1).actor, signup.body.user.id);
    assert.equal((await call("/admin/rentals/id", { action: "note", version: 0, amountMinor: 1 })).status, 400);
    assert.equal((await call("/admin/equipment/id?version=-1", undefined, "DELETE")).status, 400);
    await context.internalAdapter.updateUser(signup.body.user.id, { suspended: true });
    for (const path of paths) assert.equal((await call(path)).status, 403);
    await context.internalAdapter.updateUser(signup.body.user.id, { suspended: false, role: "customer" });
    for (const path of paths) assert.equal((await call(path)).status, 403);
    assert.equal((await call("/health")).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
