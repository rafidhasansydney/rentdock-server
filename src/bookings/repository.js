import { randomUUID } from "node:crypto";
import { activeStates, pendingStates, availableFor, rentalPrice, bookingError, bookingFingerprint, bookable, dhakaToday } from "./policy.js";
import { databaseUserId, touchRole } from "../auth/storage.js";

const overlap = input => ({ equipmentId: input.equipmentId, state: { $in: activeStates }, startDate: { $lte: input.endDate }, endDate: { $gte: input.startDate } });
export function publicAttempt(row) { return { id: row._id, equipmentId: row.equipmentId, equipmentName: row.equipmentName, startDate: row.startDate, endDate: row.endDate, quantity: row.quantity, amountMinor: row.amountMinor, currency: row.currency, state: row.state, expiresAt: row.expiresAt, checkoutUrl: row.state === "open" ? row.checkoutUrl : undefined }; }
export function publicRental(row, today = dhakaToday()) { const { _id, customerId, ownerId, attemptId, adminNote, adminVersion, managedAt, managedBy, ...details } = row; void customerId; void ownerId; void attemptId; void adminNote; void adminVersion; void managedAt; void managedBy; return { ...details, id: _id, bookingStatus: ["confirmed", "ongoing"].includes(row.bookingStatus) && row.startDate <= today ? (row.endDate < today ? "completed" : "ongoing") : row.bookingStatus }; }

