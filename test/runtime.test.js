import test from "node:test";
import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import { createApp } from "../src/app.js";
import { startServer } from "../src/runtime.js";

function request(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    get({ hostname: "127.0.0.1", port: server.address().port, path, headers }, response => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }));
    }).on("error", reject);
  });
}

test("HTTP liveness survives database failure; readiness reports failure and recovery without credentials", async () => {
  let online = true;
  let draining = false;
  const database = { ping: async () => { if (!online) throw new Error("mongodb://private:password@host"); } };
  const server = createServer(createApp({ database, isShuttingDown: () => draining }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal((await request(server, "/api/ready")).status, 200);
    online = false;
    assert.equal((await request(server, "/api/health")).status, 200);
    const failed = await request(server, "/api/ready");
    assert.equal(failed.status, 503);
    assert.deepEqual(failed.body, { status: "not_ready", database: "unavailable" });
    assert.equal(failed.headers["cache-control"], "no-store");
    assert.doesNotMatch(JSON.stringify(failed.body), /private|password|host/);
    online = true;
    assert.equal((await request(server, "/api/ready")).status, 200);
    draining = true;
    assert.equal((await request(server, "/api/ready")).status, 503);
    assert.equal((await request(server, "/api/missing")).status, 404);
    assert.equal((await request(server, "/api/health", { Origin: "https://untrusted.example" })).status, 403);
  } finally {
    await new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
  }
});

test("runtime waits for database startup and closes the database exactly once", async () => {
  let finishConnection;
  let connects = 0;
  let closes = 0;
  const pending = new Promise(resolve => { finishConnection = resolve; });
  let listening = false;
  const starting = startServer({ port: 0, host: "127.0.0.1", authenticationFactory: null, database: {
    connect: async () => { connects++; await pending; },
    ping: async () => {}, close: async () => { closes++; },
  } }).then(runtime => { listening = true; return runtime; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(connects, 1);
  assert.equal(listening, false);
  finishConnection();
  const runtime = await starting;
  assert.equal((await request(runtime.server, "/api/ready")).status, 200);
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(closes, 1);
  assert.equal(runtime.server.listening, false);
});

test("runtime refuses to start when the database is unavailable", async () => {
  await assert.rejects(startServer({ port: 0, database: {
    connect: async () => { throw new Error("offline"); },
  } }), /offline/);
});

test("runtime releases the database if binding the HTTP port fails", async () => {
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
  let closed = false;
  try {
    await assert.rejects(startServer({ port: occupied.address().port, host: "127.0.0.1", authenticationFactory: null, database: {
      connect: async () => {}, close: async () => { closed = true; },
    } }), { code: "EADDRINUSE" });
    assert.equal(closed, true);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
});
