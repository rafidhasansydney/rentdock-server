import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/runtime.js";
import { connectDatabase, closeDatabase } from "../src/database.js";
import { config } from "../src/config.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

const run = randomUUID();
const users = [];
let runtime, database;
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 120000);
try {
  runtime = await startServer({ port: 0, host: "127.0.0.1" });
  database = await connectDatabase();
  const base = `http://127.0.0.1:${runtime.server.address().port}/api`;
  const context = await runtime.authentication.auth.$context;
  async function call(path, { identity, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]), headers: { Origin: config.clientOrigin, ...(body ? { "Content-Type": "application/json" } : {}), ...(identity ? { Cookie: identity.cookie, ...(identity.token ? { Authorization: `Bearer ${identity.token}` } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  }
  for (let index = 0; index < 3; index++) {
    const email = `owner-check-${run}-${index}@example.test`;
    const result = await call("/auth/sign-up/email", { body: { name: "Temporary Owner Check", email, image: "https://example.test/photo.png", password: `Ab${randomUUID()}` } });
    assert.equal(result.status, 200);
    const identity = { id: result.body.user.id, email, cookie: result.cookie };
    users.push(identity);
    identity.token = (await call("/auth/token", { identity })).body.token;
    if (index < 2) await context.internalAdapter.updateUser(identity.id, { role: "owner" });
  }
  const [first, second, customer] = users;
  const input = { name: `Owner check ${run}`, description: "Temporary verification equipment, removed after this check.", category: "Photography", location: "Dhaka", price: 1200, rentalType: "Daily", quantity: 2, condition: "Good", brand: "Verification", model: "Temporary", image: "https://i.ibb.co/verification-placeholder/photo.png", terms: ["Verification only"], included: [] };
  assert.equal((await call("/owner/equipment")).status, 401);
  assert.equal((await call("/owner/equipment", { identity: customer })).status, 403);
  assert.equal((await call("/owner/equipment", { identity: first, body: { ...input, ownerId: second.id, status: "approved" } })).status, 400);
  const created = await call("/owner/equipment", { identity: first, body: input });
  assert.equal(created.status, 201);
  const item = created.body.item;
  assert.equal(item.status, "pending");
  assert.equal(item.ownerId, first.id);
  assert.equal(item.availableQuantity, 2);
  assert.ok(!Object.hasOwn(item, "ownerEmail"));
  const path = `/owner/equipment/${item.id}`;
  assert.equal((await call(path, { identity: first })).status, 200);
  assert.equal((await call(path, { identity: second })).status, 404);
  assert.equal((await call(path, { identity: second, method: "PATCH", body: { ...input, version: 1 } })).status, 404);
  assert.equal((await call(`${path}?version=1`, { identity: second, method: "DELETE" })).status, 404);
  assert.equal((await call(`/equipment/${item.id}`, { identity: customer })).status, 404);
  const listed = await call("/owner/equipment?page=1&status=pending", { identity: first });
  assert.ok(listed.body.items.some(value => value.id === item.id));
  assert.equal((await call("/owner/equipment", { identity: second })).body.total, 0);
  console.log("PASS Mongo-backed Owner creation, Pending approval, private preview, filters and cross-owner isolation");
  await database.collection("equipment").updateOne({ _id: item.id, ownerId: first.id }, { $set: { status: "approved" } });
  const update = await call(path, { identity: first, method: "PATCH", body: { ...input, price: 1500, version: 1 } });
  assert.equal(update.status, 200);
  assert.equal(update.body.item.status, "pending");
  assert.equal(update.body.item.version, 2);
  assert.equal((await call(path, { identity: first, method: "PATCH", body: { ...input, version: 1 } })).status, 409);
  assert.equal((await call(`${path}?version=1`, { identity: first, method: "DELETE" })).status, 409);
  await database.collection("equipment").updateOne({ _id: item.id, ownerId: first.id }, { $set: { activeRentalCount: 1 } });
  assert.equal((await call(path, { identity: first, method: "PATCH", body: { ...input, version: 2 } })).status, 409);
  assert.equal((await call(`${path}?version=2`, { identity: first, method: "DELETE" })).status, 409);
  await database.collection("equipment").updateOne({ _id: item.id, ownerId: first.id }, { $set: { activeRentalCount: 0 } });
  assert.equal((await call(`${path}?version=2`, { identity: first, method: "DELETE" })).status, 200);
  assert.equal((await call(path, { identity: first })).status, 404);
  assert.equal((await call("/owner/summary", { identity: first })).body.total, 0);
  assert.equal((await database.collection("equipment").findOne({ _id: item.id })).status, "deleted");
  console.log("PASS edits return to Pending, stale versions and active rentals block mutations, deletion retains hidden history");
  console.log("This checks listing data with a placeholder URL. It does not test imgbb; images:check verifies the provider separately.");
} catch (error) {
  console.error("Owner verification failed.", error.code || error.name || "Error");
  console.error(error.name === "AssertionError" ? "An Owner expectation did not match. Share this output for investigation." : describeDatabaseFailure(error));
  process.exitCode = 1;
} finally {
  try {
    if (database && users.length) await database.collection("equipment").deleteMany({ ownerId: { $in: users.map(user => user.id) }, name: `Owner check ${run}` });
    if (runtime) {
      const context = await runtime.authentication.auth.$context;
      for (const user of users) {
        const stored = await context.internalAdapter.findUserById(user.id);
        if (stored?.email === user.email) await context.internalAdapter.deleteUser(user.id);
      }
    }
    if (!process.exitCode) console.log("PASS temporary Owner/Customer accounts and equipment removed");
  } catch { console.error("Temporary verification cleanup needs review."); process.exitCode = 1; }
  await runtime?.stop();
  await closeDatabase();
  clearTimeout(deadline);
}
if (!process.exitCode) console.log("Owner listings live verification passed.");
