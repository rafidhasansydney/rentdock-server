import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { databaseService } from "./database.js";
import { createAuthentication } from "./auth/authentication.js";
import { createCatalogRepository } from "./catalog/repository.js";
import { createImageUploadService } from "./uploads/service.js";
import { createBookingRepository } from "./bookings/repository.js";
import { createBookingService } from "./bookings/service.js";
import { createRentalStripe } from "./bookings/stripe.js";
import { createAdministrationRepository } from "./admin/repository.js";

export async function startServer({ database = databaseService, port = config.port, host = config.host, drainTimeoutMS = 5000, authenticationFactory = createAuthentication, gateway = createRentalStripe(config) } = {}) {
  let shuttingDown = false;
  let stopping;
  const connectedDatabase = await database.connect();
  let authentication;
  const catalog = createCatalogRepository(database);
  const uploads = createImageUploadService({ database, settings: config });
  const bookingRepository = createBookingRepository(database);
  const bookings = createBookingService({ repository: bookingRepository, gateway });
  const administration = createAdministrationRepository(database);
  try {
    authentication = authenticationFactory ? await authenticationFactory({ database: connectedDatabase, client: database.getClient?.() }) : undefined;
    if (connectedDatabase?.collection) await catalog.ensureIndexes();
    if (connectedDatabase?.collection) await uploads.ensureIndexes();
    if (connectedDatabase?.collection) await bookingRepository.ensureIndexes();
    if (connectedDatabase?.collection) await administration.ensureIndexes();
  } catch (error) {
    await database.close();
    throw error;
  }
  const server = createServer(createApp({ database, authentication, catalog, uploads, bookings, gateway, administration, isShuttingDown: () => shuttingDown }));
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
