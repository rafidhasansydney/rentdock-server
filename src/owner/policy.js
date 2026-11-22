import { categories, rentalTypes } from "../catalog/query.js";
export const conditions = Object.freeze(["New", "Like new", "Good", "Fair"]);
export const listingStatuses = Object.freeze(["pending", "approved", "rejected"]);

export function validateOwnerEquipment(body, { update = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Enter valid equipment details.");
  const allowed = ["name", "description", "category", "location", "price", "rentalType", "quantity", "condition", "brand", "model", "image", "terms", "included", ...(update ? ["version"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Only equipment details can be changed here. Ownership and approval are managed by the platform.");
  const text = (key, min, max) => {
    if (typeof body[key] !== "string" || body[key].trim().length < min || body[key].trim().length > max) throw new Error(`Enter ${key} between ${min} and ${max} characters.`);
    return body[key].trim();
  };
  const result = { name: text("name", 2, 120), description: text("description", 20, 5000), location: text("location", 2, 160), brand: text("brand", 1, 100), model: text("model", 1, 100) };
  if (!categories.includes(body.category) || !rentalTypes.includes(body.rentalType) || !conditions.includes(body.condition)) throw new Error("Choose a listed category, rental period and condition.");
  if (typeof body.price !== "number" || !Number.isFinite(body.price) || body.price <= 0 || body.price > 1e7 || Math.abs(body.price * 100 - Math.round(body.price * 100)) > 1e-7) throw new Error("Enter a positive rental price with at most two decimal places.");
  if (!Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 10000) throw new Error("Enter an available quantity between 1 and 10,000.");
  let image;
  try { image = new URL(body.image); } catch { throw new Error("Upload an equipment photo."); }
  if (image.protocol !== "https:" || image.hostname !== "i.ibb.co" || image.username || image.password || image.href.length > 2048) throw new Error("Use an equipment photo uploaded through the image upload control.");
  for (const [key, required] of [["terms", true], ["included", false]]) {
    const values = body[key] ?? [];
    if (!Array.isArray(values) || values.length > 20 || values.some(value => typeof value !== "string" || value.trim().length < 1 || value.length > 500) || (required && values.length === 0)) throw new Error(`Enter valid ${key}, one per line (up to 20 lines).`);
    result[key] = [...new Set(values.map(value => value.trim()))];
  }
  if (update && (!Number.isSafeInteger(body.version) || body.version < 1)) throw new Error("Reload this listing before making changes.");
  return { ...result, category: body.category, rentalType: body.rentalType, condition: body.condition, price: body.price, quantity: body.quantity, image: image.href, ...(update ? { version: body.version } : {}) };
}

export function parseOwnerQuery(query = {}) {
  if (Object.keys(query).some(key => !["page", "status"].includes(key)) || (query.status && !listingStatuses.includes(query.status))) throw new Error("Choose valid listing filters.");
  const page = Number(query.page || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || (query.page && typeof query.page !== "string")) throw new Error("Choose a valid listing page.");
  return { page, status: query.status || "" };
}
