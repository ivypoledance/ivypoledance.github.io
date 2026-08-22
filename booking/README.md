# Booking API

Reserves places on course dates. Runs as a Cloudflare Worker with a D1
database; payment happens outside this system, so a booking only holds a place.

`coursedates.csv` in the repository root stays the source of truth for dates.
CI pushes them here on every push to `main`, so there is nothing to enter twice.

## Capacity

The `capacity` column limits places on a date:

- **A number** — places are given out until it is reached, then bookings join
  the waitlist in order.
- **Blank** — unlimited: the date never fills up and nobody is ever waitlisted.
- **Anything else** (`0`, `-1`, `abc`, `3.5`) — the sync fails. A typo must not
  quietly become "no limit".

Every sync prints a warning listing dates with no capacity, so a limit that was
meant to be set does not stay missing unnoticed.

Adding a limit later never cancels bookings already taken; it only stops further
places being given out. Raising one does not promote anyone already waiting,
which is deliberate: editing a CSV should not send email.

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

## Try it before it goes live

The site still uses the `mailto:` links, so nothing here is reachable by
visitors until the booking form replaces them. Both routes below are safe to
run against the real dates.

### Locally, without a Cloudflare account

```sh
cd booking
npx wrangler d1 execute ivypoledance-booking --local --file schema.sql
npx wrangler dev                      # serves http://localhost:8787
```

In a second shell, push the real dates in and book a place:

```sh
cd ..                                 # repository root
node booking/sync-events.mjs --dry-run     # check what the CSV produces

BOOKING_API=http://localhost:8787 \
BOOKING_ADMIN_TOKEN=local-dev \
  node booking/sync-events.mjs

# The id comes from the dry run above.
EVENT='courses-technic-cirque-chair.md@2026-08-27t17:00:00'

curl -s "http://localhost:8787/api/events/$(printf %s "$EVENT" | jq -sRr @uri)" | jq

curl -s http://localhost:8787/api/bookings -H 'content-type: application/json' \
  -d "{\"event_id\":\"$EVENT\",\"name\":\"Test Person\",
       \"email\":\"test@example.at\",\"accept_terms\":true}" | jq
```

Expect `"status":"confirmed"` and the free count dropping. Book past the
capacity and it becomes `"status":"waitlist"` with a position. Locally
`email_sent` is `false` because no mail key is set — set `ADMIN_TOKEN=local-dev`
and the mail variables in `.dev.vars` if you want to test real sends.

### Against the deployed Worker

Same calls with `BOOKING_API` and the URL pointing at the deployed Worker, and
the real `ADMIN_TOKEN`. Worth checking:

- the confirmation email arrives, and reads correctly in German
- it comes **from** `buchung@ivypoledance.at` and is not treated as spam
- you receive the owner notification
- filling a date puts the next person on the waitlist with the right position
- booking the same address twice is refused with `409 already_booked`

Reset between attempts:

```sh
npx wrangler d1 execute ivypoledance-booking --remote \
  --command "DELETE FROM bookings"
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
