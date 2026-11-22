import { createAdministrationRepository } from "../src/admin/repository.js";
import { databaseService } from "../src/database.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
const args = process.argv.slice(2);
try {
  if (args.length !== 2 || args[0] !== "--email" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args[1])) throw new Error("Use: npm.cmd --prefix server run admin:setup -- --email your-existing-email@example.com");
  const repository = createAdministrationRepository(databaseService);
  await repository.ensureIndexes();
  const user = await repository.bootstrap(args[1].trim());
  console.log(`Initial Admin ready: ${user.email}. Existing profile and rental/payment records were kept.`);
  console.log("Sign out on RentDock and sign in again with the same Google account to see Admin workspace, All users, All equipment and All rentals.");
} catch (error) {
  console.error(error.adminError || error.message?.startsWith("Use:") ? error.message : "Initial Admin setup could not finish.");
  if (!error.adminError && !error.message?.startsWith("Use:")) console.error(describeDatabaseFailure(error).hint);
  process.exitCode = 1;
} finally { await databaseService.close(); }
