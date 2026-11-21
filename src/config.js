import { config as loadEnvironment } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnvironment({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
const port = Number(process.env.PORT ?? 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
const clientUrl = process.env.CLIENT_URL ?? "http://127.0.0.1:3000";
const parsedClientUrl = new URL(clientUrl);
if (!["http:", "https:"].includes(parsedClientUrl.protocol)) throw new Error("CLIENT_URL must be an HTTP or HTTPS URL.");
export const config = Object.freeze({ port, clientOrigin: parsedClientUrl.origin, nodeEnv: process.env.NODE_ENV ?? "development" });
