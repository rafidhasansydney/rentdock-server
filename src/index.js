import app from "./app.js";
import { config } from "./config.js";
const server = app.listen(config.port, "127.0.0.1", () => console.log(`RentDock server: http://127.0.0.1:${config.port}`));
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
