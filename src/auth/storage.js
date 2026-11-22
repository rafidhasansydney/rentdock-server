import { ObjectId } from "mongodb";
export const databaseUserId = value => /^[a-f0-9]{24}$/i.test(String(value)) ? new ObjectId(String(value)) : value;
export async function touchRole(db, session, id, role) {
  return db.collection("user").findOneAndUpdate({ _id: databaseUserId(id), role, suspended: { $ne: true } }, { $inc: { accessVersion: 1 } }, { session, returnDocument: "after", includeResultMetadata: false });
}
