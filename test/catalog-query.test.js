import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalogQuery, validEquipmentId } from "../src/catalog/query.js";

test("catalog filters always restrict approval, escape search patterns and bound pagination", () => {
  const result = parseCatalogQuery({ q: ".* camera [kit]", category: "Photography", minPrice: "100", maxPrice: "2500", availability: "available", sort: "price-asc", page: "2", limit: "12" });
  assert.equal(result.filter.status, "approved");
  assert.equal(result.filter.$or[0].name.$regex, "\\.\\* camera \\[kit\\]");
  assert.deepEqual(result.filter.price, { $gte: 100, $lte: 2500 });
  assert.deepEqual(result.filter.availableQuantity, { $gt: 0 });
  assert.deepEqual(result.sort, { price: 1, _id: 1 });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 12);
});

test("catalog query rejects operator injection, ambiguous values, invalid ranges and oversized pages", () => {
  for (const input of [{ q: { $ne: "" } }, { category: ["Photography"] }, { status: "pending" }, { sort: "__proto__" }, { minPrice: "NaN" }, { minPrice: "2000", maxPrice: "100" }, { limit: "1000" }, { page: "-1" }, { q: "x".repeat(101) }, { availability: "maybe" }]) assert.throws(() => parseCatalogQuery(input));
  assert.equal(validEquipmentId("sony-a7-iv"), true);
  assert.equal(validEquipmentId("../profile"), false);
});
