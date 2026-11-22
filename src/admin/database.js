import { adminError } from "./policy.js";
import { databaseUserId } from "../auth/storage.js";
export const authId = databaseUserId;
export const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
export async function atomic(database, action) {
  const db = await database.connect();
  const client = database.getClient?.();
  if (!client) throw adminError("Management storage is currently unavailable.", 503);
  const session = client.startSession();
  try { return await session.withTransaction(() => action(db, session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10000 }); }
  finally { await session.endSession(); }
}
export async function control(db, session, actorId) {
  await db.collection("adminControl").updateOne({ _id: "permissions" }, { $inc: { version: 1 } }, { upsert: true, session });
  if (actorId && !await db.collection("user").findOne({ _id: authId(actorId), role: "admin", suspended: { $ne: true } }, { session })) throw adminError("Your Admin access has changed. Sign in again.", 403);
}
