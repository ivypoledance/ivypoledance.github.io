// Runs the production SQL against real SQLite, so the capacity boundary and the
// uniqueness rules are tested rather than assumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  UPSERT_EVENT,
  DELETE_EVENTS_NOT_IN,
  EVENT_WITH_COUNTS,
  INSERT_BOOKING,
  WAITLIST_POSITION,
} from '../src/queries.js';
import { validateBooking, isValidEmail, normaliseEmail, eventId } from '../src/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, '..', 'schema.sql'), 'utf8');

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(schema);
  return db;
}

function addEvent(db, { id = 'ev1', capacity = 3 } = {}) {
  db.prepare(UPSERT_EVENT).run(
    id, 'courses/technic/lollipop.md', 'Lollipop', 'Sommer', '€39.-',
    '2026-09-01T18:00:00', '2026-09-01T19:30:00', null, null, capacity, '2026-08-22T10:00:00Z',
  );
  return id;
}

let seq = 0;
function book(db, { event = 'ev1', email, name = 'Test Person', at } = {}) {
  seq += 1;
  const id = `b${seq}`;
  const createdAt = at ?? `2026-08-22T10:00:${String(seq).padStart(2, '0')}Z`;
  const row = db.prepare(INSERT_BOOKING).get(id, event, name, email, `tok${id}`, createdAt);
  return { id, status: row?.status };
}

test('places are given out until the event is full, then the waitlist starts', () => {
  const db = freshDb();
  addEvent(db, { capacity: 3 });

  const statuses = ['a@x.at', 'b@x.at', 'c@x.at', 'd@x.at', 'e@x.at']
    .map((email) => book(db, { email }).status);

  assert.deepEqual(statuses, ['confirmed', 'confirmed', 'confirmed', 'waitlist', 'waitlist']);

  const counts = db.prepare(EVENT_WITH_COUNTS).get('ev1');
  assert.equal(counts.confirmed, 3);
  assert.equal(counts.waitlist, 2);
  assert.equal(counts.capacity, 3);
});

test('a capacity of one still works', () => {
  const db = freshDb();
  addEvent(db, { capacity: 1 });
  assert.equal(book(db, { email: 'a@x.at' }).status, 'confirmed');
  assert.equal(book(db, { email: 'b@x.at' }).status, 'waitlist');
});

test('the same address cannot hold two active bookings for one event', () => {
  const db = freshDb();
  addEvent(db);
  book(db, { email: 'a@x.at' });
  assert.throws(() => book(db, { email: 'a@x.at' }), /UNIQUE|constraint/i);
});

test('the same address may book different events', () => {
  const db = freshDb();
  addEvent(db, { id: 'ev1' });
  addEvent(db, { id: 'ev2' });
  assert.equal(book(db, { event: 'ev1', email: 'a@x.at' }).status, 'confirmed');
  assert.equal(book(db, { event: 'ev2', email: 'a@x.at' }).status, 'confirmed');
});

test('cancelling frees both the place and the address', () => {
  const db = freshDb();
  addEvent(db, { capacity: 1 });
  const first = book(db, { email: 'a@x.at' });
  assert.equal(book(db, { email: 'b@x.at' }).status, 'waitlist');

  db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = ? WHERE id = ?")
    .run('2026-08-22T11:00:00Z', first.id);

  // The freed place is available again, including to the original address.
  assert.equal(book(db, { email: 'a@x.at' }).status, 'confirmed');
});

