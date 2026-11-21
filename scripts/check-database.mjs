import { connectDatabase, closeDatabase } from "../src/database.js";
import { verifyDatabaseRoundTrip } from "../src/database-probe.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";

const deadline = setTimeout(() => {
  console.error("Database verification timed out. Check Node's outgoing IP, Atlas access and DNS.");
  process.exit(1);
}, 25000);

try {
  const database = await connectDatabase();
  console.log("MongoDB connection successful. Database ping passed.");
  if (process.argv.includes("--write")) {
    await verifyDatabaseRoundTrip(database);
    console.log("Database insert, read, update and delete passed. Temporary record removed.");
  }
} catch (error) {
  const failure = describeDatabaseFailure(error);
  console.error("Database verification failed.");
  console.error(`Diagnostic codes: ${failure.codes.join(", ")}`);
  console.error(failure.hint);
  process.exitCode = 1;
} finally {
  await closeDatabase();
  clearTimeout(deadline);
}
