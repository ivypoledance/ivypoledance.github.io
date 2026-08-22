// Exercises the Worker's HTTP surface against real SQLite through a small D1
// shim, so routing, auth, status codes and the email side effects are covered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import worker from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'schema.sql'), 'utf8');

// Minimal stand-in for the D1 binding: prepare/bind/first/run plus batch.
class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  execute() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async first() { return this.execute(); }
  async run() { return this.db.prepare(this.sql).run(...this.args); }
}

class D1 {
  constructor(db) { this.db = db; }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try {
      for (const s of statements) s.db.prepare(s.sql).run(...s.args);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function setup({ mailOk = true, turnstileSecret = null } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);

  const sent = [];
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (String(url).includes('turnstile')) {
      return { ok: true, json: async () => ({ success: false }) };
    }
    sent.push(JSON.parse(init.body));
    return { ok: mailOk, json: async () => ({}) };
  };

  const env = {
    DB: new D1(db),
    ADMIN_TOKEN: 'secret-token',
    FROM_EMAIL: 'buchung@ivypoledance.at',
    MAIL_API_KEY: 'key',
    MAIL_API_SECRET: 'sec',
    MAIL_PROVIDER: 'mailjet',
    OWNER_EMAIL: 'studio@ivypoledance.at',
    SITE_URL: 'https://ivypoledance.at',
    ALLOWED_ORIGIN: 'https://ivypoledance.at',
    ...(turnstileSecret ? { TURNSTILE_SECRET: turnstileSecret } : {}),
  };

  const call = (path, init = {}) =>
    worker.fetch(new Request(`https://booking.ivypoledance.at${path}`, init), env, {}, fakeFetch);

  return { db, env, call, sent, calls };
}

const EVENT = {
  id: 'courses/technic/lollipop.md@2026-09-01t18:00:00',
  course_path: 'courses/technic/lollipop.md',
  course_title: 'Lollipop',
  name: 'Sommer',
  price: '€39.-',
  starts_at: '2026-09-01T18:00:00',
  ends_at: '2026-09-01T19:30:00',
  capacity: 2,
};

function syncBody(events) {
  return { method: 'POST', headers: { authorization: 'Bearer secret-token', 'content-type': 'application/json' }, body: JSON.stringify({ events }) };
}

function bookBody(extra = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: EVENT.id, name: 'Dagmar Muster', email: 'dagmar@example.at', accept_terms: true, ...extra }),
  };
}

