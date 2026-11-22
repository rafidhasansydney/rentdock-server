import { pendingStates, validateBooking, bookingError } from "./policy.js";
import { publicAttempt } from "./repository.js";
import { verifyRentalSession } from "./stripe.js";

export function createBookingService({ repository, gateway }) {
  async function prepare(attempt) {
    const claimed = await repository.claimCreation(attempt._id);
    if (!claimed) throw bookingError("Checkout is already being prepared. Wait a moment and refresh My rentals.", 409);
    try {
      const created = verifyRentalSession(claimed, await gateway.create(claimed));
      return await repository.bind(claimed._id, created);
    } catch (error) {
      if (error.definitive && claimed.creationCount === 1) await repository.release(claimed._id, claimed.creationLeaseToken);
      else await repository.clearCreationLease(claimed._id, claimed.creationLeaseToken);
      throw error;
    }
  }
  async function sync(attempt, { cancel = false } = {}) {
    if (!pendingStates.includes(attempt.state)) return { attempt: publicAttempt(attempt), rental: await repository.rental(attempt._id, attempt.customerId) };
    if (!attempt.sessionId) {
      attempt = await prepare(attempt);
      if (!pendingStates.includes(attempt.state)) return sync(attempt);
    }
    const session = cancel ? await gateway.expire(attempt.sessionId) : await gateway.retrieve(attempt.sessionId);
    verifyRentalSession(attempt, session);
    let rental;
    if (session.payment_status === "paid") {
      verifyRentalSession(attempt, session, { paid: true });
      rental = await repository.finalize(attempt._id, session);
    } else if (session.status === "expired") await repository.release(attempt._id);
    return { attempt: publicAttempt(await repository.get(attempt._id)), rental };
  }
  async function maintain(equipmentId, customerId) {
    await repository.completeDue();
    for (const attempt of await repository.due(equipmentId, customerId)) {
      try { await sync(attempt); } catch { }
    }
  }
  async function current(id, userId) {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw bookingError("This checkout is not available.", 404);
    const value = await repository.get(id, userId);
    if (!value) throw bookingError("This checkout is not available.", 404);
    return value;
  }
  return {
    enabled: gateway.enabled && gateway.webhookEnabled,
    async quote(body) {
      const input = validateBooking(body);
      await maintain(input.equipmentId);
      return { ...await repository.quote(input), paymentAvailable: gateway.enabled && gateway.webhookEnabled };
    },
    async checkout(user, body) {
      if (!gateway.enabled || !gateway.webhookEnabled) throw bookingError("Payments are currently unavailable. Please try again later.", 503);
      const input = validateBooking(body, { checkout: true });
      await maintain(input.equipmentId, user.id);
      const attempt = await repository.reserve(user, input);
      if (!pendingStates.includes(attempt.state)) return sync(attempt);
      if (attempt.sessionId) return sync(attempt);
      const stored = await prepare(attempt);
      return { attempt: publicAttempt(stored) };
    },
    async status(user, id) { return sync(await current(id, user.id)); },
    async cancel(user, id) { return sync(await current(id, user.id), { cancel: true }); },
    async rentals(user, page) {
      await maintain(undefined, user.role === "customer" ? user.id : undefined);
      return { ...await repository.rentals(user.id, user.role, page), pending: user.role === "customer" ? (await repository.pending(user.id)).map(publicAttempt) : [] };
    },
    async event(event) {
      if (event.livemode !== false || !["checkout.session.completed", "checkout.session.expired", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed"].includes(event.type)) return;
      const session = event.data?.object;
      if (session?.metadata?.purpose !== "rentdock-rental") return;
      const attempt = await current(session.metadata.attemptId);
      if (attempt.sessionId && attempt.sessionId !== session.id) throw bookingError("Unexpected checkout notification.", 409);
      const fresh = verifyRentalSession(attempt, await gateway.retrieve(session.id));
      if (fresh.payment_status === "paid") { verifyRentalSession(attempt, fresh, { paid: true }); await repository.finalize(attempt._id, fresh, "webhook"); }
      else if (fresh.status === "expired") await repository.release(attempt._id);
    },
  };
}
