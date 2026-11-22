import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { startServer } from "../src/runtime.js";
import { connectDatabase, closeDatabase } from "../src/database.js";
import { config } from "../src/config.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
import { dhakaToday, bookingError } from "../src/bookings/policy.js";

const run = randomUUID(), users = [], equipmentId = `booking-check-${run}`;
const provider = new Map(), signingSecret = `whsec_${run.replaceAll("-", "")}`;
const sdk = new Stripe("sk_test_verificationonly");
const gateway = {
  enabled: true, webhookEnabled: true,
  async create(attempt) {
    const id = `cs_test_${attempt._id.replaceAll("-", "")}`;
    if (!provider.has(id)) provider.set(id, { id, livemode: false, mode: "payment", currency: "bdt", amount_total: attempt.amountMinor, client_reference_id: attempt._id, metadata: { purpose: "rentdock-rental", attemptId: attempt._id, customerId: attempt.customerId, equipmentId: attempt.equipmentId }, status: "open", payment_status: "unpaid", url: `https://checkout.stripe.com/c/pay/${id}`, expires_at: Math.floor(attempt.expiresAt.getTime() / 1000) });
    return structuredClone(provider.get(id));
  },
  async retrieve(id) { return structuredClone(provider.get(id)); },
  async expire(id) { const value = provider.get(id); if (value.payment_status !== "paid") { value.status = "expired"; value.url = null; } return structuredClone(value); },
  event(raw, signature) { try { return sdk.webhooks.constructEvent(raw, signature, signingSecret); } catch { throw bookingError("Invalid payment notification signature."); } },
};
const controller = new AbortController();
const deadline = setTimeout(() => controller.abort(), 180000);
let runtime, database;
try {
  runtime = await startServer({ port: 0, host: "127.0.0.1", gateway });
  database = await connectDatabase();
  const context = await runtime.authentication.auth.$context;
  const base = `http://127.0.0.1:${runtime.server.address().port}/api`;
  async function call(path, { identity, body, method = body ? "POST" : "GET" } = {}) {
    const response = await fetch(base + path, { method, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), headers: { Origin: config.clientOrigin, "X-Forwarded-For": "127.0.0.1", ...(body ? { "Content-Type": "application/json" } : {}), ...(identity ? { Cookie: identity.cookie, ...(identity.token ? { Authorization: `Bearer ${identity.token}` } : {}) } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
  }
  for (let index = 0; index < 3; index++) {
    const email = `booking-check-${run}-${index}@example.test`;
    const signed = await call("/auth/sign-up/email", { body: { name: "Temporary Booking Check", email, image: "https://example.test/photo.png", password: `Ab${randomUUID()}` } });
    assert.equal(signed.status, 200);
    const identity = { id: signed.body.user.id, email, cookie: signed.cookie };
    users.push(identity);
    identity.token = (await call("/auth/token", { identity })).body.token;
    if (index === 0) await context.internalAdapter.updateUser(identity.id, { role: "owner" });
  }
  const [owner, first, second] = users;
  const record = { _id: equipmentId, name: "Temporary booking verification camera", description: "Temporary verification record", ownerId: owner.id, ownerName: "Temporary Owner", status: "approved", isSample: false, quantity: 2, availableQuantity: 2, activeRentalCount: 0, version: 1, price: 200, rentalType: "Daily", category: "Photography", location: "Dhaka", image: "https://i.ibb.co/verification/photo.png", included: [], terms: ["Verification only"], condition: "Good", brand: "Verification", model: "Temporary" };
  await database.collection("equipment").insertOne(record);
  const startDate = dhakaToday();
  const input = { equipmentId, startDate, endDate: startDate, quantity: 2 };
  assert.equal((await call("/booking/quote", { body: input })).status, 401);
  assert.equal((await call("/booking/quote", { identity: owner, body: input })).status, 403);
  const quote = await call("/booking/quote", { identity: first, body: input });
  assert.equal(quote.status, 200);
  assert.equal(quote.body.amountMinor, 40000);
  const booking = { ...input, contactNumber: "01712345678", deliveryAddress: "Verification address, Dhaka", notes: "Temporary check only", quoteVersion: quote.body.quoteVersion };
  assert.equal((await call("/booking/checkout", { identity: first, body: { ...booking, requestId: randomUUID(), amountMinor: 1 } })).status, 400);
  const requests = users.slice(1).map(() => randomUUID());
  const competing = await Promise.all([first, second].map((identity, index) => call("/booking/checkout", { identity, body: { ...booking, requestId: requests[index] } })));
  assert.deepEqual(competing.map(value => value.status).sort(), [200, 409]);
  const winnerIndex = competing.findIndex(value => value.status === 200);
  const winner = [first, second][winnerIndex], other = [second, first][winnerIndex];
  let attempt = competing[winnerIndex].body.attempt;
  assert.equal((await call(`/booking/checkouts/${attempt.id}`, { identity: other })).status, 404);
  assert.equal(await database.collection("bookings").countDocuments({ equipmentId }), 0);
  assert.equal((await database.collection("equipment").findOne({ _id: equipmentId })).activeRentalCount, 1);
  const retried = await call("/booking/checkout", { identity: winner, body: { ...booking, requestId: requests[winnerIndex] } });
  assert.equal(retried.body.attempt.id, attempt.id);
  assert.equal(await database.collection("checkoutAttempts").countDocuments({ equipmentId }), 1);
  console.log("PASS real MongoDB transactions prevent concurrent overselling; identity, trusted pricing and duplicate requests are checked");
  const cancelled = await call(`/booking/checkouts/${attempt.id}/cancel`, { identity: winner, method: "POST" });
  assert.equal(cancelled.body.attempt.state, "expired");
  assert.equal((await database.collection("equipment").findOne({ _id: equipmentId })).activeRentalCount, 0);
  const resumed = await call("/booking/checkout", { identity: winner, body: { ...booking, requestId: randomUUID() } });
  assert.equal(resumed.status, 200);
  attempt = resumed.body.attempt;
  const stored = await database.collection("checkoutAttempts").findOne({ _id: attempt.id });
  const session = provider.get(stored.sessionId);
  session.status = "complete"; session.payment_status = "paid";
  session.payment_intent = { id: `pi_${attempt.id.replaceAll("-", "")}`, status: "succeeded", livemode: false, currency: "bdt", amount_received: stored.amountMinor };
  session.amount_total++;
  assert.equal((await call(`/booking/checkouts/${attempt.id}`, { identity: winner })).status, 409);
  assert.equal(await database.collection("payments").countDocuments({ ownerId: owner.id }), 0);
  session.amount_total--;
  const event = JSON.stringify({ id: `evt_${run.replaceAll("-", "")}`, type: "checkout.session.completed", livemode: false, data: { object: session } });
  const signature = sdk.webhooks.generateTestHeaderString({ payload: event, secret: signingSecret });
  const webhook = () => fetch(`${base}/payments/webhook`, { method: "POST", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body: event });
  const finalized = await Promise.all([webhook(), webhook(), call(`/booking/checkouts/${attempt.id}`, { identity: winner })]);
  assert.ok(finalized.every(value => value.status === 200));
  assert.equal(await database.collection("bookings").countDocuments({ equipmentId }), 1);
  assert.equal(await database.collection("payments").countDocuments({ ownerId: owner.id }), 1);
  const paidCancel = await call(`/booking/checkouts/${attempt.id}/cancel`, { identity: winner, method: "POST" });
  assert.equal(paidCancel.body.attempt.state, "paid");
  assert.equal((await call("/rentals", { identity: winner })).body.total, 1);
  assert.equal((await call("/rentals", { identity: other })).body.total, 0);
  assert.equal((await call("/owner/rentals", { identity: owner })).body.total, 1);
  console.log("PASS cancellation verifies expiry; paid results and duplicate signed webhook/return requests create one booking and one payment");
  const yesterday = new Date(Date.parse(startDate + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  await database.collection("checkoutAttempts").updateOne({ _id: attempt.id }, { $set: { endDate: yesterday } });
  await database.collection("bookings").updateOne({ _id: attempt.id }, { $set: { endDate: yesterday } });
  const completed = await call("/rentals", { identity: winner });
  assert.equal(completed.body.items[0].bookingStatus, "completed");
  assert.equal((await database.collection("equipment").findOne({ _id: equipmentId })).activeRentalCount, 0);
  console.log("PASS paid rental completion releases the Owner mutation guard; current-user rental tables remain isolated");
  console.log("Payment responses in this database check are controlled fixtures. Real Stripe payment and live webhook forwarding require the separate browser test.");
} catch (error) {
  console.error("Booking verification failed.", error.code || error.name || "Error");
  console.error(error.name === "AssertionError" ? `Expected ${JSON.stringify(error.expected)}; received ${JSON.stringify(error.actual)}.` : describeDatabaseFailure(error));
  process.exitCode = 1;
} finally {
  try {
    if (database) {
      const ids = users.map(user => user.id);
      await database.collection("payments").deleteMany({ ownerId: { $in: ids } });
      await database.collection("bookings").deleteMany({ equipmentId });
      await database.collection("checkoutAttempts").deleteMany({ equipmentId });
      await database.collection("equipment").deleteOne({ _id: equipmentId });
      await database.collection("bookingLocks").deleteMany({ _id: { $in: ids } });
    }
    if (runtime) {
      const context = await runtime.authentication.auth.$context;
      for (const user of users) { const stored = await context.internalAdapter.findUserById(user.id); if (stored?.email === user.email) await context.internalAdapter.deleteUser(user.id); }
    }
    if (!process.exitCode) console.log("PASS temporary booking/payment records, equipment and accounts removed");
  } catch { console.error("Temporary booking verification cleanup needs review."); process.exitCode = 1; }
  await runtime?.stop(); await closeDatabase(); clearTimeout(deadline);
}
if (!process.exitCode) console.log("Booking database verification passed.");
