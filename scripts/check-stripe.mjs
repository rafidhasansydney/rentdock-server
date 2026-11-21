import "../src/config.js";
import { createStripeTestClient } from "./lib/stripe-sandbox.js";

try {
  const client = createStripeTestClient({ key: process.env.STRIPE_SECRET_KEY });
  const id = process.argv[2];
  if (id) {
    const session = await client.verifyPayment(id);
    console.log(`Stripe verified the sandbox payment: ${session.id}; USD 1.00; paid and complete.`);
    console.log("This verifies a provider test payment only. Rental booking, webhook finalization and payment persistence are separate pending features.");
  } else {
    const session = await client.createCheckout();
    console.log("Stripe test Checkout created for USD 1.00. This is an isolated provider test, not a rental booking or the final marketplace currency.");
    console.log(`Session ID: ${session.id}`);
    console.log(`Open this test Checkout URL: ${session.url}`);
    console.log("Use test card 4242 4242 4242 4242 with any future expiry and any 3-digit CVC. Do not use a real card.");
    console.log(`After payment: npm.cmd --prefix server run stripe:verify -- ${session.id}`);
    console.log("The localhost return page is optional for this test; verify the session with the command even if no frontend server is running.");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
