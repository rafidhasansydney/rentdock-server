import { config } from "./config.js";
import { startServer } from "./runtime.js";
import { describeDatabaseFailure } from "./database-diagnostics.js";

const startupDeadline = setTimeout(() => {
  console.error("Server startup timed out. Check database access, DNS and the application's outgoing IP.");
  process.exit(1);
}, 25000);

try {
  const runtime = await startServer();
  clearTimeout(startupDeadline);
  console.log("MongoDB connection ready.");
  console.log(`RentDock server: http://${config.host}:${config.port}`);
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 7000);
    deadline.unref();
    try {
      await runtime.stop();
      console.log("RentDock server stopped.");
    } catch {
      console.error("Server shutdown failed.");
      process.exitCode = 1;
    } finally {
      clearTimeout(deadline);
    }
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  clearTimeout(startupDeadline);
  const failure = describeDatabaseFailure(error);
  console.error(`Server startup failed. Diagnostic codes: ${failure.codes.join(", ")}`);
  console.error(error.code === "EADDRINUSE" ? "The configured server port is already in use." : failure.hint);
  process.exitCode = 1;
}
