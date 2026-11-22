import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../src/app.js";
import { createImageUploadService, validateImage, maxImageBytes } from "../src/uploads/service.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=", "base64");
function fixture({ request, collision = false } = {}) {
  const limits = new Map();
  const saved = [];
  let collided = false;
  const database = { connect: async () => ({ collection: name => name === "uploadLimits" ? {
    findOneAndUpdate: async (query, update, options) => {
      if (collision && !collided && options.upsert) { collided = true; limits.set(query._id, { count: 1 }); throw Object.assign(new Error("duplicate"), { code: 11000 }); }
      const row = limits.get(query._id) ?? { count: 0 };
      row.count += update.$inc.count;
      limits.set(query._id, row);
      return { ...row };
    },
  } : { insertOne: async record => { saved.push(record); } } }) };
  return { service: createImageUploadService({ database, settings: { imgbbApiKey: "private-provider-key" }, clock: () => 1000000, request: request ?? (async () => ({ ok: true, json: async () => ({ success: true, data: { url: "https://i.ibb.co/sample/photo.png", delete_url: "private-delete-url" } }) })) }), saved };
}
test("image validation rejects HTML, mismatched MIME, SVG and oversized files", () => {
  assert.equal(validateImage(png, "image/png"), "image/png");
  for (const [bytes, type] of [[Buffer.from("<html>".repeat(20)), "image/png"], [png, "image/jpeg"], [Buffer.alloc(maxImageBytes + 1), "image/png"], [Buffer.from("<svg>".repeat(20)), "image/svg+xml"]]) assert.throws(() => validateImage(bytes, type));
});
test("upload keeps provider key in POST body and excludes provider deletion credentials", async () => {
  const { service, saved } = fixture({ collision: true, request: async (url, options) => {
    assert.equal(url, "https://api.imgbb.com/1/upload");
    assert.equal(options.body.get("key"), "private-provider-key");
    assert.equal(options.body.get("image").type, "image/png");
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ success: true, data: { url: "https://i.ibb.co/sample/photo.png", delete_url: "private-delete-url" } }) };
  } });
  const result = await service.upload({ bytes: png, type: "image/png", address: "127.0.0.1" });
  assert.equal(result.url, "https://i.ibb.co/sample/photo.png");
  assert.deepEqual(Object.keys(result).sort(), ["id", "url"]);
  assert.equal(saved.length, 1);
  assert.ok(!JSON.stringify(saved).includes("private-"));
});
test("anonymous uploads have a persistent limit and provider failures are redacted", async () => {
  const { service } = fixture();
  const args = { bytes: png, type: "image/png", address: "127.0.0.1" };
  for (let i = 0; i < 6; i++) await service.upload(args);
  await assert.rejects(service.upload(args), error => error.status === 429);
  for (const request of [async () => { throw new Error("private-provider-key"); }, async () => ({ ok: true, json: async () => ({ success: true, data: { url: "https://evil.test/photo.png" } }) })]) await assert.rejects(fixture({ request }).service.upload(args), error => error.status === 502 && !error.message.includes("private-"));
});
test("HTTP upload configuration exposes no key and binary registration upload validates type and size", async () => {
  const { service } = fixture();
  const server = createServer(createApp({ uploads: service, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/uploads`;
  try {
    const config = await (await fetch(`${url}/config`)).json();
    assert.equal(config.enabled, true);
    assert.ok(!JSON.stringify(config).includes("private-provider-key"));
    assert.equal((await fetch(`${url}/image`, { method: "POST", headers: { "Content-Type": "image/png" }, body: png })).status, 201);
    assert.equal((await fetch(`${url}/image`, { method: "POST", headers: { "Content-Type": "text/html" }, body: "invalid" })).status, 400);
    assert.equal((await fetch(`${url}/image`, { method: "POST", headers: { "Content-Type": "image/png" }, body: Buffer.alloc(maxImageBytes + 1) })).status, 413);
    assert.equal((await fetch(`${url}/image`, { method: "POST", headers: { "Content-Type": "image/png", Authorization: "Bearer invalid" }, body: png })).status, 503);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
