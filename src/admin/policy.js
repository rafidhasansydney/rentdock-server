import { roles } from "../auth/policy.js";
import { validateOwnerEquipment } from "../owner/policy.js";
export function adminError(message, status = 400) { return Object.assign(new Error(message), { adminError: true, status }); }
export const visibleStatuses = ["pending", "approved", "rejected"];
export function managementVersion(value) { if (!Number.isSafeInteger(value) || value < 0) throw adminError("Reload this record before making changes."); return value; }
export const versionFilter = (field, value) => ({ $expr: { $eq: [{ $ifNull: [`$${field}`, 0] }, value] } });
export function adminQuery(query, kind) {
  const fields = { users: ["page", "q", "role", "state"], equipment: ["page", "q", "status"], rentals: ["page", "q", "status"] }[kind];
  if (!fields || Object.keys(query).some(key => !fields.includes(key)) || Object.values(query).some(value => typeof value !== "string")) throw adminError("Choose valid filters.");
  const page = Number(query.page || 1), q = query.q?.trim() || "";
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || q.length > 100) throw adminError("Choose a valid page and a search up to 100 characters.");
  const status = query.status || "", role = query.role || "", state = query.state || "";
  if (role && !roles.includes(role)) throw adminError("Choose a valid account role.");
  if (state && !["active", "suspended"].includes(state)) throw adminError("Choose a valid account state.");
  if (status && !(kind === "equipment" ? visibleStatuses : ["confirmed", "ongoing", "completed"]).includes(status)) throw adminError("Choose a valid status.");
  return { page, q, status, role, state };
}
export function literalSearch(q, fields) { return q ? { $or: fields.map(field => ({ [field]: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } })) } : {}; }
function bodyOnly(body, allowed) { if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw adminError("Enter valid changes using only the displayed fields."); }
export function userChanges(body) {
  bodyOnly(body, ["role", "suspended", "version"]);
  if (!roles.includes(body.role) || typeof body.suspended !== "boolean") throw adminError("Choose an account role and access state.");
  return { role: body.role, suspended: body.suspended, version: managementVersion(body.version) };
}
export function moderation(body) {
  bodyOnly(body, ["status", "reason", "version"]);
  if (!visibleStatuses.includes(body.status) || typeof (body.reason ?? "") !== "string" || (body.reason?.length ?? 0) > 500 || (body.status === "rejected" && (!body.reason || body.reason.trim().length < 5))) throw adminError("Choose a status and give rejected listings a reason between 5 and 500 characters.");
  return { status: body.status, reason: body.reason?.trim() || "", version: managementVersion(body.version) };
}
export function adminEquipment(body) { try { const version = managementVersion(body?.version); return { ...validateOwnerEquipment({ ...body, version: version || 1 }, { update: true }), version }; } catch (error) { throw adminError(error.message); } }
export function rentalChanges(body) {
  bodyOnly(body, ["action", "note", "version"]);
  if (!["start", "complete", "note"].includes(body.action) || typeof (body.note ?? "") !== "string" || (body.note?.length ?? 0) > 500) throw adminError("Choose a rental action and a note up to 500 characters.");
  return { action: body.action, note: body.note?.trim() || "", version: managementVersion(body.version) };
}
export function protectUser(actorId, target, input, activeAdmins, hasEquipment, hasHolds) {
  if (String(target._id) === actorId) throw adminError("Ask another Admin to change your access. You cannot change or suspend your own account here.", 409);
  if (target.role === "admin" && !target.suspended && (input.role !== "admin" || input.suspended) && activeAdmins <= 1) throw adminError("At least one active Admin must remain.", 409);
  if (target.role !== input.role && (hasEquipment || hasHolds)) throw adminError("Finish or cancel open checkouts and archive the Owner's listings before changing this role. Existing paid rental history is kept.", 409);
}
