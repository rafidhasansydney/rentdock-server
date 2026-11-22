import { createServer } from "node:http";
import { config } from "./config.js";
import { databaseService } from "./database.js";
import { createAuthentication } from "./auth/authentication.js";
import { createRentalStripe } from "./bookings/stripe.js";
import { prepareApplication } from "./application.js";

export async function startServer({ database = databaseService, port = config.port, host = config.host, drainTimeoutMS = 5000, authenticationFactory = createAuthentication, gateway = createRentalStripe(config) } = {}) {
  let shuttingDown = false;
  let stopping;
  const { app, authentication } = await prepareApplication({ database, authenticationFactory, gateway, isShuttingDown: () => shuttingDown });
  const server = createServer(app);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await database.close();
    throw error;
  }

  function stop() {
    if (!stopping) {
      shuttingDown = true;
      stopping = (async () => {
        const forceClose = setTimeout(() => server.closeAllConnections(), drainTimeoutMS);
        forceClose.unref();
        try {
          await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
            server.closeIdleConnections();
          });
        } finally {
          clearTimeout(forceClose);
          await database.close();
        }
      })();
    }
    return stopping;
  }

  return { server, stop, authentication };
}
