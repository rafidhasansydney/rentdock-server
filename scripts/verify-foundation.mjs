import assert from "node:assert/strict";
import { databaseService } from "../src/database.js";
import { verifyDatabaseRoundTrip } from "../src/database-probe.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
import { startServer } from "../src/runtime.js";

const deadline = setTimeout(() => {
  console.error("Foundation verification timed out. Check database access and Node's actual outgoing IP.");
  process.exit(1);
}, 35000);
let runtime;
try {
  const database = await databaseService.connect();
  console.log("PASS MongoDB connection and authentication");
  await verifyDatabaseRoundTrip(database);
  console.log("PASS isolated insert/read/update/delete; diagnostic record removed");
  runtime = await startServer({ port: 0, host: "127.0.0.1" });
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  console.log("PASS server liveness endpoint");
  const ready = await fetch(`${base}/api/ready`, { signal: AbortSignal.timeout(5000) });
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { status: "ready", database: "ok" });
  console.log("PASS live database readiness endpoint");
  const unknown = await fetch(`${base}/api/not-a-route`, { signal: AbortSignal.timeout(5000) });
  assert.equal(unknown.status, 404);
  await unknown.arrayBuffer();
  console.log("PASS unknown API route returns 404");
  await runtime.stop();
  assert.equal(runtime.server.listening, false);
  console.log("PASS graceful HTTP and database shutdown");
  console.log("Foundation live verification passed.");
} catch (error) {
  const failure = describeDatabaseFailure(error);
  console.error(`Foundation verification failed. Diagnostic codes: ${failure.codes.join(", ")}`);
  console.error(failure.hint);
  process.exitCode = 1;
} finally {
  try {
    if (runtime) await runtime.stop();
    else await databaseService.close();
  } catch {
    console.error("Foundation cleanup could not be completed.");
    process.exitCode = 1;
  }
  clearTimeout(deadline);
}
