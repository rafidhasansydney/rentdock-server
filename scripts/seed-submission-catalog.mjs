import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { databaseService } from "../src/database.js";
import { createAuthentication } from "../src/auth/authentication.js";
import { createImageUploadService } from "../src/uploads/service.js";
import { validateOwnerEquipment } from "../src/owner/policy.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
const checkpoint = fileURLToPath(new URL("../.booking-demo.json", import.meta.url));
const choices = [
  { key: "drill", name: "Demo cordless drill kit", category: "Construction", location: "Mirpur, Dhaka", price: 450, rentalType: "Daily", model: "Cordless drill kit" },
  { key: "projector", name: "Demo portable projector", category: "Electronics", location: "Zindabazar, Sylhet", price: 1200, rentalType: "Daily", model: "HD projector" },
  { key: "speaker", name: "Demo PA speaker", category: "Events", location: "Agrabad, Chattogram", price: 3500, rentalType: "Weekly", model: "Portable PA speaker" },
  { key: "pump", name: "Demo irrigation pump", category: "Agriculture", location: "Shibganj, Bogura", price: 1800, rentalType: "Weekly", model: "Irrigation pump" },
  { key: "van", name: "Demo compact cargo van", category: "Vehicles & Transportation", location: "Uttara, Dhaka", price: 45000, rentalType: "Monthly", model: "Compact cargo van" },
];
try {
  const demo = JSON.parse(readFileSync(checkpoint, "utf8"));
  const db = await databaseService.connect();
  const auth = await createAuthentication({ database: db, client: databaseService.getClient() });
  const owner = await (await auth.auth.$context).internalAdapter.findUserById(demo.ownerId);
  if (!owner || owner.email !== demo.email || owner.role !== "owner" || owner.suspended || !owner.email.startsWith("rentdock-demo-owner-")) throw new Error("The existing demo Owner needs review before adding listings.");
  const images = createImageUploadService({ database: databaseService, settings: config });
  demo.submissionImages ??= {};
  let inserted = 0;
  for (const choice of choices) {
    const id = `rentdock-demo-${choice.key}`, marker = "rentdock-submission-demo";
    const existing = await db.collection("equipment").findOne({ _id: id });
    if (existing) { if (existing.ownerId !== owner.id || existing.demoMarker !== marker) throw new Error("A submission-demo ID is already used by another record."); continue; }
    if (!demo.submissionImages[choice.key]) {
      const image = await images.upload({ bytes: readFileSync(fileURLToPath(new URL(`../../client/public/images/${choice.key}.png`, import.meta.url))), type: "image/png", userId: owner.id, address: "submission-demo-setup" });
      demo.submissionImages[choice.key] = image.url;
      writeFileSync(checkpoint, JSON.stringify(demo, null, 2), { mode: 0o600 });
    }
    const { key, ...details } = choice;
    const input = validateOwnerEquipment({ ...details, description: `Demonstration ${choice.model.toLowerCase()} for exploring rental dates, quantity and Stripe test Checkout. This assignment listing does not provide physical equipment or delivery.`, quantity: 2, condition: "Good", brand: "Demo", image: demo.submissionImages[key], included: [`Illustrative ${choice.model.toLowerCase()}`], terms: ["Demonstration listing for Stripe test payments only.", "No physical equipment, collection or delivery is supplied.", "Rental dates include the start and end day; weekly and monthly blocks are rounded up."] });
    const now = new Date();
    const result = await db.collection("equipment").updateOne({ _id: id, ownerId: owner.id, demoMarker: marker }, { $setOnInsert: { ...input, _id: id, ownerId: owner.id, ownerName: owner.name, ownerEmail: owner.email, status: "approved", isSample: false, isDemo: true, demoMarker: marker, featured: true, availableQuantity: input.quantity, activeRentalCount: 0, version: 1, imageAlt: input.name, createdAt: now, updatedAt: now } }, { upsert: true });
    inserted += result.upsertedCount;
  }
  await db.collection("equipment").updateOne({ _id: demo.equipmentId, ownerId: owner.id, demoMarker: "rentdock-booking-demo", status: "approved" }, { $set: { featured: true } });
  console.log(`Submission catalog ready: ${inserted} new Owner-backed demo listings. Existing matching listings, accounts and paid rentals were kept.`);
  console.log("Six categories now have bookable demonstration listings, including the existing BDT 200/day camera. No bookings, revenue or reviews were invented.");
} catch (error) {
  console.error("Submission catalog setup did not complete.");
  console.error(error.message?.includes("demo") || error.message?.includes("record") ? error.message : describeDatabaseFailure(error).hint);
  process.exitCode = 1;
} finally { await databaseService.close(); }
