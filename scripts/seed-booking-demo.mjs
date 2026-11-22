import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "../src/config.js";
import { databaseService } from "../src/database.js";
import { createAuthentication } from "../src/auth/authentication.js";
import { createImageUploadService } from "../src/uploads/service.js";
import { createOwnerRepository } from "../src/owner/repository.js";
import { validateOwnerEquipment } from "../src/owner/policy.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

const checkpoint = fileURLToPath(new URL("../.booking-demo.json", import.meta.url));
let demo = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : null;
const save = () => writeFileSync(checkpoint, JSON.stringify(demo, null, 2), { mode: 0o600 });
try {
  if (!config.imgbbApiKey) throw new Error("Configure the imgbb key before preparing the demo listing.");
  const db = await databaseService.connect();
  const authentication = await createAuthentication({ database: db, client: databaseService.getClient() });
  const context = await authentication.auth.$context;
  if (!demo) {
    const suffix = randomUUID();
    const email = `rentdock-demo-owner-${suffix}@example.test`, password = `DemoAb${randomUUID()}`;
    const signed = await authentication.auth.api.signUpEmail({ body: { email, password, name: "RentDock demo owner", image: "https://example.test/demo-owner.png" } });
    demo = { ownerId: signed.user.id, email, password };
    save();
  }
  const owner = await context.internalAdapter.findUserById(demo.ownerId);
  if (!owner || owner.email !== demo.email || !demo.email.startsWith("rentdock-demo-owner-")) throw new Error("The local demo checkpoint needs review before continuing.");
  await context.internalAdapter.updateUser(owner.id, { role: "owner" });
  if (!demo.image) {
    console.log("Uploading the bundled camera image for one clearly labelled demo listing.");
    const uploads = createImageUploadService({ database: databaseService, settings: config });
    const image = await uploads.upload({ bytes: readFileSync(fileURLToPath(new URL("../../client/public/images/camera.png", import.meta.url))), type: "image/png", userId: owner.id, address: "demo-setup" });
    demo.image = image.url; save();
  }
  await context.internalAdapter.updateUser(owner.id, { image: demo.image });
  let listing = demo.equipmentId ? await db.collection("equipment").findOne({ _id: demo.equipmentId, ownerId: owner.id, demoMarker: "rentdock-booking-demo" }) : await db.collection("equipment").findOne({ ownerId: owner.id, name: "Demo photography kit" });
  if (demo.equipmentId && !listing) throw new Error("The recorded demo listing is missing. Review it before creating another.");
  if (!listing) {
    const input = validateOwnerEquipment({ name: "Demo photography kit", description: "A demonstration camera kit for trying the rental booking process. Stripe test payments only; no physical equipment is supplied.", category: "Photography", location: "Dhaka", price: 200, rentalType: "Daily", quantity: 2, condition: "Good", brand: "Demo", model: "Photography kit", image: demo.image, included: ["Illustrative camera and lens"], terms: ["Demonstration listing for Stripe test payments only.", "No physical equipment or delivery is offered."] });
    const created = await createOwnerRepository(databaseService).create(owner, input);
    listing = await db.collection("equipment").findOne({ _id: created.id, ownerId: owner.id });
  }
  await db.collection("equipment").updateOne({ _id: listing._id, ownerId: owner.id }, { $set: { status: "approved", isDemo: true, demoMarker: "rentdock-booking-demo" } });
  demo.equipmentId = listing._id; save();
  console.log("One demo Owner account and an approved BDT 200/day listing are ready. Existing accounts and sample listings were not changed.");
  console.log(`Open ${config.clientOrigin}/equipment/${listing._id}`);
  console.log("Demo credentials stay in ignored server/.booking-demo.json; no password values are displayed.");
} catch (error) {
  console.error("Booking demo setup failed.");
  if (error.bookingError || error.status) console.error("Check image upload availability and retry; completed setup steps are retained locally.");
  else console.error(describeDatabaseFailure(error));
  process.exitCode = 1;
} finally { await databaseService.close(); }
