import { readFile } from "node:fs/promises";
import { connectDatabase, closeDatabase } from "../src/database.js";
import { createCatalogRepository } from "../src/catalog/repository.js";
import { databaseService } from "../src/database.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

try {
  const records = JSON.parse(await readFile(new URL("../data/equipment-samples.json", import.meta.url), "utf8"));
  const database = await connectDatabase();
  await createCatalogRepository(databaseService).ensureIndexes();
  const result = await database.collection("equipment").bulkWrite(records.map((record, index) => ({ updateOne: { filter: { _id: record._id }, update: { $setOnInsert: { ...record, createdAt: new Date(Date.now() - index * 1000) } }, upsert: true } })));
  console.log(`Catalog samples ready: ${result.upsertedCount} inserted; existing matching records left unchanged.`);
  console.log("These are illustrative sample listings without a real equipment owner. Owner submissions and bookable listings are separate work.");
} catch (error) {
  console.error(describeDatabaseFailure(error));
  process.exitCode = 1;
} finally { await closeDatabase(); }
