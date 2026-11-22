import test from "node:test";
import assert from "node:assert/strict";
import { availableFor, rentalPrice, validateBooking, dhakaToday } from "../src/bookings/policy.js";
import { verifyRentalSession } from "../src/bookings/stripe.js";
test("rental dates use inclusive Dhaka days and whole weekly/monthly blocks", () => {
  assert.equal(dhakaToday(new Date("2026-11-22T19:00:00Z")), "2026-11-23");
  const input = validateBooking({ equipmentId: "camera", startDate: "2026-11-23", endDate: "2026-11-23", quantity: 2 }, { today: "2026-11-22" });
  assert.equal(rentalPrice({ price: 10.25, rentalType: "Daily" }, input).amountMinor, 2050);
  assert.equal(rentalPrice({ price: 100, rentalType: "Weekly" }, { ...input, endDate: "2026-11-30" }).periods, 2);
  assert.equal(rentalPrice({ price: 100, rentalType: "Monthly" }, { ...input, endDate: "2026-12-23" }).periods, 2);
  for (const change of [{ startDate: "2026-11-21" }, { endDate: "2026-11-22" }, { endDate: "2026-02-30" }, { quantity: 1.5 }, { amountMinor: 1 }, { customerId: "someone" }, { endDate: "2027-06-01" }]) assert.throws(() => validateBooking({ ...input, ...change }, { today: "2026-11-22" }));
});
test("availability uses peak concurrent quantity, includes touching dates and ignores non-overlap", () => {
  const input = { startDate: "2026-11-23", endDate: "2026-11-25" };
  const rows = [{ startDate: "2026-11-23", endDate: "2026-11-23", quantity: 1 }, { startDate: "2026-11-24", endDate: "2026-11-25", quantity: 1 }, { startDate: "2026-11-27", endDate: "2026-11-28", quantity: 10 }];
  assert.equal(availableFor(2, input, rows), 1);
  assert.equal(availableFor(2, input, [...rows, { startDate: "2026-11-25", endDate: "2026-11-26", quantity: 1 }]), 0);
});
test("rental payment proof rejects wrong amounts, currency, identity, unpaid and live sessions", () => {
  const attempt = { _id: "attempt", customerId: "customer", equipmentId: "camera", amountMinor: 20000, sessionId: "cs_test_session" };
  const value = { id: "cs_test_session", livemode: false, mode: "payment", amount_total: 20000, currency: "bdt", client_reference_id: "attempt", metadata: { purpose: "rentdock-rental", attemptId: "attempt", customerId: "customer", equipmentId: "camera" }, status: "complete", payment_status: "paid", payment_intent: { id: "pi_payment", status: "succeeded", currency: "bdt", livemode: false, amount_received: 20000 } };
  assert.equal(verifyRentalSession(attempt, value, { paid: true }), value);
  for (const change of [{ amount_total: 1 }, { currency: "usd" }, { livemode: true }, { metadata: { ...value.metadata, customerId: "other" } }, { payment_status: "unpaid" }, { payment_intent: "pi_payment" }, { payment_intent: { ...value.payment_intent, amount_received: 1 } }]) assert.throws(() => verifyRentalSession(attempt, { ...value, ...change }, { paid: true }));
});
