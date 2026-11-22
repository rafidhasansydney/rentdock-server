import Stripe from "stripe";
import { bookingError } from "./policy.js";

export function createRentalStripe(settings, client) {
  const enabled = /^(sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(settings.stripeSecretKey ?? "");
  const stripe = client ?? (enabled ? new Stripe(settings.stripeSecretKey, { apiVersion: "2026-11-18.endive", maxNetworkRetries: 0, timeout: 15000, httpClient: Stripe.createFetchHttpClient() }) : null);
  async function run(action) {
    if (!stripe) throw bookingError("Test payments are currently unavailable. Please try again later.", 503);
    try { return await action(); }
    catch (error) {
      if (error.bookingError) throw error;
      const failure = bookingError(error.code === "amount_too_small" ? "This total is below the payment provider's minimum. Choose a longer rental or more items." : "The payment provider could not complete this request. Please retry from My rentals.", 502);
      failure.definitive = [400, 401, 403, 404].includes(error.statusCode);
      failure.diagnostics = [error.type, error.statusCode, error.code, error.param].filter(value => value !== undefined && /^[A-Za-z0-9_.\[\]-]+$/.test(String(value))).join("; ");
      throw failure;
    }
  }
  return {
    enabled,
    webhookEnabled: enabled && /^whsec_[A-Za-z0-9]+$/.test(settings.stripeWebhookSecret ?? ""),
    async create(attempt) {
      return run(async () => {
        const session = await stripe.checkout.sessions.create({ mode: "payment", allowed_payment_method_types: ["card"], adaptive_pricing: { enabled: false },
          line_items: [{ quantity: 1, price_data: { currency: "bdt", unit_amount: attempt.amountMinor, product_data: { name: attempt.equipmentName, description: `${attempt.startDate} to ${attempt.endDate}; ${attempt.quantity} item(s); ${attempt.periods} ${attempt.rentalType.toLowerCase()} period(s)` } } }],
          client_reference_id: attempt._id,
          metadata: { purpose: attempt.diagnostic ? "rentdock-currency-check" : "rentdock-rental", attemptId: attempt._id, customerId: attempt.customerId, equipmentId: attempt.equipmentId },
          success_url: `${settings.clientOrigin}/dashboard/payment?checkout=${attempt._id}`,
          cancel_url: `${settings.clientOrigin}/dashboard/payment?checkout=${attempt._id}&cancelled=1`,
          expires_at: Math.floor(attempt.expiresAt.getTime() / 1000),
        }, { idempotencyKey: `rentdock-checkout-${attempt._id}` });
        const url = new URL(session.url);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) throw bookingError("The payment provider returned an unexpected checkout address.", 502);
        return session;
      });
    },
    retrieve(id) { return run(() => stripe.checkout.sessions.retrieve(id, { expand: ["payment_intent", "line_items"] })); },
    async expire(id) {
      try { await run(() => stripe.checkout.sessions.expire(id)); }
      catch (error) { if (!error.definitive) throw error; }
      return this.retrieve(id);
    },
    event(raw, signature) {
      if (!enabled || !settings.stripeWebhookSecret) throw bookingError("Payment notifications are not configured.", 503);
      try { return stripe.webhooks.constructEvent(raw, signature, settings.stripeWebhookSecret); }
      catch { throw bookingError("Invalid payment notification signature.", 400); }
    },
  };
}

export function verifyRentalSession(attempt, session, { paid = false } = {}) {
  if (!session || !/^cs_test_[A-Za-z0-9]+$/.test(session.id ?? "") || session.livemode !== false || session.mode !== "payment" || session.currency !== "bdt" || session.amount_total !== attempt.amountMinor || session.client_reference_id !== attempt._id || session.metadata?.purpose !== (attempt.diagnostic ? "rentdock-currency-check" : "rentdock-rental") || session.metadata?.attemptId !== attempt._id || session.metadata?.customerId !== attempt.customerId || session.metadata?.equipmentId !== attempt.equipmentId || (attempt.sessionId && attempt.sessionId !== session.id)) throw bookingError("The payment does not match this rental. Contact support before retrying payment.", 409);
  if (paid) {
    const intent = session.payment_intent;
    if (session.status !== "complete" || session.payment_status !== "paid" || !intent || typeof intent !== "object" || !/^pi_[A-Za-z0-9]+$/.test(intent.id ?? "") || intent.status !== "succeeded" || intent.livemode !== false || intent.currency !== "bdt" || intent.amount_received !== attempt.amountMinor) throw bookingError("Payment has not been confirmed yet. Please refresh its status.", 409);
  }
  return session;
}
