import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createHostedHandler } from "../src/hosting.js";
import { createApp } from "../src/app.js";
import rootApp from "../app.js";

async function serving(app, action) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await action(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test("hosted entry serves liveness without connecting to MongoDB or opening a listener", async () => {
  await serving(rootApp, async base => {
    const response = await fetch(base + "/api/health");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).service, "rentdock-server");
    assert.equal(response.headers.get("x-powered-by"), null);
  });
});
test("hosted concurrent requests share one initialized application and preserve raw webhook bytes", async () => {
  const app = express();
  let starts = 0;
  const raw = '{ "id": "evt_test", "data": {} }';
  app.use(createHostedHandler(async () => {
    starts++;
    await new Promise(resolve => setImmediate(resolve));
    return { app: createApp({ database: { ping: async () => {} }, gateway: { event: body => { assert.equal(body.toString(), raw); return { id: "evt_test" }; } }, bookings: { event: async event => assert.equal(event.id, "evt_test") } }) };
  }));
  await serving(app, async base => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => fetch(base + "/api/ready")));
    assert.ok(responses.every(response => response.status === 200));
    assert.equal(starts, 1);
    const response = await fetch(base + "/api/payments/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": "test" }, body: raw });
    assert.equal(response.status, 200);
    assert.equal((await fetch(base + "/api/missing")).status, 404);
  });
});
test("hosted startup failure is redacted and a later request retries instead of keeping a rejected startup", async () => {
  const app = express();
  let starts = 0;
  app.use(createHostedHandler(async () => {
    if (++starts === 1) throw new Error("mongodb://private-user:private-password@secret-host");
    return { app: createApp({ database: { ping: async () => {} } }) };
  }));
  await serving(app, async base => {
    const first = await fetch(base + "/api/ready");
    assert.equal(first.status, 503);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await first.text(), /private-user|private-password|secret-host/);
    assert.equal((await fetch(base + "/api/ready")).status, 200);
    assert.equal(starts, 2);
  });
});
