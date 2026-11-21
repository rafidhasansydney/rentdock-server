export const categories = Object.freeze(["Photography", "Construction", "Electronics", "Events", "Agriculture", "Vehicles & Transportation"]);
export const rentalTypes = Object.freeze(["Daily", "Weekly", "Monthly"]);
const sorts = { newest: { createdAt: -1, _id: 1 }, "price-asc": { price: 1, _id: 1 }, "price-desc": { price: -1, _id: 1 } };
export function parseCatalogQuery(query = {}) {
  const allowed = ["q", "category", "location", "type", "availability", "minPrice", "maxPrice", "sort", "page", "limit"];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== "string" || value.length > 100) throw new Error("Choose valid equipment filters.");
  }
  const values = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, value.trim()]));
  if (values.category && !categories.includes(values.category)) throw new Error("Choose a listed category.");
  if (values.type && !rentalTypes.includes(values.type)) throw new Error("Choose a valid rental period.");
  if (values.availability && !["available", "unavailable"].includes(values.availability)) throw new Error("Choose valid availability.");
  if (values.sort && !Object.hasOwn(sorts, values.sort)) throw new Error("Choose a listed sort order.");
  const filter = { status: "approved" };
  const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (values.q) filter.$or = ["name", "category", "location"].map(field => ({ [field]: { $regex: literal(values.q), $options: "i" } }));
  if (values.category) filter.category = values.category;
  if (values.location) filter.location = { $regex: literal(values.location), $options: "i" };
  if (values.type) filter.rentalType = values.type;
  if (values.availability) filter.availableQuantity = values.availability === "available" ? { $gt: 0 } : 0;
  for (const [key, operator] of [["minPrice", "$gte"], ["maxPrice", "$lte"]]) {
    if (values[key]) {
      const price = Number(values[key]);
      if (!Number.isFinite(price) || price < 0 || price > 1e9) throw new Error("Enter a valid rental price.");
      filter.price = { ...filter.price, [operator]: price };
    }
  }
  if (filter.price?.$gte > filter.price?.$lte) throw new Error("Minimum price cannot exceed maximum price.");
  const page = Number(values.page || 1);
  const limit = Number(values.limit || 12);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 24) throw new Error("Choose a valid results page.");
  return { filter, sort: sorts[values.sort || "newest"], page, limit };
}
export function validEquipmentId(id) { return typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(id); }
