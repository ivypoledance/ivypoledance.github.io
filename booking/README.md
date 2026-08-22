# Booking API

Reserves places on course dates. Runs as a Cloudflare Worker with a D1
database; payment happens outside this system, so a booking only holds a place.

`coursedates.csv` in the repository root stays the source of truth for dates.
CI pushes them here on every push to `main`, so there is nothing to enter twice.

## Endpoints

| | |
|---|---|
| `POST /api/events` | Replace the set of events. Requires `Authorization: Bearer $ADMIN_TOKEN`. Dates absent from the payload are deleted, so the store cannot drift from the CSV. |
| `GET /api/events/{id}` | Places taken, waiting and free. Used by the booking form. |
| `POST /api/bookings` | `{event_id, name, email, accept_terms, turnstile_token?}`. Returns `confirmed`, or `waitlist` with a position once the date is full. |

## Tests

No dependencies: the tests run the production SQL against Node's built-in
SQLite, so the capacity boundary and uniqueness rules are exercised for real.

```sh
cd booking && npm test
# or, without Node installed:
docker run --rm -v "$PWD:/app:ro" -w /app node:24-alpine \
  node --test test/booking.test.mjs test/api.test.mjs
```

## Setup

Steps only the account owner can do.

1. **Database**, with data kept in Europe:
   ```sh
   wrangler d1 create ivypoledance-booking --location weur
   ```
   Put the returned id in `wrangler.toml`, then create the tables:
   ```sh
   npm run schema
   ```

2. **Mail provider.** Mailjet or Brevo; both are French. Verify
   `ivypoledance.at` as a sending domain, which means adding the DKIM records it
   gives you and one `include:` to the existing SPF record.

   The current SPF is live and carries Cloudflare Email Routing and Google:
   ```
   v=spf1 include:_spf.mx.cloudflare.net include:_spf.google.com ~all
   ```
   Append the provider's include; do not replace it. SPF permits ten DNS
   lookups and this uses two, so there is room. DMARC is `p=none`, so a
   mistake degrades deliverability rather than bouncing mail outright.

   Confirm at signup that domain authentication is included on the free tier.
   If it is not, send from a subdomain instead, which leaves the root records
   untouched.

3. **Secrets.**
   ```sh
   wrangler secret put ADMIN_TOKEN      # also stored as a GitHub secret for CI
   wrangler secret put MAIL_API_KEY
   wrangler secret put MAIL_API_SECRET  # Mailjet only
   wrangler secret put TURNSTILE_SECRET # optional
   ```

4. **Cloudflare API token.** The token CI already uses needs
   `Workers Scripts: Edit` and `D1: Edit` added to deploy this.

5. **Privacy notice.** Storing names and emails makes you the data controller.
   `content/imprint/_index.md` currently has an Impressum and AGB but no
   Datenschutzerklärung. It needs one before the form goes live, covering what
   is stored (name, email, chosen date), why, how long, and how to have it
   deleted. Bookings should also be pruned on a schedule rather than kept
   indefinitely.

## Notes

- A booking is stored before mail is attempted. If the provider refuses, the
  place is still reserved and the response reports `email_sent: false`, rather
  than losing a booking that was made.
- Places are allocated in a single SQL statement, so two simultaneous requests
  cannot both take the last place.
- Raising a date's capacity does not promote anyone already waiting; promotion
  is a deliberate action, planned for the next phase alongside cancellation.
