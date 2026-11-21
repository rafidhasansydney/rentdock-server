import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseService } from "../src/database.js";
import { describeDatabaseFailure } from "../src/database-diagnostics.js";
import { verifyDatabaseRoundTrip } from "../src/database-probe.js";

test("connection settings are accepted by the installed MongoDB driver without obsolete-timeout warnings", async () => {
  const { MongoClient } = await import("mongodb");
  const warnings = [];
  const collect = warning => { if (/timeoutMS/.test(warning.message)) warnings.push(warning.message); };
  process.on("warning", collect);
  const service = createDatabaseService({ uri: "mongodb://127.0.0.1:27017", name: "rentdock", createClient: (uri, options) => {
    const actualClient = new MongoClient(uri, options);
    return { connect: async () => {}, close: () => actualClient.close(), db: () => ({ command: async () => ({ ok: 1 }) }) };
  } });
  try {
    await service.connect();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(warnings, []);
  } finally {
    await service.close();
    process.off("warning", collect);
  }
});

test("concurrent database callers share a pool; close permits a fresh connection", async () => {
  let created = 0;
  let closed = 0;
  const database = { command: async () => ({ ok: 1 }) };
  const service = createDatabaseService({ uri: "mongodb://example", name: "rentdock", createClient: () => {
    created++;
    return { connect: async () => {}, db: () => database, close: async () => { closed++; } };
  } });
  const results = await Promise.all([service.connect(), service.connect(), service.connect()]);
  assert.ok(results.every(value => value === database));
  assert.equal(created, 1);
  await Promise.all([service.close(), service.close()]);
  assert.equal(closed, 1);
  await service.connect();
  assert.equal(created, 2);
  await service.close();
});

test("a failed initial connection releases its pool and the next attempt can recover", async () => {
  let created = 0;
  let closed = 0;
  const service = createDatabaseService({ uri: "mongodb://example", name: "rentdock", createClient: () => {
    const attempt = ++created;
    return {
      connect: async () => { if (attempt === 1) throw Object.assign(new Error("private-provider-details"), { code: "ECONNREFUSED" }); },
      db: () => ({ command: async () => ({ ok: 1 }) }),
      close: async () => { closed++; },
    };
  } });
  await assert.rejects(service.connect(), /MongoDB connection failed/);
  assert.equal(closed, 1);
  await service.connect();
  await service.close();
  assert.equal(created, 2);
  assert.equal(closed, 2);
});

test("readiness detects a lost connection and a recovered connection", async () => {
  let reachable = true;
  const service = createDatabaseService({ uri: "mongodb://example", name: "rentdock", createClient: () => ({
    connect: async () => {}, close: async () => {}, db: () => ({ command: async () => {
      if (!reachable) throw new Error("offline");
      return { ok: 1 };
    } }),
  }) });
  await service.ping();
  reachable = false;
  await assert.rejects(service.ping(), /offline/);
  reachable = true;
  await service.ping();
  await service.close();
});

test("diagnostics retain nested error codes without exposing provider messages", () => {
  const inner = Object.assign(new Error("mongodb://user:secret@example"), { code: "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR" });
  const error = Object.assign(new Error("private"), { reason: { servers: new Map([["host", { error: inner }]]) } });
  const diagnostic = describeDatabaseFailure(error);
  assert.ok(diagnostic.codes.includes("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR"));
  assert.match(diagnostic.hint, /outgoing IP/);
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret|private|mongodb:\/\//);
});

test("write probe modifies and deletes only its own diagnostic document", async () => {
  const documents = new Map([["existing", { _id: "existing", stage: "untouched" }]]);
  const collection = {
    insertOne: async doc => { documents.set(doc._id, doc); },
    findOne: async query => documents.get(query._id),
    updateOne: async (query, update) => {
      Object.assign(documents.get(query._id), update.$set);
      return { matchedCount: 1 };
    },
    deleteOne: async query => ({ deletedCount: Number(documents.delete(query._id)) }),
  };
  await verifyDatabaseRoundTrip({ collection: name => { assert.equal(name, "_connection_checks"); return collection; } });
  assert.deepEqual([...documents.values()], [{ _id: "existing", stage: "untouched" }]);
});

test("write probe cleans its document even when readback fails", async () => {
  const documents = new Map();
  const collection = {
    insertOne: async doc => { documents.set(doc._id, doc); },
    findOne: async () => { throw new Error("read failed"); },
    deleteOne: async query => { documents.delete(query._id); },
  };
  await assert.rejects(verifyDatabaseRoundTrip({ collection: () => collection }), /read failed/);
  assert.equal(documents.size, 0);
});
