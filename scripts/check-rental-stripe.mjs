import { randomUUID } from "node:crypto";
import { config } from "../src/config.js";
import { createRentalStripe, verifyRentalSession } from "../src/bookings/stripe.js";
const gateway = createRentalStripe(config);
let session;
try {
  const attempt = { _id: randomUUID(), diagnostic: true, equipmentId: "provider-currency-check", customerId: "provider-currency-check", equipmentName: "RentDock BDT currency check", startDate: "2026-11-25", endDate: "2026-11-25", quantity: 1, periods: 1, rentalType: "Daily", amountMinor: 100000, expiresAt: new Date(Date.now() + 35 * 60000) };
  session = verifyRentalSession(attempt, await gateway.create(attempt));
  const expired = verifyRentalSession(attempt, await gateway.expire(session.id));
  if (expired.status !== "expired") throw new Error("The diagnostic checkout did not expire.");
  console.log("PASS Stripe test Checkout supports BDT 1,000. The unpaid diagnostic session was expired; no booking or charge was created.");
} catch (error) {
  console.error(error.bookingError ? error.message : "BDT provider verification failed. Check test key permissions and connectivity.");
  if (error.diagnostics) console.error(`Diagnostic codes: ${error.diagnostics}`);
  if (session) console.error("A test session was created. Do not pay it; it has an automatic expiry.");
  process.exitCode = 1;
}
