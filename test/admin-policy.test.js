import test from "node:test";
import assert from "node:assert/strict";
import { adminQuery, literalSearch, userChanges, moderation, rentalChanges, protectUser, adminEquipment } from "../src/admin/policy.js";
import { analyticsMonths } from "../src/admin/analytics.js";
import { managedUser } from "../src/admin/repository.js";
import { publicRental } from "../src/bookings/repository.js";
test("management validates bounded literal filters and refuses operator injection or hidden write fields", () => {
  assert.equal(adminQuery({ q: " (camera).* ", page: "2", status: "pending" }, "equipment").q, "(camera).*");
  assert.equal(literalSearch("(camera).*", ["name"]).$or[0].name.$regex, "\\(camera\\)\\.\\*");
  for (const query of [{ ownerId: "other" }, { q: { $ne: "" } }, { page: "0" }, { page: "100001" }, { status: "deleted" }]) assert.throws(() => adminQuery(query, "equipment"));
  assert.throws(() => userChanges({ role: "admin", suspended: false, version: 0, password: "hidden" }));
  assert.throws(() => userChanges({ role: "admin", suspended: "false", version: 0 }));
  assert.throws(() => moderation({ status: "rejected", reason: "no", version: 0 }));
  assert.throws(() => rentalChanges({ action: "refund", version: 0 }));
  assert.throws(() => rentalChanges({ action: "note", amountMinor: 0, version: 0 }));
  assert.throws(() => adminEquipment({ version: 0, ownerId: "another" }));
});
test("self changes, final active Admin removal and roles with live inventory or checkout holds are protected", () => {
  const admin = { _id: "target", role: "admin", suspended: false };
  assert.throws(() => protectUser("target", admin, { role: "customer", suspended: false }, 2, false, false));
  assert.throws(() => protectUser("other", admin, { role: "customer", suspended: false }, 1, false, false));
  assert.throws(() => protectUser("other", admin, { role: "admin", suspended: true }, 1, false, false));
  assert.doesNotThrow(() => protectUser("other", admin, { role: "customer", suspended: false }, 2, false, false));
  for (const [hasEquipment, hasHolds] of [[true, false], [false, true]]) assert.throws(() => protectUser("other", { _id: "owner", role: "owner" }, { role: "customer" }, 2, hasEquipment, hasHolds));
  assert.doesNotThrow(() => protectUser("other", { _id: "owner", role: "owner" }, { role: "owner", suspended: true }, 2, true, false));
});
test("Admin user data excludes credentials and internal notes stay out of Customer and Owner rentals", () => {
  assert.deepEqual(Object.keys(managedUser({ _id: "one", name: "Name", email: "name@example.test", role: "customer", password: "hidden", phone: "private", address: "private" })).sort(), ["id", "name", "email", "role", "suspended", "createdAt", "version"].sort());
  const rental = publicRental({ _id: "rental", customerId: "customer", ownerId: "owner", bookingStatus: "ongoing", startDate: "2026-11-01", endDate: "2026-11-02", adminNote: "private", adminVersion: 1, managedBy: "admin", managedAt: new Date() }, "2026-11-03");
  assert.equal(rental.bookingStatus, "completed");
  for (const key of ["adminNote", "adminVersion", "managedBy", "managedAt", "customerId", "ownerId"]) assert.equal(Object.hasOwn(rental, key), false);
});
test("monthly analytics uses Bangladesh month boundaries and fills six consecutive months over year rollover", () => {
  assert.deepEqual(analyticsMonths(new Date("2026-12-31T18:00:00Z")), ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  assert.equal(analyticsMonths(new Date("2026-12-31T17:59:59Z")).at(-1), "2026-12");
});
