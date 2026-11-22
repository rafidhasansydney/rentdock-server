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

export async function prepareApplication({ database = databaseService, authenticationFactory = createAuthentication, gateway = createRentalStripe(config), isShuttingDown = () => false } = {}) {
  const connectedDatabase = await database.connect();
  const catalog = createCatalogRepository(database);
  const uploads = createImageUploadService({ database, settings: config });
  const bookingRepository = createBookingRepository(database);
  const bookings = createBookingService({ repository: bookingRepository, gateway });
  const administration = createAdministrationRepository(database);
  try {
    const authentication = authenticationFactory ? await authenticationFactory({ database: connectedDatabase, client: database.getClient?.() }) : undefined;
    if (connectedDatabase?.collection) {
      await catalog.ensureIndexes();
      await uploads.ensureIndexes();
      await bookingRepository.ensureIndexes();
      await administration.ensureIndexes();
    }
    return { app: createApp({ database, authentication, catalog, uploads, bookings, gateway, administration, isShuttingDown }), authentication };
  } catch (error) { await database.close(); throw error; }
}