export function createBookingRepository(database, { clock = () => new Date() } = {}) {
  async function db() { return database.connect(); }
  async function transaction(action) {
    const connection = await db();
    const client = database.getClient?.();
    if (!client) throw bookingError("Booking storage is currently unavailable.", 503);
    const session = client.startSession();
    try { return await session.withTransaction(() => action(connection, session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10000 }); }
    finally { await session.endSession(); }
  }
  async function lockEquipment(connection, session, id, increment = 0) {
    const value = await connection.collection("equipment").findOneAndUpdate({ _id: id, ...(increment < 0 ? { activeRentalCount: { $gte: 1 } } : {}) }, { $inc: { bookingVersion: 1, ...(increment ? { activeRentalCount: increment } : {}) } }, { session, returnDocument: "after", includeResultMetadata: false });
    if (!value) throw bookingError("This rental needs a storage consistency check. Please contact support.", 503);
    return value;
  }
  return {
    async ensureIndexes() {
      const connection = await db();
      await connection.collection("checkoutAttempts").createIndex({ customerId: 1, requestId: 1 }, { unique: true });
      await connection.collection("checkoutAttempts").createIndex({ sessionId: 1 }, { unique: true, sparse: true });
      await connection.collection("checkoutAttempts").createIndex({ equipmentId: 1, state: 1, startDate: 1, endDate: 1 });
      await connection.collection("checkoutAttempts").createIndex({ customerId: 1, state: 1, createdAt: -1 });
      await connection.collection("bookings").createIndex({ customerId: 1, createdAt: -1 });
      await connection.collection("bookings").createIndex({ ownerId: 1, createdAt: -1 });
      await connection.collection("payments").createIndex({ paymentIntentId: 1 }, { unique: true });
      await connection.collection("bookingLocks").createIndex({ updatedAt: 1 });
    },
    async quote(input) {
      const connection = await db();
      const equipment = await connection.collection("equipment").findOne({ _id: input.equipmentId });
      if (!bookable(equipment)) throw bookingError("This listing is not available for booking. Choose approved equipment from an owner.", 409);
      if (!await connection.collection("user").findOne({ _id: databaseUserId(equipment.ownerId), role: "owner", suspended: { $ne: true } }, { projection: { _id: 1 } })) throw bookingError("This Owner is currently unavailable for new rentals.", 409);
      const records = await connection.collection("checkoutAttempts").find(overlap(input)).toArray();
      return { ...rentalPrice(equipment, input), availableQuantity: availableFor(equipment.quantity, input, records), quoteVersion: equipment.version };
    },
    async reserve(user, input) {
      const id = randomUUID(), fingerprint = bookingFingerprint(input);
      const now = clock();
      for (let retry = 0; ; retry++) {
        try { return await transaction(async (connection, session) => {
          const attempts = connection.collection("checkoutAttempts");
          await connection.collection("bookingLocks").updateOne({ _id: user.id }, { $inc: { version: 1 }, $set: { updatedAt: now } }, { upsert: true, session });
          if (!await touchRole(connection, session, user.id, "customer")) throw bookingError("Your Customer access changed. Sign in again.", 409);
          const existing = await attempts.findOne({ customerId: user.id, requestId: input.requestId }, { session });
          if (existing) { if (existing.fingerprint !== fingerprint) throw bookingError("This payment attempt belongs to different rental details. Review My rentals first.", 409); return existing; }
          if (await attempts.countDocuments({ customerId: user.id, state: { $in: pendingStates } }, { session }) >= 3) throw bookingError("Finish or cancel an existing checkout in My rentals before starting another.", 429);
          if (await attempts.countDocuments({ customerId: user.id, createdAt: { $gte: new Date(now.getTime() - 3600000) } }, { session }) >= 20) throw bookingError("Too many checkout attempts. Please try again in an hour.", 429);
          if (await attempts.findOne({ customerId: user.id, equipmentId: input.equipmentId, state: { $in: pendingStates } }, { session })) throw bookingError("You already have a checkout for this equipment. Resume or cancel it in My rentals.", 409);
          const equipment = await lockEquipment(connection, session, input.equipmentId, 1);
          if (!bookable(equipment) || equipment.ownerId === user.id || equipment.version !== input.quoteVersion) throw bookingError("This listing changed. Review its latest price and availability.", 409);
          if (!await touchRole(connection, session, equipment.ownerId, "owner")) throw bookingError("This Owner is currently unavailable for new rentals.", 409);
          const records = await attempts.find(overlap(input), { session }).toArray();
          if (input.quantity > availableFor(equipment.quantity, input, records)) throw bookingError("That quantity is no longer available for these dates. Choose fewer items or different dates.", 409);
          const attempt = { _id: id, ...input, ...rentalPrice(equipment, input), fingerprint, customerId: user.id, customerName: user.name, customerEmail: user.email, ownerId: equipment.ownerId, ownerName: equipment.ownerName, equipmentName: equipment.name, state: "creating", expiresAt: new Date(now.getTime() + 35 * 60000), createdAt: now };
          await attempts.insertOne(attempt, { session });
          return attempt;
        }); } catch (error) { if (error.code === 11000 && retry < 2) continue; throw error; }
      }
    },
    async get(id, customerId) { return (await db()).collection("checkoutAttempts").findOne({ _id: id, ...(customerId ? { customerId } : {}) }); },
    async claimCreation(id) {
      const now = clock();
      return (await db()).collection("checkoutAttempts").findOneAndUpdate({ _id: id, state: "creating", $or: [{ creationLeaseUntil: { $exists: false } }, { creationLeaseUntil: { $lte: now } }] }, { $set: { creationLeaseToken: randomUUID(), creationLeaseUntil: new Date(now.getTime() + 120000) }, $inc: { creationCount: 1 } }, { returnDocument: "after", includeResultMetadata: false });
    },
    async clearCreationLease(id, token) { await (await db()).collection("checkoutAttempts").updateOne({ _id: id, creationLeaseToken: token }, { $unset: { creationLeaseToken: "", creationLeaseUntil: "" } }); },
    async bind(id, sessionValue) {
      const attempts = (await db()).collection("checkoutAttempts");
      await attempts.updateOne({ _id: id, state: "creating", $or: [{ sessionId: { $exists: false } }, { sessionId: sessionValue.id }] }, { $set: { state: "open", sessionId: sessionValue.id, checkoutUrl: sessionValue.url, expiresAt: new Date(sessionValue.expires_at * 1000) }, $unset: { creationLeaseToken: "", creationLeaseUntil: "" } });
      return attempts.findOne({ _id: id });
    },
    async finalize(id, stripeSession, source = "return") {
      return transaction(async (connection, session) => {
        const attempts = connection.collection("checkoutAttempts");
        const attempt = await attempts.findOne({ _id: id }, { session });
        if (!attempt) throw bookingError("This checkout is not available.", 404);
        const stored = await connection.collection("bookings").findOne({ _id: id }, { session });
        if (stored) {
          if (source === "webhook") await attempts.updateOne({ _id: id }, { $set: { lastWebhookAt: clock() } }, { session });
          return publicRental(stored);
        }
        if (!pendingStates.includes(attempt.state)) throw bookingError("This checkout was released and needs payment review.", 409);
        await lockEquipment(connection, session, attempt.equipmentId);
        const now = clock();
        const rental = { _id: id, attemptId: id, equipmentId: attempt.equipmentId, equipmentName: attempt.equipmentName, customerId: attempt.customerId, customerName: attempt.customerName, customerEmail: attempt.customerEmail, ownerId: attempt.ownerId, ownerName: attempt.ownerName, startDate: attempt.startDate, endDate: attempt.endDate, quantity: attempt.quantity, contactNumber: attempt.contactNumber, deliveryAddress: attempt.deliveryAddress, notes: attempt.notes, amountMinor: attempt.amountMinor, currency: "bdt", periods: attempt.periods, rentalType: attempt.rentalType, paymentStatus: "paid", bookingStatus: "confirmed", sessionId: stripeSession.id, transactionId: stripeSession.payment_intent.id, createdAt: now };
        await connection.collection("payments").insertOne({ _id: stripeSession.id, bookingId: id, customerId: attempt.customerId, ownerId: attempt.ownerId, paymentIntentId: stripeSession.payment_intent.id, amountMinor: attempt.amountMinor, currency: "bdt", status: "paid", createdAt: now }, { session });
        await connection.collection("bookings").insertOne(rental, { session });
        await attempts.updateOne({ _id: id }, { $set: { state: "paid", sessionId: stripeSession.id, paidAt: now, fulfilledBy: source, ...(source === "webhook" ? { lastWebhookAt: now } : {}) }, $unset: { checkoutUrl: "", creationLeaseToken: "", creationLeaseUntil: "" } }, { session });
        return publicRental(rental);
      });
    },
    async release(id, creationLeaseToken) {
      return transaction(async (connection, session) => {
        const attempts = connection.collection("checkoutAttempts");
        const attempt = await attempts.findOne({ _id: id }, { session });
        if (!attempt || !pendingStates.includes(attempt.state)) return;
        if (creationLeaseToken && (attempt.state !== "creating" || attempt.creationLeaseToken !== creationLeaseToken || attempt.creationCount !== 1)) return;
        await lockEquipment(connection, session, attempt.equipmentId, -1);
        await attempts.updateOne({ _id: id }, { $set: { state: "expired", releasedAt: clock() }, $unset: { checkoutUrl: "" } }, { session });
      });
    },
    async due(equipmentId, customerId) { return (await db()).collection("checkoutAttempts").find({ state: { $in: pendingStates }, expiresAt: { $lte: clock() }, ...(equipmentId ? { equipmentId } : {}), ...(customerId ? { customerId } : {}) }).sort({ expiresAt: 1 }).limit(3).toArray(); },
    async completeDue() {
      const rows = await (await db()).collection("checkoutAttempts").find({ state: "paid", endDate: { $lt: dhakaToday(clock()) } }).limit(20).toArray();
      for (const row of rows) await transaction(async (connection, session) => {
        const attempts = connection.collection("checkoutAttempts");
        if (!(await attempts.findOne({ _id: row._id, state: "paid" }, { session }))) return;
        await lockEquipment(connection, session, row.equipmentId, -1);
        await attempts.updateOne({ _id: row._id }, { $set: { state: "completed" } }, { session });
        await connection.collection("bookings").updateOne({ _id: row._id }, { $set: { bookingStatus: "completed" } }, { session });
      });
    },
    async pending(customerId) { return (await db()).collection("checkoutAttempts").find({ customerId, state: { $in: pendingStates } }).sort({ createdAt: -1 }).limit(3).toArray(); },
    async rentals(userId, role, page) {
      const bookings = (await db()).collection("bookings");
      const filter = role === "owner" ? { ownerId: userId } : { customerId: userId };
      const total = await bookings.countDocuments(filter);
      const rows = await bookings.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * 12).limit(12).toArray();
      return { items: rows.map(row => publicRental(row)), total, page, pages: Math.ceil(total / 12) };
    },
    async rental(id, customerId) { const row = await (await db()).collection("bookings").findOne({ _id: id, customerId }); return row ? publicRental(row) : null; },
  };
}
