import { createHash } from "node:crypto";
export const activeStates = Object.freeze(["creating", "open", "paid"]);
export const pendingStates = Object.freeze(["creating", "open"]);
export function bookingError(message, status = 400) { return Object.assign(new Error(message), { status, bookingError: true }); }
export function dhakaToday(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
export function dayNumber(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw bookingError("Choose valid rental dates.");
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) throw bookingError("Choose valid rental dates.");
  return stamp / 86400000;
}
export function validateDates(body, today = dhakaToday()) {
  const start = dayNumber(body.startDate), end = dayNumber(body.endDate), current = dayNumber(today);
  if (start < current || start > current + 365 || end < start || end - start >= 90) throw bookingError("Start within the next year and choose a rental of 1 to 90 days, including both dates.");
  if (!Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 10000) throw bookingError("Choose a whole quantity between 1 and 10,000.");
  return { startDate: body.startDate, endDate: body.endDate, quantity: body.quantity };
}
export function validateBooking(body, { checkout = false, today } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bookingError("Enter valid booking details.");
  const allowed = ["equipmentId", "startDate", "endDate", "quantity", ...(checkout ? ["contactNumber", "deliveryAddress", "notes", "requestId", "quoteVersion"] : [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw bookingError("Only rental details can be submitted. Prices and account identity are calculated by the server.");
  if (typeof body.equipmentId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(body.equipmentId)) throw bookingError("Choose valid equipment.");
  const result = { equipmentId: body.equipmentId, ...validateDates(body, today) };
  if (!checkout) return result;
  if (typeof body.contactNumber !== "string" || !/^(?:\+?88)?01[3-9]\d{8}$/.test(body.contactNumber.replace(/[\s()-]/g, ""))) throw bookingError("Enter a valid Bangladesh mobile number.");
  if (typeof body.deliveryAddress !== "string" || body.deliveryAddress.trim().length < 5 || body.deliveryAddress.length > 500) throw bookingError("Enter a delivery address between 5 and 500 characters.");
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 1000)) throw bookingError("Keep additional notes within 1,000 characters.");
  if (!/^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(body.requestId ?? "") || !Number.isSafeInteger(body.quoteVersion) || body.quoteVersion < 1) throw bookingError("Review the current price before continuing to payment.");
  return { ...result, contactNumber: body.contactNumber.replace(/[\s()-]/g, ""), deliveryAddress: body.deliveryAddress.trim(), notes: body.notes?.trim() || "", requestId: body.requestId, quoteVersion: body.quoteVersion };
}
export function rentalPrice(equipment, input) {
  const days = dayNumber(input.endDate) - dayNumber(input.startDate) + 1;
  const blocks = { Daily: 1, Weekly: 7, Monthly: 30 };
  if (!blocks[equipment.rentalType] || !Number.isFinite(equipment.price) || equipment.price <= 0) throw bookingError("This equipment's rental rate is unavailable.", 409);
  const unitAmount = Math.round(equipment.price * 100);
  const periods = Math.ceil(days / blocks[equipment.rentalType]);
  const amountMinor = unitAmount * periods * input.quantity;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1 || amountMinor > 99999999) throw bookingError("This booking exceeds the supported payment amount. Choose fewer days or items.");
  return { days, periods, unitAmount, amountMinor, currency: "bdt", rentalType: equipment.rentalType };
}
export function availableFor(quantity, input, records) {
  const events = new Map();
  const start = dayNumber(input.startDate), end = dayNumber(input.endDate);
  for (const record of records) {
    const first = Math.max(start, dayNumber(record.startDate)), last = Math.min(end, dayNumber(record.endDate));
    if (first > last) continue;
    events.set(first, (events.get(first) || 0) + record.quantity);
    events.set(last + 1, (events.get(last + 1) || 0) - record.quantity);
  }
  let used = 0, maximum = 0;
  for (const [, change] of [...events].sort((a, b) => a[0] - b[0])) { used += change; maximum = Math.max(maximum, used); }
  return Math.max(0, quantity - maximum);
}
export function bookingFingerprint(input) { const { requestId, ...details } = input; void requestId; return createHash("sha256").update(JSON.stringify(details)).digest("hex"); }
export function bookable(equipment) { return equipment && equipment.status === "approved" && !equipment.isSample && typeof equipment.ownerId === "string" && equipment.ownerId.length > 0; }
