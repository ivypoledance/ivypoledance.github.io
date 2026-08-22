// SQL is kept here so the tests can run it against real SQLite rather than a
// stubbed database. Parameters are numbered (?1) because the booking insert
// needs to reference the event id more than once.

export const UPSERT_EVENT = `
INSERT INTO events (
  id, course_path, course_title, name, price,
  starts_at, ends_at, second_starts_at, second_ends_at, capacity, updated_at
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
ON CONFLICT(id) DO UPDATE SET
  course_path      = excluded.course_path,
  course_title     = excluded.course_title,
  name             = excluded.name,
  price            = excluded.price,
  starts_at        = excluded.starts_at,
  ends_at          = excluded.ends_at,
  second_starts_at = excluded.second_starts_at,
  second_ends_at   = excluded.second_ends_at,
  capacity         = excluded.capacity,
  updated_at       = excluded.updated_at`;

// Events that disappear from the CSV are removed, so the store cannot drift
// from it. Bookings cascade, so this only ever affects dates that were pulled.
export const DELETE_EVENTS_NOT_IN = (count) => `
DELETE FROM events
WHERE id NOT IN (${Array.from({ length: count }, (_, i) => `?${i + 1}`).join(', ')})`;

export const EVENT_WITH_COUNTS = `
SELECT
  e.id, e.course_path, e.course_title, e.name, e.price,
  e.starts_at, e.ends_at, e.second_starts_at, e.second_ends_at, e.capacity,
  (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.status = 'confirmed') AS confirmed,
  (SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id AND b.status = 'waitlist')  AS waitlist
FROM events e
WHERE e.id = ?1`;

// One statement, so the capacity check and the insert cannot interleave with a
// competing booking. Counting and then inserting separately would let two
// simultaneous requests both see the last free place.
export const INSERT_BOOKING = `
INSERT INTO bookings (id, event_id, name, email, status, token, created_at)
SELECT ?1, ?2, ?3, ?4,
  CASE
    -- No capacity set means unlimited, so there is nothing to fill up.
    WHEN (SELECT capacity FROM events WHERE id = ?2) IS NULL THEN 'confirmed'
    WHEN (SELECT COUNT(*) FROM bookings WHERE event_id = ?2 AND status = 'confirmed')
       < (SELECT capacity FROM events WHERE id = ?2)
    THEN 'confirmed'
    ELSE 'waitlist'
  END,
  ?5, ?6
WHERE EXISTS (SELECT 1 FROM events WHERE id = ?2)
RETURNING status`;

// Position among people currently waiting, oldest first.
export const WAITLIST_POSITION = `
SELECT COUNT(*) AS position
FROM bookings
WHERE event_id = ?1
  AND status = 'waitlist'
  AND created_at <= (SELECT created_at FROM bookings WHERE id = ?2)`;
