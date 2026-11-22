# Rental booking and payment verification

The marketplace uses BDT. The account holder approved inclusive start/end dates: a same-day rental is one day, Weekly uses whole 7-day blocks and Monthly uses whole 30-day blocks, rounding up incomplete blocks. The server permits 1–90 days with a start within the next year and calculates integer minor-unit totals from the persisted equipment rate. Client-supplied money, identity, status or ownership fields are rejected.

## Local workflow

From the workspace in normal PowerShell:

```powershell
npm.cmd --prefix server run stripe:listen
```

Keep this terminal open. The official pinned Stripe CLI forwards selected test Checkout events to `http://127.0.0.1:5000/api/payments/webhook`. The helper writes its signing key only to ignored `.env`. If the key changes, restart the website terminal; otherwise the running website can continue. The helper never prints key values and stops its own child process tree on Ctrl+C.

In another terminal:

```powershell
npm.cmd run dev
```

For clearly labelled demonstration inventory:

```powershell
npm.cmd --prefix server run booking:demo
```

This creates a dedicated demo Owner, uploads the bundled camera through imgbb and approves one BDT 200/day demo listing through a trusted local setup action. No physical equipment is offered. Existing personal accounts and the six ownerless sample records are left unchanged. Progress and demo credentials are retained in ignored `.booking-demo.json`; do not publish it. Admin role granting and moderation screens are separate required work.

Sign in as a Customer, open the printed listing, select dates/quantity and contact/delivery details, review the total and continue to Stripe. Use test card `4242 4242 4242 4242`, a future expiry and a three-digit CVC. A return URL alone is not payment proof. The server retrieves and validates the Checkout Session and succeeded PaymentIntent before creating a booking/payment.

```powershell
npm.cmd --prefix server run booking:report
```

This retrieves the newest paid demo rental from MongoDB and Stripe. It checks matching identity, session, currency, total, payment intent, exactly one persisted booking/payment and recorded live webhook processing. It does not delete the paid demonstration record.

## Database and provider diagnostics

```powershell
npm.cmd --prefix server run booking:verify
npm.cmd --prefix server run stripe:rental-check
```

`booking:verify` uses real MongoDB transactions and real application HTTP authentication with controlled payment fixtures. It tests concurrent capacity, identity and role isolation, retry deduplication, cancellation, mismatched payment rejection, concurrent signed webhook/return finalization, completion and cleanup. It removes only its own temporary records/accounts and does not contact Stripe.

`stripe:rental-check` creates a real unpaid BDT 1,000 diagnostic Checkout and immediately expires it. It does not reserve database inventory, create a rental or charge a card. Its metadata identifies a currency diagnostic so application webhooks ignore it.

## Inventory and recovery model

- `checkoutAttempts` stores pre-payment holds. `bookings` and `payments` are created only after verified payment in one MongoDB transaction. Unique session/payment-intent identifiers and the attempt ID prevent duplicate fulfillment.
- Equipment writes serialize transactions on the same equipment. Availability uses the maximum concurrent quantity within the requested inclusive dates, rather than adding unrelated rentals on different days. Per-customer locks bound pending holds and repeated creation. Owner mutation guards cover both pending and paid rentals.
- Creation uses a stable Stripe idempotency key and a two-minute database lease. A definitive first creation rejection can compensate only its own leased hold. Network-ambiguous failures and failed retries retain stock until safe provider reconciliation; they never blindly release potentially paid inventory. A persistent ambiguous failure requires operator review before manually releasing its hold.
- Checkout expires after about 35 minutes. Expired local timestamps alone do not release stock: the server retrieves/expires the provider session first. A payment that completed during cancellation is finalized instead of cancelled. Returning from Stripe without paying preserves an option to resume or explicitly cancel.
- Signed raw webhook bytes are verified before JSON parsing. The server retrieves the current provider session even after a valid notification, checks test mode, purpose, mapping, total/currency and succeeded PaymentIntent, then finalizes once. Both webhook delivery and authenticated return/status use the same persistence path.
- Paid rental completion and missed expiry/payment reconciliation also run in bounded batches on booking/rental reads. These are request-driven recovery checks, not a deployed scheduled cron job. Deployment must configure a persistent public webhook endpoint and its own signing key; CLI forwarding is local testing only.

## Verified on 22 November 2026

The account holder ran the MongoDB concurrency/recovery check successfully, completed a BDT 200 test rental in the browser and ran the payment report successfully. The live signed webhook returned HTTP 200, one booking and one payment were persisted, and webhook processing was recorded. The final retry/concurrency check also passed with its temporary data removed.

Browser checks with separate demo Customer/Owner accounts verified the six-field form, BDT 800 for two days/two items, failed-response recovery through My rentals, resumed hosted Checkout, unpaid expiry/cancellation, customer isolation and the paid Owner table. At 320px the modal and rental table remain within the page, with horizontal scrolling inside the table. The separate demo Customer's unpaid attempt was expired; it was never paid.

Final production deployment, real-money activation, durable Stripe sandbox ownership, admin management and dashboard analytics are not covered by this milestone. The current claimable sandbox expires on 28 November 2026. Replacing its API key with a different account does not transfer old provider sessions.

References checked for this implementation:

- https://docs.stripe.com/api/checkout/sessions/create
- https://docs.stripe.com/api/checkout/sessions/expire
- https://docs.stripe.com/checkout/fulfillment.md?ui=full-page
- https://docs.stripe.com/events/manage-webhook-endpoints
- https://www.mongodb.com/docs/drivers/node/current/crud/transactions/
