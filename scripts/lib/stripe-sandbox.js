export function isStripeTestKey(value) {
  return typeof value === "string" && /^(sk|rk|rkcs)_test_[A-Za-z0-9]+$/.test(value);
}

export function readSandboxOutput(output) {
  const cleaned = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end < start) throw new Error("Stripe CLI did not return sandbox JSON.");
  const sandbox = JSON.parse(cleaned.slice(start, end + 1));
  if (!isStripeTestKey(sandbox.secret_key)) throw new Error("Stripe CLI did not return a supported test key.");
  const claim = new URL(sandbox.claim_url);
  if (claim.protocol !== "https:" || claim.hostname !== "dashboard.stripe.com" || !claim.pathname.startsWith("/onboard_sandbox/")) throw new Error("Stripe CLI returned an unexpected sandbox ownership URL.");
  return sandbox;
}

function verifySession(session) {
  if (session.livemode !== false || !/^cs_test_[A-Za-z0-9]+$/.test(session.id ?? "")) throw new Error("Expected a Stripe test Checkout Session.");
  if (session.amount_total !== 100 || session.currency !== "usd" || session.metadata?.purpose !== "rentdock-payment-proof") throw new Error("Checkout Session does not match the isolated USD 1 payment proof.");
  return session;
}

export function createStripeTestClient({ key, request = fetch }) {
  if (!isStripeTestKey(key)) throw new Error("Configure a Stripe sandbox test key first. Live keys are not accepted by this diagnostic.");

  function redact(value) {
    return String(value ?? "").split(key).join("[redacted]")
      .replace(/(?:sk|rk|rkcs|pk)_(?:test|live)_[A-Za-z0-9]+/g, "[redacted]")
      .replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 600);
  }

  async function call(path, body) {
    let response;
    try {
      response = await request(`https://api.stripe.com/v1/${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2026-11-18.endive", ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        body,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    } catch {
      throw new Error("Stripe API could not be reached. Check network access from the normal Windows terminal.");
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const details = payload?.error;
      const fields = [details?.type, details?.code, details?.param].filter(Boolean).map(redact);
      const reason = details?.message ? redact(details.message) : "No structured error details were returned.";
      throw new Error(`Stripe API rejected the test request (HTTP ${response.status}). ${fields.join("; ")}\nStripe reason: ${reason}`);
    }
    return response.json();
  }

  async function createCheckout() {
    const body = new URLSearchParams({
      mode: "payment",
      "allowed_payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": "100",
      "line_items[0][price_data][product_data][name]": "RentDock sandbox payment test",
      "metadata[purpose]": "rentdock-payment-proof",
      success_url: "http://127.0.0.1:3000/?stripe_test_session={CHECKOUT_SESSION_ID}",
      cancel_url: "http://127.0.0.1:3000/",
    });
    const session = verifySession(await call("checkout/sessions", body));
    const checkout = new URL(session.url);
    if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.stripe.com") throw new Error("Stripe returned an unexpected Checkout URL.");
    return session;
  }

  async function verifyPayment(id) {
    if (!/^cs_test_[A-Za-z0-9]+$/.test(id ?? "")) throw new Error("Pass the cs_test_ session ID printed by stripe:check.");
    const session = verifySession(await call(`checkout/sessions/${id}`));
    if (session.id !== id || session.status !== "complete" || session.payment_status !== "paid") throw new Error("This test session is not paid and complete yet.");
    return session;
  }

  return { createCheckout, verifyPayment };
}
