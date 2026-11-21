# Account verification

Run from the workspace in normal Windows PowerShell:

```powershell
npm.cmd --prefix server run auth:verify
```

The verification creates a uniquely named temporary account, checks MongoDB persistence, password rules, JWT and session verification, profile updates, current Customer/Owner/Admin permissions, suspension and logout, then deletes its own account and related authentication records. It never prints passwords or tokens. It does not use or modify an existing account.

If Atlas becomes unreachable, compare the Node process's public egress IP with the Atlas project IP Access List. Browser and Node egress IPs have differed on this connection. Add only the required current address and wait for Active before retrying. Do not disable TLS verification.

## Browser preview

Start the workspace from normal Windows PowerShell:

```powershell
npm.cmd run dev
```

Open `http://127.0.0.1:3000/register`. Register with a name, email, direct HTTPS photo URL and a password of at least six characters with uppercase and lowercase letters. New users receive Customer access. Verify the success notification and Dashboard navigation. Update the profile, reload the private route and confirm the saved values remain. Sign out, then revisit `/dashboard/profile`; it should return to sign-in and preserve the destination.

## Google sign-in

Create or select a project in Google Cloud Console. Configure the OAuth consent/branding settings for RentDock, then create an OAuth client of type Web application. Use the same origin throughout development:

| Setting | Local value |
| --- | --- |
| JavaScript origin | `http://127.0.0.1:3000` |
| Authorized redirect URI | `http://127.0.0.1:3000/api/auth/callback/google` |
| Server `CLIENT_URL` | `http://127.0.0.1:3000` |
| Server `BETTER_AUTH_URL` | `http://127.0.0.1:3000/api/auth` |

Save the OAuth client ID and secret as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the ignored `server/.env` file. Restart the server. If the consent application is in Testing, add the account used for verification as a test user when required by Google. Complete Google sign-in in the browser, confirm the success notification, default Customer role, profile persistence, route reload and logout. The email verification helper does not prove Google OAuth works.

Deployment requires the actual frontend HTTPS origin and its matching callback URI. Keep the backend auth API behind the frontend `/api` rewrite so browser cookies and callbacks share the frontend origin. Do not mix `localhost` and `127.0.0.1`.

Email verification and password-reset flows are intentionally excluded by the assignment. Rental data, equipment ownership, booking/payment records and dashboard analytics are separate upcoming work.

References:
- https://better-auth.com/docs/authentication/google
- https://better-auth.com/docs/integrations/express
