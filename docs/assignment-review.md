# Assignment 9 — Category 003 review

Review date: **23 November 2026**. This maps the written Equipment Rental Platform specification to the implemented application and its verification evidence.

Website: https://rentdock-client.vercel.app  
API readiness: https://rentdock-server.vercel.app/api/ready

## Required functionality

| Requirement | Implementation / evidence |
| --- | --- |
| Separate repositories and meaningful history | Client and server maintain independent Git histories; both already exceed the minimum 20 client / 12 server commits |
| README with name, purpose, live URL, features and packages | Both repository roots contain a README with setup, packages, routes, deployment and payment information |
| Required stack | Next.js App Router, React, TypeScript, shadcn/ui-style source primitives with Radix/CVA, Better Auth, MongoDB adapter, JWT, Express and Stripe |
| Environment configuration | Client API origin comes from environment settings; database/provider/auth secrets are server-only; private files are excluded from Git and deployment bundles |
| Shared layout | Header, route-based content and footer are defined in the client root layout |
| Homepage banner and navigation | Equipment hero, meaningful marketplace copy, category switching, login/register or dashboard/logout navigation |
| Six featured approved equipment items | `catalog/repository.js` restricts approval and uses MongoDB `.limit(6)`; live HTTP checks confirm six results |
| Details require login | Session-aware client navigation plus server JWT/session verification on equipment details |
| Six categories | Photography, Construction, Electronics, Events, Agriculture and Vehicles & Transportation |
| Benefits and four reviews | Rental-period/local-comparison benefits and four explicitly illustrative customer stories, each with name, rating and comment |
| At least two extra sections | Project collections, How it works, recently added equipment, Owner guide section and rental FAQ |
| Framer Motion | Banner, featured equipment transitions/category selection and category hover interactions; reduced-motion support |
| Public three-column equipment catalog | Desktop grid has three columns; mobile layouts reduce the columns; cards include image, category, price/period, location, availability and details action |
| Backend search, filtering and sorting | Name/category/location query, category, period, minimum/maximum price, availability, ascending/descending price and newest sorting are parsed and queried in MongoDB |
| Registration fields and password rules | Name, email, image upload/direct URL and password; uppercase/lowercase and minimum six characters are validated on the server and surfaced in the UI |
| Login, Google, links and feedback | Email/password and Google login, cross-links between login/register, toast success/errors; new accounts default to Customer |
| No email verification or forgot-password requirement | These flows are disabled; initial Admin email-password addition does not reset an existing password |
| JWT and role middleware | Active session plus signed JWT, issuer/audience/session matching, fresh role and suspension checks; separate Customer/Owner/Admin guards |
| Profile for all roles | Name, email, image, phone and address; authenticated profile editing and imgbb upload |
| Equipment details | Description, category, price/period, location, quantity, image, condition, Owner and terms/accessories |
| Favorites | Customer-scoped database persistence, table display, view/remove actions and idempotent add/remove operations |
| Six booking fields | Start/end dates, quantity, phone, delivery address and optional notes in the booking dialog |
| Trusted booking amount and stock | Inclusive dates, whole Weekly/Monthly blocks, server-owned pricing, bounded inputs and transactional overlapping-stock reservations |
| Stripe and persistence | Hosted test Checkout, verified Session/PaymentIntent proof, signed raw webhooks, atomic booking/payment records, confirmation and transaction display |
| Customer rentals table | Equipment, rental dates, booking date, quantity, amount, payment and booking status; unfinished checkout recovery |
| Owner submission | Required equipment fields, imgbb image, server-derived Owner, Pending status and review after edits |
| Owner listing management | Table, private preview, update and soft deletion, current-owner isolation, optimistic versions and active-rental mutation guards |
| Owner rental table | Customer/equipment information, rental dates, quantity, amount, payment and booking status |
| Admin user management | User name/email/role/registration date, role changes, suspension/restoration and session revocation; self-access and last-Admin guards |
| Admin equipment management | Approve, reject with feedback, Pending status, preview, edit preserving ownership, and guarded archive |
| Admin rental management | Customer/Owner information, dates, equipment, amount, payment/status, internal notes, handover and ended-rental completion |
| Admin analytics | Actual users/equipment/bookings/payments, pending approvals, completed rentals, gross BDT revenue and monthly statistics |
| Owner analytics | Current-owner equipment, completed rentals, gross earnings and six monthly earnings buckets; owner identity cannot be overridden by a query parameter |
| Dashboard charts and responsiveness | Shared responsive dashboard, metric cards, switchable monthly charts and accessible figures tables; horizontally scrollable wide tables |
| Loading, errors and unknown routes | App loading/error/not-found components, session loading gate, retry states, backend controlled errors and genuine API 404 |
| Modern X icon | No Twitter/social link or obsolete bird icon is displayed |

## Data prepared for review

The catalog contains six original illustrative samples and Owner-backed demonstration equipment across all six categories. New demo listings use imgbb images and valid account ownership. Matching demo records are preserved by the submission seed script. The existing BDT 200 paid booking is retained.

Demonstration equipment is clearly labelled and does not promise real delivery. No fake paid bookings, revenue or collected customer reviews are inserted to inflate the dashboard. New users still start as Customers; roles are managed by the existing Admin.

## Verification

- All **46 backend tests** passed on this review, including authentication, role restrictions, uploads, payment proof, retry behavior, webhook bytes/signatures, management rules, startup and initial Admin password setup.
- Client TypeScript and ESLint passed. Source syntax checks include the new catalog seed helper.
- The live HTTP verifier passed readiness, frontend pages/direct nested routes, same-origin API forwarding, Google/upload configuration, anonymous private API denial, six featured items, API 404, exact CORS and unsigned webhook rejection.
- Prior Atlas live verification passed isolated authentication/profile/RBAC, catalog/favorites, Owner management, transactional booking concurrency and Admin management/analytics, including cleanup of its temporary data.
- The user verified Google Admin login and email/password Admin login on the deployed site.
- The earlier real BDT 200 sandbox payment was verified through Stripe, MongoDB and a local signed webhook. A separately signed unrelated probe also proved the hosted webhook accepts the configured production signature without changing booking data.
- **Final hosted browser payment passed on 23 November 2026.** The user supplied the production confirmation screenshot and the successful `npm run booking:report -- --deployed` output. The report verified the production return URL, a real Stripe sandbox BDT 200 paid/complete payment, exactly one matching MongoDB booking/payment and the recorded signed webhook. Booking reference: `7c4cd392-0f7e-4195-8bf7-1ee0183aea64`. The local forwarder was instructed to remain stopped for this hosted test.

Browser automation timed out during this final review; current visual behavior is therefore not reported as a fresh automated browser pass. The linked Google Drive requirement video was not accessible from the review environment, so this document covers the written specification.

## Optional features

| Optional item | Status |
| --- | --- |
| Pagination | Implemented for the catalog, favorites, rental history and management tables |
| Dark/light theme switch | Not implemented; optional |
| Scheduled cron job | Not configured; ended rentals are reconciled during relevant requests |
| Email notifications | Not implemented; optional |

## Before submission

1. Hosted Stripe payment and persistence verification are complete; retain the successful report and confirmation screenshot.
2. Confirm both final GitHub heads have READY production deployments.
3. Provide the verified Admin email/password privately with the live website and both repository links.
4. Keep the Stripe sandbox credentials valid through evaluation; update the hosted test key and matching webhook secret if that sandbox expires.

This checklist records evidence and remaining checks; it does not guarantee an examiner's mark or a subjective design assessment.