test('event sync requires the admin token', async () => {
  const { call } = setup();
  assert.equal((await call('/api/events', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await call('/api/events', { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' })).status, 401);
});

test('events sync, then availability is reported', async () => {
  const { call } = setup();
  const sync = await call('/api/events', syncBody([EVENT]));
  assert.equal(sync.status, 200);
  assert.deepEqual(await sync.json(), { synced: 1 });

  const res = await call(`/api/events/${encodeURIComponent(EVENT.id)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    id: EVENT.id, capacity: 2, confirmed: 0, waitlist: 0, free: 2, unlimited: false,
  });
});

test('a date without a capacity never fills up', async () => {
  const { call } = setup();
  const unlimited = { ...EVENT, capacity: '' };
  assert.equal((await call('/api/events', syncBody([unlimited]))).status, 200);

  const availability = await (await call(`/api/events/${encodeURIComponent(EVENT.id)}`)).json();
  assert.equal(availability.capacity, null);
  assert.equal(availability.unlimited, true);
  assert.equal(availability.free, null, 'free must not read as "none left"');

  for (const email of ['a@x.at', 'b@x.at', 'c@x.at', 'd@x.at', 'e@x.at']) {
    const body = await (await call('/api/bookings', bookBody({ email }))).json();
    assert.equal(body.status, 'confirmed');
    assert.equal(body.unlimited, true);
    assert.equal(body.free, null);
  }

  const after = await (await call(`/api/events/${encodeURIComponent(EVENT.id)}`)).json();
  assert.equal(after.confirmed, 5);
  assert.equal(after.waitlist, 0);
});

test('capacity may be omitted entirely as well as blank', async () => {
  const { call } = setup();
  const { capacity, ...noCapacity } = EVENT;
  assert.equal((await call('/api/events', syncBody([noCapacity]))).status, 200);
  const availability = await (await call(`/api/events/${encodeURIComponent(EVENT.id)}`)).json();
  assert.equal(availability.unlimited, true);
});

test('the owner notification says when a date has no limit', async () => {
  const { call, sent } = setup();
  await call('/api/events', syncBody([{ ...EVENT, capacity: '' }]));
  await call('/api/bookings', bookBody());
  const owner = sent.at(-1).Messages[0].TextPart;
  assert.match(owner, /Belegt: 1 \(kein Limit\)/);
});

test('a booking is confirmed and both emails are sent', async () => {
  const { call, sent } = setup();
  await call('/api/events', syncBody([EVENT]));

  const res = await call('/api/bookings', bookBody());
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'confirmed');
  assert.equal(body.free, 1);
  assert.equal(body.email_sent, true);

  assert.equal(sent.length, 2, 'attendee and owner');
  const [attendee, owner] = sent;
  assert.equal(attendee.Messages[0].To[0].Email, 'dagmar@example.at');
  assert.match(attendee.Messages[0].Subject, /Buchungsbestätigung/);
  assert.match(attendee.Messages[0].TextPart, /Lollipop – Sommer/);
  assert.match(attendee.Messages[0].TextPart, /Di\. 01\.09\.2026, 18:00-19:30/);
  assert.equal(owner.Messages[0].To[0].Email, 'studio@ivypoledance.at');
});

test('once full, further bookings join the waitlist with a position', async () => {
  const { call } = setup();
  await call('/api/events', syncBody([EVENT]));
  await call('/api/bookings', bookBody({ email: 'a@example.at' }));
  await call('/api/bookings', bookBody({ email: 'b@example.at' }));

  const third = await call('/api/bookings', bookBody({ email: 'c@example.at' }));
  assert.equal(third.status, 201);
  const body = await third.json();
  assert.equal(body.status, 'waitlist');
  assert.equal(body.position, 1);
  assert.equal(body.free, 0);

  const fourth = await (await call('/api/bookings', bookBody({ email: 'd@example.at' }))).json();
  assert.equal(fourth.position, 2);
});

test('the waitlist email states the position', async () => {
  const { call, sent } = setup();
  await call('/api/events', syncBody([{ ...EVENT, capacity: 1 }]));
  await call('/api/bookings', bookBody({ email: 'a@example.at' }));
  sent.length = 0;
  await call('/api/bookings', bookBody({ email: 'b@example.at' }));
  assert.match(sent[0].Messages[0].Subject, /Warteliste/);
  assert.match(sent[0].Messages[0].TextPart, /Position: 1/);
});

test('booking twice with one address is refused', async () => {
  const { call } = setup();
  await call('/api/events', syncBody([EVENT]));
  await call('/api/bookings', bookBody());
  const again = await call('/api/bookings', bookBody());
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: 'already_booked' });
});

test('an already stored booking still succeeds when mail is refused', async () => {
  const { call } = setup({ mailOk: false });
  await call('/api/events', syncBody([EVENT]));
  const res = await call('/api/bookings', bookBody());
  assert.equal(res.status, 201);
  assert.equal((await res.json()).email_sent, false);
});

test('bad input is rejected before anything is stored', async () => {
  const { call, db } = setup();
  await call('/api/events', syncBody([EVENT]));

  const cases = [
    [bookBody({ accept_terms: false }), 'terms_not_accepted'],
    [bookBody({ email: 'nope' }), 'invalid_email'],
    [bookBody({ name: '  ' }), 'missing_name'],
    [{ method: 'POST', body: 'not json' }, 'invalid_body'],
  ];
  for (const [init, expected] of cases) {
    const res = await call('/api/bookings', init);
    assert.equal(res.status, 400, expected);
    assert.equal((await res.json()).error, expected);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
});

test('booking an unknown event is a 404', async () => {
  const { call } = setup();
  const res = await call('/api/bookings', bookBody());
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'unknown_event');
});

test('dates removed from the CSV disappear on the next sync', async () => {
  const { call } = setup();
  const other = { ...EVENT, id: 'other@2026', starts_at: '2026-10-01T18:00:00' };
  await call('/api/events', syncBody([EVENT, other]));
  await call('/api/events', syncBody([other]));

  assert.equal((await call(`/api/events/${encodeURIComponent(EVENT.id)}`)).status, 404);
  assert.equal((await call(`/api/events/${encodeURIComponent(other.id)}`)).status, 200);
});

test('an empty sync clears every event', async () => {
  const { call, db } = setup();
  await call('/api/events', syncBody([EVENT]));
  await call('/api/events', syncBody([]));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
});

test('a capacity that is present but unusable is rejected', async () => {
  const { call } = setup();
  // Blank means unlimited; these are typos and must not be read that way.
  for (const capacity of [0, -1, 'six', 3.5]) {
    const res = await call('/api/events', syncBody([{ ...EVENT, capacity }]));
    assert.equal(res.status, 400, `capacity ${capacity}`);
    assert.equal((await res.json()).error, 'invalid_event');
  }
});

test('a failed Turnstile check blocks the booking', async () => {
  const { call, db } = setup({ turnstileSecret: 'ts-secret' });
  await call('/api/events', syncBody([EVENT]));

  const missing = await call('/api/bookings', bookBody());
  assert.equal(missing.status, 403);

  const wrong = await call('/api/bookings', bookBody({ turnstile_token: 'bad' }));
  assert.equal(wrong.status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
});

test('preflight and unknown routes behave', async () => {
  const { call } = setup();
  const preflight = await call('/api/bookings', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://ivypoledance.at');

  assert.equal((await call('/nope')).status, 404);
});
