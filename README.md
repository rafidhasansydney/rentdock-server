# RentDock API — Equipment Rental Platform

The Express and MongoDB backend for RentDock, an equipment rental marketplace for Bangladesh. It manages accounts, role-based access, equipment approvals, date-based inventory, Stripe test Checkout, rental records and dashboard analytics.

**[Live website](https://rentdock-client.vercel.app)** · **[API health](https://rentdock-server.vercel.app/api/health)** · **[Database readiness](https://rentdock-server.vercel.app/api/ready)** · **[Client repository](https://github.com/rafidhasansydney/rentdock-client)**

API origin: **https://rentdock-server.vercel.app**. Application endpoints are under `/api`; the server root is not a website route.

## Main capabilities

- Better Auth with the MongoDB adapter, email/password and Google sign-in, secure sessions and signed JWTs.
- Fresh session and current-role checks through `verifyToken`, `verifyRenter`, `verifyOwner` and `verifyAdmin` middleware.
- Approved-only public discovery, bounded featured/recent queries, backend search/filter/sort and pagination.
- Persistent favorites and editable profiles scoped to the signed-in account.
- Validated imgbb uploads with image signature checks, size limits and server-only provider credentials.
- Owner-scoped equipment submission, editing, private preview and soft deletion. New listings and Owner edits require approval.
- Admin user access management, listing moderation, rental monitoring and an audit trail.
- Transactional availability reservations, trusted prices, idempotent Checkout requests and verified payment finalization.
- Admin platform analytics and Owner-scoped earnings, with six monthly buckets in Bangladesh time.

## Packages

| Package | Version | Purpose |
| --- | --- | --- |
| Express | 5.3.0 | HTTP API and route middleware |
| MongoDB | 7.9.1 | Connection pooling, queries, indexes and transactions |
| Better Auth | 1.7.27 | Authentication, sessions and JWT integration |
| `@better-auth/mongo-adapter` | 1.7.27 | MongoDB authentication persistence |
| `jose` | 6.2.18 | JWT signature, issuer, audience and session verification |
| Stripe | 23.2.0 | Test Checkout, payment verification and signed webhooks |
| `cors` | 2.8.6 | Explicit frontend-origin access |
| `dotenv` | 17.4.2 | Local environment loading |

The API uses JavaScript ES modules and Node's built-in test runner.

## Local setup

Use **Node.js 22.x**, npm and a MongoDB deployment that supports transactions, such as Atlas.

```bash
git clone https://github.com/rafidhasansydney/rentdock-server.git
cd rentdock-server
npm ci
```

Copy `.env.example` to `.env` and fill the values below. Never commit the populated file.

| Variable | Description |
| --- | --- |
| `PORT` | Local API port; default `5000` |
| `CLIENT_URL` | Frontend origin, such as `http://127.0.0.1:3000` |
| `MONGODB_URI` | Atlas/replica-set connection string |
| `MONGODB_DB` | Database name; default `rentdock` |
| `BETTER_AUTH_SECRET` | Authentication secret of at least 32 characters |
| `BETTER_AUTH_URL` | Frontend origin followed by `/api/auth` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Web OAuth client credentials |
| `IMGBB_API_KEY` | Image upload provider key |
| `STRIPE_SECRET_KEY` | Stripe **test** secret key; live keys are rejected |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the endpoint receiving notifications |
| `NODE_ENV` | `development` locally; production is configured by hosting |

```bash
npm run db:check
npm run dev
```

Run the client separately on **http://127.0.0.1:3000**. Windows PowerShell users can use `npm.cmd` if `npm.ps1` is blocked.

### Google authentication

Configure a Web OAuth client with the frontend origin and callback:

| Environment | JavaScript origin | Redirect URI |
| --- | --- | --- |
| Local | `http://127.0.0.1:3000` | `http://127.0.0.1:3000/api/auth/callback/google` |
| Deployed | `https://rentdock-client.vercel.app` | `https://rentdock-client.vercel.app/api/auth/callback/google` |

New users receive the Customer role. Email verification and forgotten-password flows are intentionally excluded from the assignment.

### Initial Admin

On a fresh database, sign in through the website first, then grant the first Admin role from a trusted local terminal:

```bash
npm run admin:setup -- --email your-existing-account@example.com
```

The command refuses to replace an already configured active Admin. Sign in again afterward. Subsequent roles and suspension are managed through All users. An Admin with a Google-only account can add initial email/password sign-in from My profile; an existing password cannot be overwritten through that setup form.

## API overview

| Endpoints | Access and purpose |
| --- | --- |
| `GET /api/health`, `GET /api/ready` | Liveness and live database readiness |
| `/api/auth/*`, `GET /api/auth-config` | Better Auth endpoints and public feature availability |
| `GET /api/equipment`, `GET /api/equipment-highlights` | Public approved listings and bounded homepage queries |
| `GET /api/equipment/:id` | Signed-in private details |
| `GET /api/favorites`, `PUT/DELETE /api/favorites/:id` | Current Customer favorites |
| `GET/PATCH /api/profile` | Current account profile |
| `GET/POST /api/profile/password` | Current Admin's initial email-password setup |
| `GET /api/uploads/config`, `POST /api/uploads/image` | Upload availability and validated binary image upload |
| `/api/owner/equipment`, `/api/owner/equipment/:id`, `/api/owner/summary` | Current Owner's listing operations |
| `POST /api/booking/quote`, `POST /api/booking/checkout` | Customer quotes and stock reservations |
| `GET /api/booking/checkouts/:id`, `POST /api/booking/checkouts/:id/cancel` | Current Customer checkout recovery/cancellation |
| `POST /api/payments/webhook` | Public, signature-verified Stripe notifications |
| `GET /api/rentals`, `GET /api/owner/rentals` | Current Customer/Owner rental history |
| `/api/admin/users`, `/api/admin/equipment`, `/api/admin/rentals` | Admin management and moderation |
| `GET /api/admin/analytics`, `GET /api/owner/analytics` | Platform and current-Owner analytics |

Protected application requests require both the active session cookie and its matching Bearer JWT. The API checks current permissions rather than trusting a role submitted by the browser.

## Booking and inventory rules

Amounts are stored in integer minor units of **BDT**. Dates use Bangladesh calendar days and include both endpoints. Daily rates charge per day; Weekly and Monthly rates round up to complete 7-day and 30-day blocks. Rentals are bounded to 90 days.

MongoDB transactions serialize overlapping stock reservations and account access changes. The server derives ownership, prices and identity. Unpaid Checkout attempts hold inventory; a booking and payment are created atomically only after Stripe confirms the expected session, PaymentIntent, amount, currency and identity.

Duplicate requests and notifications do not create duplicate bookings or payments. Uncertain provider failures keep their reservation until reconciliation; cancellation checks the provider before releasing it. Active rentals block listing edits/deletion. Ended rentals are reconciled during relevant requests; a standalone scheduled cron job is not configured.

Admin changes use optimistic versions and transactional access checks. Self-demotion/suspension and removal of the final active Admin are blocked. User access changes revoke sessions. Listing deletion retains rental history, and internal Admin notes are omitted from Customer/Owner responses.

## Stripe test payments and webhooks

Use test card **4242 4242 4242 4242**, a future expiry and any three-digit CVC. No real equipment delivery or live-money payments are offered by the demonstration listings.

For local tests:

```bash
npm run stripe:listen
```

Keep the local listener open while testing localhost. Its signing secret belongs to the local forwarder.

For the deployed application, configure a separate Stripe test endpoint:

```text
https://rentdock-server.vercel.app/api/payments/webhook
```

Enable these events:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`

Save that endpoint's signing secret in the **server Vercel environment**. The hosted endpoint works without a local terminal. Replacing an expired sandbox requires updating its test key and endpoint signing secret; sessions from different sandboxes are not interchangeable.

## Checks and demonstration data

```bash
npm test
npm run check
```

Tests cover authentication, JWT/RBAC, input validation, uploads, raw webhook signatures, payment proof, retry behavior, startup recovery, management rules and initial Admin password setup.

Live database diagnostics are available through `phase:verify`, `auth:verify`, `catalog:verify`, `owner:verify`, `booking:verify` and `admin:verify`. They use isolated temporary records/accounts and clean them up. Run them against a database you control. Database fixture tests do not replace a browser Stripe payment test.

Optional data preparation, with both repositories checked out as sibling `client` and `server` folders:

```bash
npm run catalog:seed
npm run booking:demo
npm run catalog:submission
```

The first command adds ownerless illustrative samples; these are not bookable. The demo commands prepare clearly labelled Owner-backed test equipment. Matching submission demo records are retained on reruns. Demo credentials and image checkpoints are kept in ignored `.booking-demo.json`; paid bookings and existing user accounts are not fabricated or replaced.

After a deployed payment by the prepared demo Customer:

```bash
npm run booking:report -- --deployed
```

The report matches Stripe with the persisted booking/payment and checks the production return URL and recorded signed webhook.

## Deployment

Vercel detects the root `app.js` Express export. It shares one initialized application/database pool per process, retries failed initialization and leaves webhook bytes unparsed until signature verification. `src/index.js` remains the local long-running entry point.

Configure production secrets in the **server** Vercel project. Set `CLIENT_URL=https://rentdock-client.vercel.app` and `BETTER_AUTH_URL=https://rentdock-client.vercel.app/api/auth`. The client project sets `API_URL=https://rentdock-server.vercel.app` and proxies its API requests through the frontend origin.

Atlas network access must permit the hosting service's outgoing connections. Vercel uses dynamic addresses in this setup. Both projects are connected to their respective GitHub `main` branches for automatic deployment. Environment and private demo files are excluded from Git and deployment source bundles.

Admin login credentials belong in the private assignment submission form, never in the public README or repository.
