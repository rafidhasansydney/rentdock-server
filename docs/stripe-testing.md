# Stripe sandbox verification

This is an isolated provider-access check. It does not create a rental, reserve equipment, persist a customer payment, or implement webhook fulfillment.

From the Equipment Rental Platform folder in a normal Windows PowerShell:

```powershell
npm.cmd --prefix server run stripe:setup
npm.cmd --prefix server run stripe:check
```

The setup helper temporarily installs the official `@stripe/cli` through npm and runs `stripe sandbox create --from-git --non-interactive` from the server repository. The repository's Git name/email identify the sandbox. Test credentials are saved only in the ignored local `.env` file. The ownership URL and expiry are saved in the ignored `.stripe-sandbox.json` file. Claim the sandbox through its Stripe-hosted ownership URL within seven days, or it expires. Never publish either local file.

Open the Checkout URL printed by `stripe:check`. It creates a USD 1 sandbox test with card payments. Use Stripe test card `4242 4242 4242 4242`, a future expiry and any three-digit CVC. This currency and amount are only a provider diagnostic; they do not settle the marketplace's payment currency.

After completing Checkout, run the exact `stripe:verify` command printed by the diagnostic. It retrieves the same Checkout Session directly from Stripe and checks test mode, amount, currency, metadata, paid state and completion. A redirect alone does not establish successful payment. The localhost return page need not be running for the server-side verification to work.

The full rental payment phase still needs authentication, trusted pricing, atomic date inventory, a hosted Checkout redirect, signed webhooks, retry-safe booking/payment persistence, cancellation/expiry handling and deployed end-to-end testing. Do not expose these diagnostic commands as public API endpoints.

References verified 21 November 2026:

- https://docs.stripe.com/cli/sandbox
- https://docs.stripe.com/cli/install
- https://docs.stripe.com/sandboxes
- https://docs.stripe.com/checkout/fulfillment
- https://docs.stripe.com/testing
