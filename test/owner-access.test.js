import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { memoryAdapter } from "@better-auth/memory-adapter";
import { createAuthentication } from "../src/auth/authentication.js";
import { createApp } from "../src/app.js";

test("Owner HTTP endpoints require a live owner session and pass only current identity to mutations", async () => {
  const store = { user: [], session: [], account: [], verification: [], jwks: [], rateLimit: [] };
  const settings = { authBaseUrl: "http://127.0.0.1:3000/api/auth", clientOrigin: "http://127.0.0.1:3000", authSecret: "owner-test-secret".repeat(4) };
  const authentication = await createAuthentication({ adapter: memoryAdapter(store), settings });
  const calls = [];
  const owner = {
    list: async (id, query) => { calls.push(id); return { items: [], ...query }; },
    summary: async id => { calls.push(id); return { total: 0 }; },
    get: async id => { calls.push(id); return null; },
    create: async (user, input) => { calls.push(user.id); return { ...input, status: "pending", ownerId: user.id }; },
    update: async id => { calls.push(id); return { conflict: true }; },
    remove: async id => { calls.push(id); return { conflict: false }; },
  };
  const server = createServer(createApp({ authentication, owner, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = "", token;
  async function call(path, { body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, headers: { Origin: settings.clientOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    return { status: response.status, data: await response.json() };
  }
  try {
    assert.equal((await call("/owner/equipment")).status, 401);
    const signed = await call("/auth/sign-up/email", { body: { name: "Owner Test", email: "owner-access@example.test", image: "https://example.test/photo.png", password: "Abc12345" } });
    token = (await call("/auth/token")).data.token;
    assert.equal((await call("/owner/equipment")).status, 403);
    const context = await authentication.auth.$context;
    await context.internalAdapter.updateUser(signed.data.user.id, { role: "owner" });
    assert.equal((await call("/owner/equipment")).status, 200);
    assert.equal((await call("/owner/equipment?ownerId=other")).status, 400);
    const input = { name: "Camera", description: "Camera ready for photography projects", category: "Photography", location: "Dhaka", price: 100, rentalType: "Daily", quantity: 1, condition: "Good", brand: "Canon", model: "R6", image: "https://i.ibb.co/sample/photo.png", terms: ["Return clean"], included: [] };
    assert.equal((await call("/owner/equipment", { body: { ...input, status: "approved" } })).status, 400);
    const created = await call("/owner/equipment", { body: input });
    assert.equal(created.status, 201);
    assert.equal(created.data.item.ownerId, signed.data.user.id);
    assert.equal((await call("/owner/equipment/another-id")).status, 404);
    assert.equal((await call("/owner/equipment/another-id", { method: "PATCH", body: { ...input, version: 1 } })).status, 409);
    assert.equal((await call("/owner/equipment/another-id?version=1", { method: "DELETE" })).status, 404);
    assert.ok(calls.every(id => id === signed.data.user.id));
    await context.internalAdapter.updateUser(signed.data.user.id, { suspended: true });
    assert.equal((await call("/owner/summary")).status, 403);
    await context.internalAdapter.updateUser(signed.data.user.id, { suspended: false, role: "customer" });
    assert.equal((await call("/owner/equipment")).status, 403);
    assert.equal((await call("/health")).status, 200);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
