// Pure input handling, kept separate from the Worker so it can be tested
// without a request or a database.

/** Lower-cased and trimmed, matching how emails are stored. */
export function normaliseEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

// Deliberately permissive: the confirmation email is the real check that an
// address works, so this only rejects input that cannot be an address at all.
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value) {
  const email = normaliseEmail(value);
  return email.length <= 254 && EMAIL.test(email);
}

export const MAX_NAME_LENGTH = 120;

/**
 * Validates a booking request body.
 * @returns {{ok: true, value: {eventId: string, name: string, email: string}}
 *          | {ok: false, error: string}}
 */
export function validateBooking(body) {
  if (body === null || typeof body !== 'object') {
    return { ok: false, error: 'invalid_body' };
  }

  const eventId = String(body.event_id ?? '').trim();
  if (!eventId) return { ok: false, error: 'missing_event' };

  const name = String(body.name ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'missing_name' };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: 'name_too_long' };

  if (!isValidEmail(body.email)) return { ok: false, error: 'invalid_email' };

  // The AGB reference the cancellation terms, so consent is recorded per booking
  // rather than assumed.
  if (body.accept_terms !== true) return { ok: false, error: 'terms_not_accepted' };

  return { ok: true, value: { eventId, name, email: normaliseEmail(body.email) } };
}

/** Stable event id, so re-syncing the CSV updates rather than duplicates. */
export function eventId(coursePath, startsAt) {
  return `${String(coursePath).trim()}@${String(startsAt).trim()}`
    .toLowerCase()
    .replace(/[^a-z0-9@:._-]+/g, '-');
}
