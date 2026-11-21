import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/runtime.js";
import { connectDatabase, closeDatabase } from "../src/database.js";
import { config } from "../src/config.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

const run = randomUUID();
const prefix = `catalog-check-${run}`;
const users = [];
let runtime;
let database;
const deadline = setTimeout(() => { console.error("Catalog verification timed out. Check Atlas access and the Node process's outgoing IP."); process.exit(1); }, 120000);

try {
  runtime = await startServer({ port: 0, host: "127.0.0.1" });
  database = await connectDatabase();
  const base = `http://127.0.0.1:${runtime.server.address().port}/api`;
  const context = await runtime.authentication.auth.$context;
  async function call(path, { identity, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(20000), headers: {
      Origin: config.clientOrigin, "X-Forwarded-For": "127.0.0.1",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(identity?.cookie ? { Cookie: identity.cookie } : {}),
      ...(identity?.token ? { Authorization: `Bearer ${identity.token}` } : {}),
    }, body: body ? JSON.stringify(body) : undefined });
    const payload = await response.json();
    return { status: response.status, payload, cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  }
  const records = [100, 300, 600, 50].map((price, index) => ({ _id: `${prefix}-${index}`, name: `${prefix} equipment ${index}`, category: "Photography", location: "Dhaka", rentalType: "Daily", price, quantity: 2, availableQuantity: index === 2 ? 0 : 2, status: index === 3 ? "pending" : "approved", image: "/images/camera.png", imageAlt: "Verification camera", description: "Temporary verification record", ownerName: "Verification collection", ownerId: null, condition: "Good", included: ["Camera"], terms: ["Return in good condition"], createdAt: new Date(), verificationRun: run, isSample: true }));
  await database.collection("equipment").insertMany(records);
  const list = await call(`/equipment?q=${prefix}&minPrice=90&maxPrice=400&sort=price-desc`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.payload.items.map(item => item.price), [300, 100]);
  assert.ok(list.payload.items.every(item => !Object.hasOwn(item, "ownerId") && !Object.hasOwn(item, "terms")));
  const available = await call(`/equipment?q=${prefix}&availability=available`);
  assert.equal(available.payload.total, 2);
  const page = await call(`/equipment?q=${prefix}&limit=1&page=2&sort=price-asc`);
  assert.equal(page.payload.items[0].price, 300);
  assert.equal(page.payload.total, 3);
  assert.equal((await call("/equipment?status=pending")).status, 400);
  assert.equal((await call(`/equipment/${records[0]._id}`)).status, 401);
  console.log("PASS Mongo-backed public search, price range, sorting, availability, pagination and private details protection");
  const highlights = await call("/equipment-highlights");
  assert.ok(highlights.payload.featured.length <= 6);
  assert.ok(highlights.payload.recent.length <= 2);
  for (const item of [...highlights.payload.featured, ...highlights.payload.recent]) assert.ok(await database.collection("equipment").findOne({ _id: item.id, status: "approved" }));
  console.log("PASS homepage queries return only approved records with bounded featured/recent results");
  for (let index = 0; index < 2; index++) {
    const email = `${prefix}-${index}@example.test`;
    const signed = await call("/auth/sign-up/email", { body: { name: "Catalog Verification", email, image: "https://example.com/avatar.png", password: `Ab${randomUUID()}` } });
    assert.equal(signed.status, 200);
    users.push({ id: signed.payload.user.id, email, cookie: signed.cookie });
    const issued = await call("/auth/token", { identity: users[index] });
    assert.equal(issued.status, 200);
    users[index].token = issued.payload.token;
  }
  const [first, second] = users;
  assert.equal((await call(`/equipment/${records[0]._id}`, { identity: first })).status, 200);
  assert.equal((await call(`/equipment/${records[3]._id}`, { identity: first })).status, 404);
  for (const index of [0, 0, 1]) assert.equal((await call(`/favorites/${records[index]._id}`, { identity: first, method: "PUT", body: { userId: second.id } })).status, 200);
  assert.equal(await database.collection("favorites").countDocuments({ userId: first.id }), 2);
  assert.equal((await call(`/favorites/${records[0]._id}`, { identity: second, method: "DELETE" })).status, 200);
  assert.equal((await call("/favorites", { identity: first })).payload.total, 2);
  assert.equal((await call("/favorites", { identity: second })).payload.total, 0);
  assert.equal((await call(`/favorites/${records[3]._id}`, { identity: second, method: "PUT" })).status, 404);
  await context.internalAdapter.updateUser(second.id, { role: "owner" });
  assert.equal((await call(`/favorites/${records[0]._id}`, { identity: second, method: "PUT" })).status, 403);
  await database.collection("equipment").updateOne({ _id: records[1]._id, verificationRun: run }, { $set: { status: "rejected" } });
  assert.equal((await call("/favorites", { identity: first })).payload.total, 1);
  assert.equal((await call(`/favorites/${records[0]._id}`, { identity: first, method: "DELETE" })).status, 200);
  assert.equal((await call("/favorites", { identity: first })).payload.total, 0);
  console.log("PASS persisted favorites are idempotent, isolated by current user and role, and hide unapproved equipment");
} catch (error) {
  console.error("Catalog verification failed.", error.code || error.name || "Error");
  if (error.name === "AssertionError") console.error("A catalog expectation did not match. Share this output for investigation.");
  else console.error(describeDatabaseFailure(error));
  process.exitCode = 1;
} finally {
  try {
    if (database) {
      await database.collection("favorites").deleteMany({ userId: { $in: users.map(user => user.id) } });
      await database.collection("equipment").deleteMany({ verificationRun: run, _id: { $regex: `^${prefix}-` } });
    }
    if (runtime) {
      const context = await runtime.authentication.auth.$context;
      for (const user of users) {
        const stored = await context.internalAdapter.findUserById(user.id);
        if (stored?.email === user.email) await context.internalAdapter.deleteUser(user.id);
      }
    }
    if (!process.exitCode) console.log("PASS temporary verification equipment, favorites and accounts removed");
  } catch { console.error("Temporary verification cleanup needs review."); process.exitCode = 1; }
  await runtime?.stop();
  await closeDatabase();
  clearTimeout(deadline);
}
if (!process.exitCode) console.log("Equipment discovery live verification passed.");
