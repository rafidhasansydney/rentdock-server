import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/runtime.js";
import { databaseService } from "../src/database.js";
import { config } from "../src/config.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
import { databaseUserId } from "../src/auth/storage.js";
import { analyticsMonths, createAnalyticsRepository } from "../src/admin/analytics.js";
import { createBookingRepository } from "../src/bookings/repository.js";
import { dhakaToday } from "../src/bookings/policy.js";

const run = randomUUID(), users = [], rentalIds = [randomUUID(), randomUUID()];
let runtime, database, equipmentId, stage = "startup";
const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 180000);
try {
  runtime = await startServer({ port: 0, host: "127.0.0.1" });
  database = await databaseService.connect();
  const context = await runtime.authentication.auth.$context;
  const base = `http://127.0.0.1:${runtime.server.address().port}/api`;
  async function call(path, { identity, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]), headers: { Origin: config.clientOrigin, ...(body ? { "Content-Type": "application/json" } : {}), ...(identity ? { Cookie: identity.cookie, Authorization: `Bearer ${identity.token || ""}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  }
  async function login(identity) {
    const signed = await call("/auth/sign-in/email", { body: { email: identity.email, password: identity.password } });
    assert.equal(signed.status, 200, "temporary account login"); identity.cookie = signed.cookie;
    identity.token = (await call("/auth/token", { identity })).body.token;
  }
  async function expect(path, identity, status, body, method = body ? "PATCH" : "GET") {
    const result = await call(path, { identity, body, method });
    assert.equal(result.status, status, `${stage}: ${method} ${path.split("?")[0]}`);
    return result.body;
  }
  stage = "temporary accounts";
  for (let index = 0; index < 4; index++) {
    const identity = { email: `admin-check-${run}-${index}@example.test`, password: `Ab${randomUUID()}` };
    const signed = await call("/auth/sign-up/email", { body: { name: `Temporary Management ${index}`, email: identity.email, password: identity.password, image: "https://example.test/photo.png" } });
    assert.equal(signed.status, 200, "temporary registration"); identity.id = signed.body.user.id; identity.cookie = signed.cookie; users.push(identity);
    identity.token = (await call("/auth/token", { identity })).body.token;
    if (index < 3) await context.internalAdapter.updateUser(identity.id, { role: index < 2 ? "admin" : "owner" });
  }
  const [admin, otherAdmin, owner, customer] = users;
  const target = `/admin/users/${customer.id}`;
  stage = "role management";
  await expect("/admin/users", undefined, 401);
  await expect("/admin/users", customer, 403);
  const found = await expect(`/admin/users?q=${encodeURIComponent(customer.email)}`, admin, 200);
  assert.equal(found.items.length, 1);
  for (const key of ["password", "phone", "address", "accessToken"]) assert.equal(Object.hasOwn(found.items[0], key), false);
  await expect(`/admin/users/${admin.id}`, admin, 409, { role: "customer", suspended: false, version: 0 });
  await expect(target, admin, 200, { role: "owner", suspended: false, version: 0 });
  await expect("/owner/analytics", customer, 401);
  await login(customer);
  await expect("/owner/analytics", customer, 200);
  await expect(target, admin, 409, { role: "customer", suspended: false, version: 0 });
  await expect(target, admin, 200, { role: "customer", suspended: true, version: 1 });
  await expect("/owner/analytics", customer, 401);
  await expect(target, admin, 200, { role: "customer", suspended: false, version: 2 });
  await login(customer);
  console.log("PASS current Admin authorization, user search, optimistic changes and session revocation on role/suspension updates");

  stage = "equipment moderation";
  const input = { name: `Management check ${run}`, description: "Temporary equipment used only for isolated management verification.", category: "Photography", location: "Dhaka", price: 200, rentalType: "Daily", quantity: 2, condition: "Good", brand: "Verification", model: "Temporary", image: "https://i.ibb.co/verification-placeholder/photo.png", terms: ["Verification only"], included: [] };
  let item = (await expect("/owner/equipment", owner, 201, input, "POST")).item; equipmentId = item.id;
  const path = `/admin/equipment/${equipmentId}`, review = `${path}/review`;
  await expect(`/admin/users/${owner.id}`, admin, 409, { role: "customer", suspended: false, version: 0 });
  await expect(review, admin, 400, { status: "rejected", reason: "No", version: 1 });
  item = (await expect(review, admin, 200, { status: "approved", version: 1 })).item;
  await expect(`/equipment/${equipmentId}`, customer, 200);
  assert.equal((await expect(`/owner/equipment/${equipmentId}`, owner, 200, { ...input, version: item.version }, "PATCH")).item.status, "pending");
  await expect(`/equipment/${equipmentId}`, customer, 404);
  item = (await expect(review, admin, 200, { status: "rejected", reason: "Please improve the rental description.", version: 3 })).item;
  assert.equal(item.rejectionReason, "Please improve the rental description.");
  item = (await expect(review, admin, 200, { status: "approved", version: 4 })).item;
  item = (await expect(path, admin, 200, { ...input, price: 250, version: item.version })).item;
  assert.equal(item.status, "approved"); assert.equal(item.ownerId, owner.id);
  await expect(review, admin, 409, { status: "rejected", reason: "Stale review", version: 1 });
  await database.collection("equipment").updateOne({ _id: equipmentId }, { $set: { activeRentalCount: 1 } });
  await expect(`${path}?version=${item.version}`, admin, 409, undefined, "DELETE");
  await expect(path, admin, 409, { ...input, version: item.version });
  await database.collection("equipment").updateOne({ _id: equipmentId }, { $set: { activeRentalCount: 0 } });
  await expect(`/admin/users/${owner.id}`, admin, 200, { role: "owner", suspended: true, version: 0 });
  await expect("/booking/quote", customer, 409, { equipmentId, startDate: dhakaToday(), endDate: dhakaToday(), quantity: 1 }, "POST");
  await expect(`/admin/users/${owner.id}`, admin, 200, { role: "owner", suspended: false, version: 1 }); await login(owner);
  console.log("PASS Owner submissions, approval/rejection visibility, stale reviews, preserved ownership and active-rental edit/delete guards");

  stage = "rental management and analytics";
  const today = dhakaToday(), yesterday = dhakaToday(new Date(Date.now() - 86400000)), now = new Date();
  const months = analyticsMonths(now), boundary = new Date(`${months[0]}-01T00:00:00+06:00`);
  const before = await createAnalyticsRepository(databaseService).summary();
  const rows = rentalIds.map((id, index) => ({ _id: id, equipmentId, equipmentName: input.name, customerId: customer.id, customerName: "Temporary Customer", customerEmail: customer.email, ownerId: owner.id, ownerName: "Temporary Owner", startDate: index ? today : yesterday, endDate: index ? today : yesterday, quantity: 1, amountMinor: 12345, currency: "bdt", bookingStatus: "confirmed", paymentStatus: "paid", contactNumber: "01712345678", deliveryAddress: "Temporary address", notes: "Verification only", transactionId: `pi_verify_${id}`, createdAt: index ? now : boundary }));
  await database.collection("bookings").insertMany(rows);
  await database.collection("payments").insertMany(rows.map(row => ({ _id: `cs_verify_${row._id}`, bookingId: row._id, customerId: customer.id, ownerId: owner.id, paymentIntentId: row.transactionId, amountMinor: 12345, currency: "bdt", status: "paid", createdAt: row.createdAt })));
  await database.collection("checkoutAttempts").insertMany(rows.map(row => ({ _id: row._id, requestId: row._id, customerId: customer.id, equipmentId, state: "paid", endDate: row.endDate })));
  await database.collection("equipment").updateOne({ _id: equipmentId }, { $set: { activeRentalCount: 2 } });
  const savedPayment = await database.collection("payments").findOne({ bookingId: rentalIds[0] });
  await expect(`/admin/rentals/${rentalIds[1]}`, admin, 409, { action: "complete", version: 0 });
  await expect(`/admin/rentals/${rentalIds[1]}`, admin, 200, { action: "start", note: "Internal handover note", version: 0 });
  await expect(`/admin/rentals/${rentalIds[1]}`, admin, 409, { action: "note", version: 0 });
  await expect(`/admin/rentals/${rentalIds[0]}`, admin, 200, { action: "complete", note: "Returned", version: 0 });
  await expect(`/admin/rentals/${rentalIds[0]}`, admin, 409, { action: "complete", version: 1 });
  assert.equal((await database.collection("equipment").findOne({ _id: equipmentId })).activeRentalCount, 1);
  assert.deepEqual(await database.collection("payments").findOne({ bookingId: rentalIds[0] }), savedPayment);
  const privateRental = await createBookingRepository(databaseService).rental(rentalIds[1], customer.id);
  assert.equal(Object.hasOwn(privateRental, "adminNote"), false);
  const global = await expect("/admin/analytics", admin, 200), own = await expect("/owner/analytics", owner, 200);
  assert.equal(global.revenueMinor, before.revenueMinor + 24690); assert.equal(own.revenueMinor, 24690);
  assert.equal(own.bookings, 2); assert.equal(own.completedRentals, 1); assert.equal(own.monthly.length, 6);
  assert.equal(own.monthly[0].revenueMinor, 12345); assert.equal(own.monthly.at(-1).revenueMinor, 12345);
  const rentals = await expect(`/admin/rentals?q=${encodeURIComponent(input.name)}`, admin, 200);
  assert.equal(rentals.items.length, 2); assert.equal(rentals.items[0].ownerEmail, owner.email);
  assert.equal(rentals.items.some(row => row.adminNote === "Internal handover note"), true);
  await expect(`/owner/analytics?ownerId=${admin.id}`, owner, 400);
  console.log("PASS paid rental handover/completion, one-time inventory release, private Admin notes and unchanged payment proof");
  console.log("PASS database-backed global/Owner analytics, isolated earnings and six Bangladesh-time monthly buckets");

  stage = "role and mutation serialization";
  const holdId = randomUUID();
  await database.collection("checkoutAttempts").insertOne({ _id: holdId, requestId: holdId, customerId: customer.id, state: "open" });
  try { await expect(target, admin, 409, { role: "owner", suspended: false, version: 3 }); }
  finally { await database.collection("checkoutAttempts").deleteOne({ _id: holdId, customerId: customer.id }); }
  const changes = await Promise.all([call(`/admin/users/${otherAdmin.id}`, { identity: admin, method: "PATCH", body: { role: "customer", suspended: false, version: 0 } }), call(`/admin/users/${admin.id}`, { identity: otherAdmin, method: "PATCH", body: { role: "customer", suspended: false, version: 0 } })]);
  assert.equal(changes.filter(result => result.status === 200).length, 1);
  assert.ok(changes.every(result => [200, 401, 403].includes(result.status)));
  console.log("PASS open-checkout role guard and concurrent Admin changes cannot both revoke each other's access");
  console.log("Rental/payment rows in this check are isolated database fixtures; it makes no Stripe charge and does not test imgbb.");
} catch (error) {
  console.error(`Administration verification failed at ${stage}.`);
  console.error(error.name === "AssertionError" ? error.message : describeDatabaseFailure(error).hint);
  process.exitCode = 1;
} finally {
  try {
    if (database) {
      if (equipmentId) await database.collection("equipment").deleteMany({ _id: equipmentId, ownerId: { $in: users.map(user => user.id) } });
      for (const name of ["bookings", "checkoutAttempts"]) await database.collection(name).deleteMany({ _id: { $in: rentalIds } });
      await database.collection("payments").deleteMany({ bookingId: { $in: rentalIds } });
      await database.collection("adminAudit").deleteMany({ actorId: { $in: users.map(user => user.id) } });
      for (const user of users) {
        const stored = await database.collection("user").findOne({ _id: databaseUserId(user.id), email: user.email });
        if (stored) await (await runtime.authentication.auth.$context).internalAdapter.deleteUser(user.id);
      }
      console.log("PASS temporary management accounts, listings, rentals, payments and audit records removed");
    }
  } catch { console.error("Temporary management verification cleanup needs review."); process.exitCode = 1; }
  await runtime?.stop(); await databaseService.close(); clearTimeout(deadline);
}
if (!process.exitCode) console.log("Administration and analytics live verification passed.");
