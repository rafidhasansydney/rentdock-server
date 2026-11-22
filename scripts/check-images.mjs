import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { validateImage } from "../src/uploads/service.js";

try {
  if (!config.imgbbApiKey) throw new Error("Image upload key is not configured in server/.env.");
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64");
  const body = new FormData();
  body.append("key", config.imgbbApiKey);
  body.append("expiration", "60");
  body.append("image", new Blob([bytes], { type: "image/png" }), "rentdock-upload-check.png");
  const response = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Image provider rejected the test (HTTP ${response.status}). Check API key validity.`);
  const result = await response.json();
  const url = new URL(result.data?.url);
  assert.ok(result.success && url.protocol === "https:" && url.hostname === "i.ibb.co" && !url.username && !url.password);
  const image = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20000) });
  assert.ok(image.ok);
  validateImage(Buffer.from(await image.arrayBuffer()), "image/png");
  console.log("PASS real imgbb upload and public image readback. The diagnostic image expires after 60 seconds.");
  console.log("This verifies provider connectivity. Save and reload a gallery photo in the app to finish the profile upload walkthrough.");
} catch (error) {
  const message = error.message;
  console.error(message.startsWith("Image provider rejected") || message.startsWith("Image upload key") ? message : "Image upload check failed. Check internet access and API key validity; no key values are displayed.");
  process.exitCode = 1;
}
