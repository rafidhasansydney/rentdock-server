import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBookingService } from "../src/bookings/service.js";
import { createRentalStripe } from "../src/bookings/stripe.js";
import { dhakaToday } from "../src/bookings/policy.js";

function fixture(failures) {
  const today = dhakaToday();
  const input = { equipmentId: "camera", startDate: today, endDate: today, quantity: 1, contactNumber: "01712345678", deliveryAddress: "Test address, Dhaka", notes: "", quoteVersion: 1, requestId: randomUUID() };
  const attempt = { _id: "attempt", ...input, customerId: "customer", amountMinor: 20000, state: "creating", creationCount: 0 };
  const releases = [], clears = [];
  const repository = { completeDue: async () => {}, due: async () => [], reserve: async () => ({ ...attempt }), claimCreation: async () => { attempt.creationCount++; attempt.creationLeaseToken = "lease"; return { ...attempt }; }, clearCreationLease: async (...args) => { clears.push(args); }, release: async (...args) => { releases.push(args); attempt.state = "expired"; } };
  const gateway = { enabled: true, webhookEnabled: true, create: async () => { throw failures.shift(); } };
  return { service: createBookingService({ repository, gateway }), input, attempt, releases, clears };
}
test("definitive first creation failure compensates only its own leased reservation", async () => {
  const value = fixture([Object.assign(new Error("Provider rejected"), { definitive: true })]);
  await assert.rejects(value.service.checkout({ id: "customer" }, value.input));
  assert.deepEqual(value.releases, [["attempt", "lease"]]);
  assert.equal(value.attempt.state, "expired");
});
test("ambiguous provider failure and failed retries keep inventory reserved for safe reconciliation", async () => {
  const value = fixture([new Error("Network timed out after submission"), Object.assign(new Error("Key rejected on retry"), { definitive: true })]);
  for (let i = 0; i < 2; i++) await assert.rejects(value.service.checkout({ id: "customer" }, value.input));
  assert.equal(value.releases.length, 0);
  assert.equal(value.clears.length, 2);
  assert.equal(value.attempt.state, "creating");
});
test("Checkout creation uses persisted amount, fixed redirect origin and a stable idempotency key", async () => {
  let captured;
  const sdk = { checkout: { sessions: { create: async (body, options) => { captured = { body, options }; return { url: "https://checkout.stripe.com/c/pay/cs_test_example" }; } } } };
  const gateway = createRentalStripe({ stripeSecretKey: "sk_test_testingonly", clientOrigin: "https://rentdock.example" }, sdk);
  await gateway.create({ _id: "attempt", amountMinor: 20000, equipmentName: "Camera", equipmentId: "camera", customerId: "customer", startDate: "2026-11-23", endDate: "2026-11-23", quantity: 1, periods: 1, rentalType: "Daily", expiresAt: new Date(Date.now() + 35 * 60000) });
  assert.equal(captured.body.line_items[0].price_data.unit_amount, 20000);
  assert.equal(captured.body.line_items[0].price_data.currency, "bdt");
  assert.equal(captured.options.idempotencyKey, "rentdock-checkout-attempt");
  assert.equal(captured.body.success_url, "https://rentdock.example/dashboard/payment?checkout=attempt");
  assert.deepEqual(captured.body.allowed_payment_method_types, ["card"]);
});