test('booking an unknown event stores nothing', () => {
  const db = freshDb();
  addEvent(db);
  const result = book(db, { event: 'does-not-exist', email: 'a@x.at' });
  assert.equal(result.status, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
});

test('waitlist position follows booking order', () => {
  const db = freshDb();
  addEvent(db, { capacity: 1 });
  book(db, { email: 'first@x.at' });
  const second = book(db, { email: 'second@x.at' });
  const third = book(db, { email: 'third@x.at' });

  assert.equal(db.prepare(WAITLIST_POSITION).get('ev1', second.id).position, 1);
  assert.equal(db.prepare(WAITLIST_POSITION).get('ev1', third.id).position, 2);
});

test('re-syncing an event updates it instead of duplicating', () => {
  const db = freshDb();
  addEvent(db, { capacity: 3 });
  addEvent(db, { capacity: 6 });

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  assert.equal(db.prepare(EVENT_WITH_COUNTS).get('ev1').capacity, 6);
});

test('raising capacity does not retrospectively promote the waitlist', () => {
  const db = freshDb();
  addEvent(db, { capacity: 1 });
  book(db, { email: 'a@x.at' });
  const waiting = book(db, { email: 'b@x.at' });
  assert.equal(waiting.status, 'waitlist');

  addEvent(db, { capacity: 5 });
  // Promotion is a deliberate action, not a side effect of a CSV edit.
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id = ?').get(waiting.id).status, 'waitlist');
  // But the next person gets a place, since there is now room.
  assert.equal(book(db, { email: 'c@x.at' }).status, 'confirmed');
});

test('events dropped from the CSV are removed with their bookings', () => {
  const db = freshDb();
  addEvent(db, { id: 'keep' });
  addEvent(db, { id: 'drop' });
  book(db, { event: 'drop', email: 'a@x.at' });

  db.prepare(DELETE_EVENTS_NOT_IN(1)).run('keep');

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookings').get().n, 0);
});

test('capacity must be positive when set', () => {
  const db = freshDb();
  assert.throws(() => addEvent(db, { capacity: 0 }), /constraint/i);
  assert.throws(() => addEvent(db, { capacity: -1 }), /constraint/i);
});

test('a null capacity confirms everyone, however many book', () => {
  const db = freshDb();
  addEvent(db, { capacity: null });

  const statuses = ['a@x.at', 'b@x.at', 'c@x.at', 'd@x.at', 'e@x.at', 'f@x.at']
    .map((email) => book(db, { email }).status);

  assert.deepEqual(statuses, Array(6).fill('confirmed'));
  const counts = db.prepare(EVENT_WITH_COUNTS).get('ev1');
  assert.equal(counts.confirmed, 6);
  assert.equal(counts.waitlist, 0);
  assert.equal(counts.capacity, null);
});

test('setting a capacity below the bookings already taken waitlists only new ones', () => {
  const db = freshDb();
  addEvent(db, { capacity: null });
  book(db, { email: 'a@x.at' });
  book(db, { email: 'b@x.at' });
  book(db, { email: 'c@x.at' });

  // A limit added later does not cancel anyone, but stops further places.
  addEvent(db, { capacity: 2 });
  assert.equal(db.prepare(EVENT_WITH_COUNTS).get('ev1').confirmed, 3);
  assert.equal(book(db, { email: 'd@x.at' }).status, 'waitlist');
});

test('input validation', () => {
  const valid = { event_id: 'ev1', name: '  Dagmar   Muster ', email: ' A@X.AT ', accept_terms: true };
  assert.deepEqual(validateBooking(valid), {
    ok: true,
    value: { eventId: 'ev1', name: 'Dagmar Muster', email: 'a@x.at' },
  });

  assert.equal(validateBooking({ ...valid, accept_terms: false }).error, 'terms_not_accepted');
  assert.equal(validateBooking({ ...valid, email: 'nope' }).error, 'invalid_email');
  assert.equal(validateBooking({ ...valid, name: '   ' }).error, 'missing_name');
  assert.equal(validateBooking({ ...valid, name: 'x'.repeat(121) }).error, 'name_too_long');
  assert.equal(validateBooking({ ...valid, event_id: '' }).error, 'missing_event');
  assert.equal(validateBooking(null).error, 'invalid_body');
});

test('email handling', () => {
  assert.equal(normaliseEmail('  Foo@Bar.AT '), 'foo@bar.at');
  assert.ok(isValidEmail('a.b+c@sub.example.co.at'));
  assert.ok(!isValidEmail('a@b'));
  assert.ok(!isValidEmail('no-at-sign.at'));
  assert.ok(!isValidEmail(''));
});

test('event ids are stable and filesystem-safe', () => {
  const a = eventId('courses/technic/cirque-chair.md', '2026-08-27T17:00:00');
  assert.equal(a, eventId('courses/technic/cirque-chair.md', '2026-08-27T17:00:00'));
  assert.match(a, /^[a-z0-9@:._-]+$/);
  assert.notEqual(a, eventId('courses/technic/cirque-chair.md', '2026-08-28T17:00:00'));
});
