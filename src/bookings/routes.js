import express, { Router } from "express";
import { createAuthorization } from "../middleware/authorization.js";
import { bookingError } from "./policy.js";

function failure(res, error) {
  const safe = error.bookingError && [400, 404, 409, 429, 502, 503].includes(error.status);
  res.status(safe ? error.status : 503).json({ error: { code: "BOOKING_REQUEST_FAILED", message: safe ? error.message : "Your booking could not be loaded or saved. Please try again." } });
}
export function createWebhookRoutes({ bookings, gateway }) {
  const router = Router();
  router.post("/payments/webhook", express.raw({ type: "application/json", limit: "200kb" }), async (req, res) => {
    try { const event = gateway.event(req.body, req.get("Stripe-Signature")); await bookings.event(event); res.json({ received: true }); }
    catch (error) { failure(res, error); }
  });
  return router;
}
export function createBookingRoutes({ bookings, authentication }) {
  const router = Router();
  const auth = createAuthorization({ auth: authentication.auth, settings: authentication.settings });
  router.use(["/booking", "/rentals", "/owner/rentals"], auth.verifyToken);
  router.use(["/booking", "/rentals"], auth.verifyRenter);
  router.use("/owner/rentals", auth.verifyOwner);
  const run = handler => async (req, res) => { try { res.set("Cache-Control", "no-store"); res.json(await handler(req)); } catch (error) { failure(res, error); } };
  router.post("/booking/quote", run(req => bookings.quote(req.body)));
  router.post("/booking/checkout", run(req => bookings.checkout(req.user, req.body)));
  router.get("/booking/checkouts/:id", run(req => bookings.status(req.user, req.params.id)));
  router.post("/booking/checkouts/:id/cancel", run(req => bookings.cancel(req.user, req.params.id)));
  function list(req) {
    const page = Number(req.query.page || 1);
    if (Object.keys(req.query).some(key => key !== "page") || (req.query.page && typeof req.query.page !== "string") || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw bookingError("Choose a valid rentals page.");
    return bookings.rentals(req.user, page);
  }
  router.get("/rentals", run(list));
  router.get("/owner/rentals", run(list));
  return router;
}
