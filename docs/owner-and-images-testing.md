# Owner listings and image uploads

Run commands from the Equipment Rental Platform workspace in normal Windows PowerShell:

```powershell
npm.cmd --prefix server run owner:verify
npm.cmd --prefix server run images:check
```

The Owner check creates temporary accounts and tests the live MongoDB-backed API. It checks Pending creation, ownership isolation, customer/guest rejection, listing filters, edits returning to Pending, optimistic version conflicts, the active-rental mutation guard and hidden deletion history. It removes only its own equipment and accounts. Its placeholder image is not an image-provider test. It never changes an existing user's role.

The image check requires `IMGBB_API_KEY` in the server environment. It uploads a small diagnostic PNG directly to imgbb, downloads the result and validates its type. The diagnostic image expires after 60 seconds. Neither key values nor provider deletion credentials are printed.

## Browser walkthrough

Registration and profile forms accept either an imgbb gallery upload or a working HTTPS image address. Google share links and ordinary website addresses cannot be displayed as images. The preview reports failed image loading; saving waits for a valid preview. The equipment form uses gallery upload through imgbb.

With an Owner account, open Dashboard → My equipment → Add equipment. Fill the required fields, upload a JPG/PNG/WebP up to 3 MB and submit. Check the private Pending preview, refresh the list, update the rate, cancel a delete and then confirm deletion of a disposable listing. A listing cannot appear publicly before approval. Updating an approved listing sends it back for review.

Public registration never accepts a role. Owner access must come from trusted administration; the verification helper grants roles only to its own temporary accounts. Admin role-management screens and booking workflows are separate phases.

## API behavior

- `/api/owner/*` requires a signed JWT, a current database-backed session and the current Owner role.
- Owner identity and Pending status are assigned by the server. Reads and mutations always scope to the current Owner.
- Updates and deletes require the current listing version. They reject an active rental count and stale versions with HTTP 409; another owner's listing returns 404.
- Deletion hides the listing and retains its document for future rental history. Reservation creation must integrate the inventory/version guard atomically in the booking phase.
- `/api/uploads/config` reports availability, MIME types and size limits, without keys.
- `/api/uploads/image` accepts raw image bytes. It validates the declared MIME against file signatures, then sends the file to imgbb for decoding and hosting. Signed-in uploads validate the current session; registration uploads use an anonymous limit.
- Rate limits are stored in MongoDB with expiring counters: 6 anonymous or 20 authenticated attempts per ten minutes, plus 200 total attempts per day. Provider failures are shown as generic retryable errors. Images can take up to 45 seconds to upload.

If Atlas fails, compare the Node process's outgoing public IP with Active Atlas entries. Browser egress can differ. DNS timeouts in the restricted terminal are not proof that the user's normal PowerShell cannot connect. Keep certificate validation enabled.
