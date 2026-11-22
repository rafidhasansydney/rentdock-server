import { randomUUID } from "node:crypto";
import { atomic, authId, control } from "./database.js";
import { adminError, literalSearch, visibleStatuses, versionFilter, protectUser } from "./policy.js";
import { ownerEquipment } from "../owner/repository.js";
import { publicRental } from "../bookings/repository.js";
import { dhakaToday, pendingStates } from "../bookings/policy.js";

export const managedUser = row => ({ id: String(row._id), name: row.name, email: row.email, role: row.role || "customer", suspended: Boolean(row.suspended), createdAt: row.createdAt, version: row.managementVersion || 0 });
const listing = row => ({ ...ownerEquipment(row), version: row.version || 0, ownerEmail: row.ownerEmail || "" });
const visible = { status: { $in: visibleStatuses } };
export function createAdministrationRepository(database) {
  const connect = () => database.connect();
  async function audit(db, session, actorId, action, targetId, changes) { await db.collection("adminAudit").insertOne({ _id: randomUUID(), actorId, action, targetId, changes, createdAt: new Date() }, { session }); }
  async function paged(collection, filter, page, serialize) {
    const total = await collection.countDocuments(filter);
    const rows = await collection.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * 12).limit(12).toArray();
    return { items: rows.map(serialize), total, page, pages: Math.ceil(total / 12) };
  }
  async function revoke(db, session, id) { await db.collection("session").deleteMany({ userId: { $in: [authId(id), String(id)] } }, { session }); }
  return {
    async ensureIndexes() {
      const db = await connect();
      await db.collection("adminControl").createIndex({ version: 1 });
      await db.collection("adminAudit").createIndex({ actorId: 1, createdAt: -1 });
      await db.collection("user").createIndex({ role: 1, suspended: 1 });
    },
    async users(query) { return paged((await connect()).collection("user"), { ...literalSearch(query.q, ["name", "email"]), ...(query.role ? { role: query.role } : {}), ...(query.state ? { suspended: query.state === "suspended" ? true : { $ne: true } } : {}) }, query.page, managedUser); },
    async changeUser(actorId, id, input) {
      return atomic(database, async (db, session) => {
        await control(db, session, actorId);
        const users = db.collection("user"), target = await users.findOne({ _id: authId(id) }, { session });
        if (!target) throw adminError("This account was not found.", 404);
        if ((target.managementVersion || 0) !== input.version) throw adminError("This account changed. Reload before saving.", 409);
        const activeAdmins = await users.countDocuments({ role: "admin", suspended: { $ne: true } }, { session });
        const hasEquipment = target.role === "owner" && await db.collection("equipment").findOne({ ownerId: id, ...visible }, { session, projection: { _id: 1 } });
        const hasHolds = await db.collection("checkoutAttempts").findOne({ customerId: id, state: { $in: pendingStates } }, { session, projection: { _id: 1 } });
        protectUser(actorId, target, input, activeAdmins, Boolean(hasEquipment), Boolean(hasHolds));
        const updated = await users.findOneAndUpdate({ _id: target._id, ...versionFilter("managementVersion", input.version) }, { $set: { role: input.role, suspended: input.suspended, updatedAt: new Date() }, $inc: { managementVersion: 1 } }, { session, returnDocument: "after", includeResultMetadata: false });
        if (!updated) throw adminError("This account changed. Reload before saving.", 409);
        await revoke(db, session, id);
        await audit(db, session, actorId, "user.access", id, { before: { role: target.role, suspended: Boolean(target.suspended) }, after: { role: input.role, suspended: input.suspended } });
        return { user: managedUser(updated) };
      });
    },
    async bootstrap(email) {
      return atomic(database, async (db, session) => {
        await control(db, session);
        const users = db.collection("user"), target = await users.findOne({ email: email.toLowerCase() }, { session });
        if (!target) throw adminError("Sign in with this email on RentDock first, then retry initial Admin setup.", 404);
        if (target.role === "admin" && !target.suspended) return managedUser(target);
        if (await users.countDocuments({ role: "admin", suspended: { $ne: true } }, { session })) throw adminError("Initial Admin setup is already complete. Use an existing Admin account to manage roles.", 409);
        if (target.suspended) throw adminError("Review this suspended account before granting Admin access.", 409);
        await users.updateOne({ _id: target._id }, { $set: { role: "admin", updatedAt: new Date() }, $inc: { managementVersion: 1 } }, { session });
        await revoke(db, session, String(target._id));
        await audit(db, session, String(target._id), "user.bootstrap", String(target._id), { role: "admin" });
        return managedUser({ ...target, role: "admin", managementVersion: (target.managementVersion || 0) + 1 });
      });
    },
    async equipment(query) { return paged((await connect()).collection("equipment"), { ...visible, ...literalSearch(query.q, ["name", "location", "ownerName"]), ...(query.status ? { status: query.status } : {}) }, query.page, listing); },
    async equipmentItem(id) { const row = await (await connect()).collection("equipment").findOne({ _id: id, ...visible }); if (!row) throw adminError("This listing was not found.", 404); return { item: listing(row) }; },
    async moderate(actorId, id, input) {
      return atomic(database, async (db, session) => {
        await control(db, session, actorId);
        const equipment = db.collection("equipment"), row = await equipment.findOne({ _id: id, ...visible }, { session });
        if (!row) throw adminError("This listing was not found.", 404);
        if (input.status === "approved" && row.ownerId && !await db.collection("user").findOne({ _id: authId(row.ownerId), role: "owner", suspended: { $ne: true } }, { session })) throw adminError("Restore an active Owner account before approving this listing.", 409);
        const updated = await equipment.findOneAndUpdate({ _id: id, ...visible, ...versionFilter("version", input.version) }, { $set: { status: input.status, rejectionReason: input.status === "rejected" ? input.reason : "", reviewedBy: actorId, reviewedAt: new Date(), updatedAt: new Date() }, $inc: { version: 1 } }, { session, returnDocument: "after", includeResultMetadata: false });
        if (!updated) throw adminError("This listing changed. Reload before reviewing.", 409);
        await audit(db, session, actorId, "equipment.review", id, { before: row.status, after: input.status });
        return { item: listing(updated) };
      });
    },
    async updateEquipment(actorId, id, input) {
      return atomic(database, async (db, session) => {
        await control(db, session, actorId);
        const { version, ...details } = input;
        const updated = await db.collection("equipment").findOneAndUpdate({ _id: id, ...visible, activeRentalCount: { $in: [0, null] }, ...versionFilter("version", version) }, { $set: { ...details, availableQuantity: details.quantity, imageAlt: details.name, updatedAt: new Date() }, $inc: { version: 1 } }, { session, returnDocument: "after", includeResultMetadata: false });
        if (!updated) throw adminError("This listing changed, is unavailable or has active rentals. Reload before editing.", 409);
        await audit(db, session, actorId, "equipment.update", id, { version: version + 1 });
        return { item: listing(updated) };
      });
    },
    async deleteEquipment(actorId, id, version) {
      return atomic(database, async (db, session) => {
        await control(db, session, actorId);
        const removed = await db.collection("equipment").updateOne({ _id: id, ...visible, activeRentalCount: { $in: [0, null] }, ...versionFilter("version", version) }, { $set: { status: "deleted", deletedAt: new Date() }, $inc: { version: 1 } }, { session });
        if (!removed.modifiedCount) throw adminError("This listing changed, is unavailable or has active rentals. Reload before deleting.", 409);
        await audit(db, session, actorId, "equipment.archive", id, { version: version + 1 });
        return { removed: true };
      });
    },
    async rentals(query) {
      const db = await connect(), today = dhakaToday();
      const filter = literalSearch(query.q, ["equipmentName", "customerName", "customerEmail", "ownerName"]);
      if (query.status === "completed") Object.assign(filter, { $and: [{ $or: [{ bookingStatus: "completed" }, { bookingStatus: { $in: ["confirmed", "ongoing"] }, endDate: { $lt: today } }] }] });
      if (query.status === "ongoing") Object.assign(filter, { bookingStatus: { $in: ["confirmed", "ongoing"] }, startDate: { $lte: today }, endDate: { $gte: today } });
      if (query.status === "confirmed") Object.assign(filter, { bookingStatus: "confirmed", startDate: { $gt: today } });
      const result = await paged(db.collection("bookings"), filter, query.page, row => ({ ...publicRental(row), ownerId: row.ownerId, version: row.adminVersion || 0, adminNote: row.adminNote || "", storedStatus: row.bookingStatus }));
      const owners = await db.collection("user").find({ _id: { $in: result.items.map(row => authId(row.ownerId)) } }, { projection: { _id: 1, email: 1 } }).toArray();
      return { ...result, items: result.items.map(({ ownerId, ...row }) => ({ ...row, ownerEmail: owners.find(owner => String(owner._id) === ownerId)?.email || "" })) };
    },
    async manageRental(actorId, id, input) {
      return atomic(database, async (db, session) => {
        await control(db, session, actorId);
        const bookings = db.collection("bookings"), row = await bookings.findOne({ _id: id }, { session });
        if (!row) throw adminError("This rental was not found.", 404);
        if ((row.adminVersion || 0) !== input.version || row.paymentStatus !== "paid") throw adminError("This rental changed or is not paid. Reload before managing it.", 409);
        const today = dhakaToday(), changes = { adminNote: input.note, managedAt: new Date(), managedBy: actorId };
        if (input.action === "start") {
          if (row.bookingStatus !== "confirmed" || row.startDate > today || row.endDate < today) throw adminError("Record handover only during a confirmed rental's dates.", 409);
          changes.bookingStatus = "ongoing";
        }
        if (input.action === "complete") {
          if (!["confirmed", "ongoing"].includes(row.bookingStatus) || row.endDate >= today) throw adminError("Complete rentals only after their inclusive end date.", 409);
          const attempt = await db.collection("checkoutAttempts").findOne({ _id: id, state: "paid" }, { session });
          if (!attempt) throw adminError("The inventory reservation needs review before completion.", 409);
          const unlocked = await db.collection("equipment").updateOne({ _id: row.equipmentId, activeRentalCount: { $gte: 1 } }, { $inc: { bookingVersion: 1, activeRentalCount: -1 } }, { session });
          if (!unlocked.modifiedCount) throw adminError("The equipment inventory needs review before completion.", 409);
          await db.collection("checkoutAttempts").updateOne({ _id: id, state: "paid" }, { $set: { state: "completed" } }, { session });
          changes.bookingStatus = "completed";
        }
        await bookings.updateOne({ _id: id, ...versionFilter("adminVersion", input.version) }, { $set: changes, $inc: { adminVersion: 1 } }, { session });
        await audit(db, session, actorId, `rental.${input.action}`, id, { version: input.version + 1 });
        return { saved: true };
      });
    },
  };
}
