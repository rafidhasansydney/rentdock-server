import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import Stripe from "stripe";
import { createRentalStripe } from "../src/bookings/stripe.js";
import { createApp } from "../src/app.js";
test("webhook consumes signed raw bytes before JSON parsing and refuses tampering and stale signatures", async () => {
  const key = "whsec_testingonly";
  const sdk = new Stripe("sk_test_testingonly");
  const gateway = createRentalStripe({ stripeSecretKey: "sk_test_testingonly", stripeWebhookSecret: key }, sdk);
  const received = [];
  const server = createServer(createApp({ gateway, bookings: { event: async event => { received.push(event.id); } }, database: { ping: async () => {} } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/payments/webhook`;
  const payload = JSON.stringify({ id: "evt_test", type: "checkout.session.completed", livemode: false, data: { object: {} } });
  async function post(body, timestamp, secret = key) {
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
    return fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signature }, body });
  }
  try {
    assert.equal((await post(payload)).status, 200);
    assert.equal((await post(payload + " ")).status, 400);
    assert.equal((await post(payload, Math.floor(Date.now() / 1000) - 1000)).status, 400);
    assert.equal((await post(payload, undefined, "whsec_wrong")).status, 400);
    assert.deepEqual(received, ["evt_test"]);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
