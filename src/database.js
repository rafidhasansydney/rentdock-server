import { MongoClient } from "mongodb";
import { config } from "./config.js";

export function createDatabaseService({ uri, name, createClient = (value, options) => new MongoClient(value, options) }) {
  let client;
  let connection;
  let closing;

  async function connect() {
    if (closing) await closing;
    if (!uri) throw new Error("MONGODB_URI is missing from server/.env.");
    if (!connection) {
      const candidate = createClient(uri, {
        appName: "rentdock-server",
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        timeoutMS: 5000,
      });
      client = candidate;
      connection = Promise.resolve().then(async () => {
        await candidate.connect();
        const database = candidate.db(name);
        await database.command({ ping: 1 });
        return database;
      }).catch(async error => {
        await candidate.close().catch(() => {});
        client = undefined;
        connection = undefined;
        throw new Error("MongoDB connection failed. Check database credentials, Atlas Network Access and your internet connection.", { cause: error });
      });
    }
    return connection;
  }

  async function ping() {
    const database = await connect();
    await database.command({ ping: 1 }, { timeoutMS: 3000 });
  }

  function close() {
    if (!closing) {
      closing = (async () => {
        try {
          await connection?.catch(() => {});
          await client?.close();
        } finally {
          client = undefined;
          connection = undefined;
          closing = undefined;
        }
      })();
    }
    return closing;
  }

  return Object.freeze({ connect, ping, close });
}

export const databaseService = createDatabaseService({ uri: config.mongoUri, name: config.mongoDb });
export const connectDatabase = databaseService.connect;
export const closeDatabase = databaseService.close;
