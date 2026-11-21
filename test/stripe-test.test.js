import test from "node:test";
import assert from "node:assert/strict";
import { createStripeTestClient, isStripeTestKey, readSandboxOutput } from "../scripts/lib/stripe-sandbox.js";

const fixture = { id: "cs_test_proof123", livemode: false, amount_total: 100, currency: "usd", metadata: { purpose: "rentdock-payment-proof" }, url: "https://checkout.stripe.com/c/pay/cs_test_proof123" };

test("payment diagnostic accepts supported sandbox keys and rejects live keys", () => {
  for (const key of ["sk_test_example", "rk_test_example", "rkcs_test_example"]) assert.equal(isStripeTestKey(key), true);
  for (const key of ["sk_live_example", "pk_test_example", "", undefined]) assert.throws(() => createStripeTestClient({ key }), /test key/);
});

test("sandbox output parser checks key type and ownership URL", () => {
  const sandbox = { secret_key: "rkcs_test_example", claim_url: "https://dashboard.stripe.com/onboard_sandbox/example" };
  assert.deepEqual(readSandboxOutput(`Preparing...\n${JSON.stringify(sandbox)}\nDone.`), sandbox);
  assert.throws(() => readSandboxOutput(JSON.stringify({ ...sandbox, secret_key: "sk_live_example" })), /test key/);
  assert.throws(() => readSandboxOutput(JSON.stringify({ ...sandbox, claim_url: "https://other.example/onboard_sandbox/x" })), /ownership URL/);
});

test("Checkout proof uses a fixed price and trusted Stripe origin", async () => {
  const client = createStripeTestClient({ key: "rkcs_test_example", request: async (url, options) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.body.get("line_items[0][price_data][unit_amount]"), "100");
    assert.equal(options.body.get("line_items[0][price_data][currency]"), "usd");
    return { ok: true, json: async () => fixture };
  } });
  assert.equal((await client.createCheckout()).id, fixture.id);
});

test("payment proof rejects unpaid, mismatched and live sessions", async () => {
  for (const session of [fixture, { ...fixture, status: "complete", payment_status: "paid", amount_total: 1 }, { ...fixture, livemode: true }]) {
    const client = createStripeTestClient({ key: "rkcs_test_example", request: async () => ({ ok: true, json: async () => session }) });
    await assert.rejects(client.verifyPayment(fixture.id));
  }
  const client = createStripeTestClient({ key: "rkcs_test_example", request: async () => ({ ok: true, json: async () => ({ ...fixture, status: "complete", payment_status: "paid" }) }) });
  assert.equal((await client.verifyPayment(fixture.id)).payment_status, "paid");
  await assert.rejects(client.verifyPayment("cs_live_other"), /cs_test_/);
});

test("provider and network failures do not echo secrets", async () => {
  const provider = createStripeTestClient({ key: "sk_test_private", request: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "sk_test_private" } }) }) });
  await assert.rejects(provider.createCheckout(), error => /403/.test(error.message) && !/private/.test(error.message));
  const network = createStripeTestClient({ key: "sk_test_private", request: async () => { throw new Error("sk_test_private"); } });
  await assert.rejects(network.createCheckout(), error => /network access/.test(error.message) && !/private/.test(error.message));
});
