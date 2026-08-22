// Booking API for ivypoledance.at.
//
// Events mirror coursedates.csv and are pushed here by CI; bookings originate
// here. Payment happens outside this system, so a booking only reserves a place.

import {
  UPSERT_EVENT,
  DELETE_EVENTS_NOT_IN,
  EVENT_WITH_COUNTS,
  INSERT_BOOKING,
  WAITLIST_POSITION,
} from './queries.js';
import { validateBooking } from './validate.js';
import {
  confirmationEmail,
  waitlistEmail,
  ownerNotificationEmail,
  sendEmail,
} from './email.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
}

function json(env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(env) },
  });
}

/** Constant-time-ish comparison, to avoid leaking the token by timing. */
function tokenMatches(provided, expected) {
  if (!expected || !provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

function isAdmin(request, env) {
  const header = request.headers.get('authorization') || '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  return tokenMatches(header.slice(prefix.length), env.ADMIN_TOKEN);
}

/** Cloudflare Turnstile, when configured. Absent secret means no check. */
async function passesTurnstile(env, token, ip, fetchImpl) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

async function replaceEvents(env, events) {
  const db = env.DB;
  const statements = events.map((e) => db.prepare(UPSERT_EVENT).bind(
    e.id, e.course_path, e.course_title ?? '', e.name ?? '', e.price ?? '',
    e.starts_at, e.ends_at ?? null, e.second_starts_at ?? null, e.second_ends_at ?? null,
    // Absent capacity is stored as NULL, meaning unlimited.
    e.capacity === null || e.capacity === undefined || e.capacity === '' ? null : Number(e.capacity),
    new Date().toISOString(),
  ));

  // Dropping absent events keeps the store from drifting from the CSV. With an
  // empty list every event would match, so that case is handled explicitly.
  statements.push(
    events.length
      ? db.prepare(DELETE_EVENTS_NOT_IN(events.length)).bind(...events.map((e) => e.id))
      : db.prepare('DELETE FROM events'),
  );

  await db.batch(statements);
  return events.length;
}

async function createBooking(request, env, fetchImpl) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json(env, { error: 'invalid_body' }, 400);
  }

  const parsed = validateBooking(body);
  if (!parsed.ok) return json(env, { error: parsed.error }, 400);

  const ip = request.headers.get('cf-connecting-ip');
  if (!await passesTurnstile(env, body.turnstile_token, ip, fetchImpl)) {
    return json(env, { error: 'challenge_failed' }, 403);
  }

  const { eventId, name, email } = parsed.value;
  const event = await env.DB.prepare(EVENT_WITH_COUNTS).bind(eventId).first();
  if (!event) return json(env, { error: 'unknown_event' }, 404);

  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  let status;
  try {
    const row = await env.DB.prepare(INSERT_BOOKING)
      .bind(id, eventId, name, email, token, new Date().toISOString())
      .first();
    status = row?.status;
  } catch (error) {
    // The partial unique index is the authority on duplicates.
    if (String(error).match(/UNIQUE|constraint/i)) {
      return json(env, { error: 'already_booked' }, 409);
    }
    throw error;
  }
  if (!status) return json(env, { error: 'unknown_event' }, 404);

  const booking = { id, name, email, token };
  const after = await env.DB.prepare(EVENT_WITH_COUNTS).bind(eventId).first();

  let position = null;
  if (status === 'waitlist') {
    const row = await env.DB.prepare(WAITLIST_POSITION).bind(eventId, id).first();
    position = row?.position ?? null;
  }

  const attendee = status === 'confirmed'
    ? confirmationEmail({
      event,
      booking,
      siteUrl: env.SITE_URL || 'https://ivypoledance.at',
      paymentNote: env.PAYMENT_NOTE
        || 'Die Überweisungsdaten senden wir dir in einer separaten E-Mail. Dein Platz ist bis zum Zahlungseingang reserviert.',
    })
    : waitlistEmail({ event, booking, position, siteUrl: env.SITE_URL || 'https://ivypoledance.at' });

  // Mail is best effort: the place is already reserved, so a refused send must
  // not turn a successful booking into an error for the visitor.
  const sent = await sendEmail(env, {
    to: email,
    subject: attendee.subject,
    text: attendee.text,
    replyTo: env.OWNER_EMAIL,
  }, fetchImpl);

  if (env.OWNER_EMAIL) {
    const owner = ownerNotificationEmail({ event, booking, status, counts: after });
    await sendEmail(env, {
      to: env.OWNER_EMAIL,
      subject: owner.subject,
      text: owner.text,
      replyTo: email,
    }, fetchImpl);
  }

  return json(env, {
    status,
    position,
    ...freePlaces(after),
    email_sent: sent,
  }, 201);
}

/** Unlimited dates report free: null, so callers cannot read it as "none left". */
function freePlaces(event) {
  return event.capacity === null
    ? { unlimited: true, free: null }
    : { unlimited: false, free: Math.max(0, event.capacity - event.confirmed) };
}

async function getAvailability(env, eventId) {
  const event = await env.DB.prepare(EVENT_WITH_COUNTS).bind(eventId).first();
  if (!event) return json(env, { error: 'unknown_event' }, 404);
  return json(env, {
    id: event.id,
    capacity: event.capacity,
    confirmed: event.confirmed,
    waitlist: event.waitlist,
    ...freePlaces(event),
  });
}

export default {
  async fetch(request, env, ctx, fetchImpl = fetch) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (path === '/api/events' && request.method === 'POST') {
      if (!isAdmin(request, env)) return json(env, { error: 'unauthorized' }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json(env, { error: 'invalid_body' }, 400);
      }
      if (!Array.isArray(body?.events)) return json(env, { error: 'missing_events' }, 400);
      // Capacity may be absent, meaning unlimited, but a value that is present
      // has to be usable rather than silently treated as no limit.
      const invalid = body.events.find((e) => {
        if (!e?.id || !e?.starts_at) return true;
        const unlimited = e.capacity === null || e.capacity === undefined || e.capacity === '';
        return !unlimited && !(Number.isInteger(Number(e.capacity)) && Number(e.capacity) > 0);
      });
      if (invalid) return json(env, { error: 'invalid_event', event: invalid }, 400);
      const count = await replaceEvents(env, body.events);
      return json(env, { synced: count });
    }

    const availability = path.match(/^\/api\/events\/(.+)$/);
    if (availability && request.method === 'GET') {
      return getAvailability(env, decodeURIComponent(availability[1]));
    }

    if (path === '/api/bookings' && request.method === 'POST') {
      return createBooking(request, env, fetchImpl);
    }

    return json(env, { error: 'not_found' }, 404);
  },
};
