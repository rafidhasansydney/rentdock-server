import test from "node:test";
import assert from "node:assert/strict";
import { validateOwnerEquipment, parseOwnerQuery } from "../src/owner/policy.js";
import { createOwnerRepository, ownerEquipment } from "../src/owner/repository.js";

const input = { name: "Camera kit", description: "A camera kit for weekend photography.", category: "Photography", location: "Dhaka", price: 1200, rentalType: "Daily", quantity: 2, condition: "Good", brand: "Canon", model: "R6", image: "https://i.ibb.co/example/photo.png", terms: ["Return clean"], included: ["Charger"] };
test("owner validation rejects privilege fields, unsafe image origins and invalid inventory", () => {
  assert.equal(validateOwnerEquipment(input).price, 1200);
  for (const change of [{ status: "approved" }, { ownerId: "another" }, { price: 0 }, { price: 1.001 }, { price: "1200" }, { quantity: 1.5 }, { image: "https://i.ibb.co.evil.test/photo.png" }, { image: "https://u:p@i.ibb.co/photo.png" }, { terms: [] }, { category: { $ne: "" } }]) assert.throws(() => validateOwnerEquipment({ ...input, ...change }));
  assert.throws(() => validateOwnerEquipment(input, { update: true }));
  assert.equal(validateOwnerEquipment({ ...input, version: 1 }, { update: true }).version, 1);
  for (const query of [{ ownerId: "other" }, { status: "deleted" }, { page: ["1", "2"] }, { page: "0" }, { status: { $ne: "" } }]) assert.throws(() => parseOwnerQuery(query));
});

test("repository assigns identity and Pending status and guards mutations by owner, version and active rentals", async () => {
  let record;
  const queries = [];
  const collection = {
    insertOne: async value => { record = value; },
    findOneAndUpdate: async (query, update) => { queries.push({ query, update }); return null; },
    updateOne: async query => { queries.push({ query }); return { modifiedCount: 0 }; },
    findOne: async query => { queries.push({ query }); return query.ownerId === "owner-1" ? record : null; },
  };
  const owner = createOwnerRepository({ connect: async () => ({ collection: name => name === "user" ? { findOneAndUpdate: async () => ({ name: "Owner", email: "owner@example.test" }) } : collection }), getClient: () => ({ startSession: () => ({ withTransaction: action => action(), endSession: async () => {} }) }) });
  const saved = await owner.create({ id: "owner-1", name: "Owner", email: "owner@example.test" }, input);
  assert.equal(saved.status, "pending");
  assert.equal(saved.ownerId, "owner-1");
  assert.equal(saved.version, 1);
  assert.equal(saved.availableQuantity, 2);
  assert.equal(saved.available, true);
  assert.ok(!Object.hasOwn(saved, "ownerEmail"));
  assert.ok(!Object.hasOwn(ownerEquipment(record), "activeRentalCount"));
  assert.deepEqual(await owner.update("other-owner", saved.id, { ...input, version: 1 }), { conflict: false });
  const update = queries[0];
  assert.equal(update.query.ownerId, "other-owner");
  assert.equal(update.query._id, saved.id);
  assert.equal(update.query.version, 1);
  assert.equal(update.query.activeRentalCount, 0);
  assert.equal(update.update.$set.status, "pending");
  assert.equal(update.update.$inc.version, 1);
  assert.deepEqual(await owner.remove("owner-1", saved.id, 1), { conflict: true });
  assert.equal(queries[2].query.activeRentalCount, 0);
  assert.equal(queries[2].query.version, 1);
});
