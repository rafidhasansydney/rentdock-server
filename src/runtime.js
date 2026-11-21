import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { databaseService } from "./database.js";
import { createAuthentication } from "./auth/authentication.js";

export async function startServer({ database = databaseService, port = config.port, host = config.host, drainTimeoutMS = 5000, authenticationFactory = createAuthentication } = {}) {
  let shuttingDown = false;
  let stopping;
  const connectedDatabase = await database.connect();
  let authentication;
  try {
    authentication = authenticationFactory ? await authenticationFactory({ database: connectedDatabase, client: database.getClient?.() }) : undefined;
  } catch (error) {
    await database.close();
    throw error;
  }
  const server = createServer(createApp({ database, authentication, isShuttingDown: () => shuttingDown }));
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
