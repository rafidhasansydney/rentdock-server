# Equipment discovery verification

From the workspace in normal Windows PowerShell:

```powershell
npm.cmd --prefix server run catalog:seed
npm.cmd --prefix server run catalog:verify
```

The seed adds six clearly identified illustrative sample records using insert-only upserts. It does not overwrite existing matching records, change user roles or invent an equipment owner's identity. Sample records have no real owner and must not become bookable inventory in the payment phase.

The verification uses uniquely marked temporary equipment and two temporary accounts. It checks approved-only public results, escaped search input, price range, sorting, stock filters, pagination, bounded homepage queries, authenticated details, rejection of pending details, customer-only favorites, duplicate-save prevention, user isolation and automatic hiding of rejected listings. It deletes only the records and accounts created by its own run.

Start the app using `npm.cmd run dev`. Browse `http://127.0.0.1:3000/equipment`. Check filters and URL persistence, visit details while signed out, sign in and return to the same listing, add a favorite, reload and find it under Dashboard → My favorites. Remove it and confirm the empty state. Inventory shown here is recorded stock; date-specific reservations are implemented in the booking phase.

Public endpoints:
- `GET /api/equipment`: approved records; keyword, category, location, period, minimum/maximum rate, stock, sorting and pagination. Default page size 12, maximum 24.
- `GET /api/equipment-highlights`: MongoDB queries limited to six featured and two recent approved records.

Private endpoints require both a signed JWT and its current live session:
- `GET /api/equipment/:id`: approved details and the current customer's saved state.
- `GET /api/favorites?page=1`: the current customer's approved saved equipment.
- `PUT /api/favorites/:id`: idempotent save for the current customer.
- `DELETE /api/favorites/:id`: idempotent removal for the current customer.

No request-supplied user ID is trusted. A unique `(userId, equipmentId)` index prevents duplicate favorites. Pending/rejected equipment and private owner/authentication fields do not appear in public responses. Health/readiness routes remain public with authentication enabled.

If Atlas access fails, compare the actual Node egress IP with the Atlas IP Access List. Do not infer Node's address from the browser alone or disable TLS verification.
