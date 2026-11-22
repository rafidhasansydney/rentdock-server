import { randomUUID } from "node:crypto";
import { listingStatuses } from "./policy.js";
import { touchRole } from "../auth/storage.js";
const owned = (ownerId, id) => ({ ownerId, ...(id ? { _id: id } : {}), status: { $in: listingStatuses } });
export function ownerEquipment(record) {
  const { _id, ownerEmail, activeRentalCount, ...item } = record;
  void ownerEmail; void activeRentalCount;
  return { ...item, id: String(_id), available: item.availableQuantity > 0 };
}
export function createOwnerRepository(database) {
  const collection = async () => (await database.connect()).collection("equipment");
  return {
    async list(ownerId, { page, status }) {
      const equipment = await collection();
      const filter = { ...owned(ownerId), ...(status ? { status } : {}) };
      const [items, total] = await Promise.all([equipment.find(filter).sort({ createdAt: -1, _id: 1 }).skip((page - 1) * 12).limit(12).toArray(), equipment.countDocuments(filter)]);
      return { items: items.map(ownerEquipment), total, page, pages: Math.ceil(total / 12), limit: 12 };
    },
    async summary(ownerId) {
      const equipment = await collection();
      const counts = await equipment.aggregate([{ $match: owned(ownerId) }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray();
      const result = { pending: 0, approved: 0, rejected: 0, total: 0 };
      for (const value of counts) { result[value._id] = value.count; result.total += value.count; }
      return result;
    },
    async get(ownerId, id) { const record = await (await collection()).findOne(owned(ownerId, id)); return record ? ownerEquipment(record) : null; },
    async create(user, input) {
      const db = await database.connect(), client = database.getClient?.();
      if (!client) throw new Error("Owner storage is unavailable.");
      const session = client.startSession();
      try { return await session.withTransaction(async () => {
        const current = await touchRole(db, session, user.id, "owner");
        if (!current) throw new Error("Owner access changed.");
        const now = new Date();
        const record = { ...input, _id: randomUUID(), availableQuantity: input.quantity, activeRentalCount: 0, status: "pending", ownerId: user.id, ownerName: current.name, ownerEmail: current.email, imageAlt: input.name, version: 1, isSample: false, createdAt: now, updatedAt: now };
        await db.collection("equipment").insertOne(record, { session });
        return ownerEquipment(record);
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }); }
      finally { await session.endSession(); }
    },
    async update(ownerId, id, input) {
      const equipment = await collection();
      const { version, ...details } = input;
      const updated = await equipment.findOneAndUpdate({ ...owned(ownerId, id), version, activeRentalCount: 0 }, { $set: { ...details, availableQuantity: details.quantity, status: "pending", rejectionReason: "", imageAlt: details.name, updatedAt: new Date() }, $inc: { version: 1 } }, { returnDocument: "after", includeResultMetadata: false });
      if (updated) return { item: ownerEquipment(updated) };
      return { conflict: Boolean(await equipment.findOne(owned(ownerId, id), { projection: { _id: 1 } })) };
    },
    async remove(ownerId, id, version) {
      const equipment = await collection();
      const result = await equipment.updateOne({ ...owned(ownerId, id), version, activeRentalCount: 0 }, { $set: { status: "deleted", deletedAt: new Date(), updatedAt: new Date() }, $inc: { version: 1 } });
      if (result.modifiedCount) return { removed: true };
      return { conflict: Boolean(await equipment.findOne(owned(ownerId, id), { projection: { _id: 1 } })) };
    },
  };
}
