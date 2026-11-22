import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { config } from "../src/config.js";
import { databaseService } from "../src/database.js";
import { createRentalStripe, verifyRentalSession } from "../src/bookings/stripe.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
try {
  const demo = JSON.parse(readFileSync(new URL("../.booking-demo.json", import.meta.url), "utf8"));
  const db = await databaseService.connect();
  const attempt = await db.collection("checkoutAttempts").find({ equipmentId: demo.equipmentId, state: { $in: ["paid", "completed"] } }).sort({ paidAt: -1 }).limit(1).next();
  if (!attempt) { console.error("No verified paid rental was found for the demo listing yet. Complete the browser test, then retry."); process.exitCode = 1; }
  else {
    const session = verifyRentalSession(attempt, await createRentalStripe(config).retrieve(attempt.sessionId), { paid: true });
    const booking = await db.collection("bookings").findOne({ _id: attempt._id, customerId: attempt.customerId });
    const payment = await db.collection("payments").findOne({ _id: session.id, bookingId: attempt._id });
    assert.ok(booking && payment);
    assert.equal(booking.amountMinor, session.amount_total);
    assert.equal(booking.currency, "bdt");
    assert.equal(payment.paymentIntentId, session.payment_intent.id);
    assert.equal(await db.collection("bookings").countDocuments({ attemptId: attempt._id }), 1);
    assert.equal(await db.collection("payments").countDocuments({ bookingId: attempt._id }), 1);
    console.log(`PASS real Stripe sandbox payment: BDT ${(attempt.amountMinor / 100).toFixed(2)}; paid and complete.`);
    console.log("PASS exactly one matching booking and payment are persisted in MongoDB.");
    if (attempt.lastWebhookAt instanceof Date) console.log("PASS live signed Stripe webhook processed and recorded for this rental.");
    else { console.error("Payment is saved, but its live webhook has not been recorded yet. Keep the listener open and retry this report."); process.exitCode = 1; }
    console.log(`Booking reference: ${attempt._id}`);
  }
} catch (error) {
  console.error("Rental payment verification did not pass.");
  if (error.bookingError) console.error(error.message);
  else if (error.name === "AssertionError") console.error("The provider and stored rental records did not match. Share this output for investigation.");
  else console.error(describeDatabaseFailure(error));
  process.exitCode = 1;
} finally { await databaseService.close(); }
