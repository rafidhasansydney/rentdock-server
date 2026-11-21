import { randomUUID } from "node:crypto";

export async function verifyDatabaseRoundTrip(database) {
  const collection = database.collection("_connection_checks");
  const id = randomUUID();
  try {
    await collection.insertOne({ _id: id, purpose: "connection-check", stage: "created", createdAt: new Date() });
    const created = await collection.findOne({ _id: id });
    if (created?.stage !== "created") throw new Error("Database read verification failed.");
    const update = await collection.updateOne({ _id: id }, { $set: { stage: "verified" } });
    if (update.matchedCount !== 1) throw new Error("Database update verification failed.");
    const updated = await collection.findOne({ _id: id });
    if (updated?.stage !== "verified") throw new Error("Database update readback failed.");
    const removed = await collection.deleteOne({ _id: id });
    if (removed.deletedCount !== 1 || await collection.findOne({ _id: id })) throw new Error("Database cleanup verification failed.");
  } finally {
    await collection.deleteOne({ _id: id });
  }
}
