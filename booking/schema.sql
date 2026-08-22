-- Booking store for course dates.
--
-- Events mirror coursedates.csv, which stays the source of truth: CI upserts
-- them on every push to main. Bookings are the only data that originates here.

CREATE TABLE IF NOT EXISTS events (
  id                TEXT PRIMARY KEY,
  course_path       TEXT NOT NULL,
  course_title      TEXT NOT NULL DEFAULT '',
  name              TEXT NOT NULL DEFAULT '',
  price             TEXT NOT NULL DEFAULT '',
  starts_at         TEXT NOT NULL,
  ends_at           TEXT,
  second_starts_at  TEXT,
  second_ends_at    TEXT,
  -- NULL means unlimited places: a blank capacity in the CSV never fills up.
  capacity          INTEGER CHECK (capacity IS NULL OR capacity > 0),
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  -- Stored lower-cased so the uniqueness index below is case-insensitive.
  email          TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed', 'waitlist', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
  -- Unguessable handle for the self-service cancellation link.
  token          TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL,
  cancelled_at   TEXT
);

-- One active booking per person per event; cancelling frees the address again.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_active_email
  ON bookings (event_id, email) WHERE status <> 'cancelled';

-- Serves both the capacity count and waitlist ordering.
CREATE INDEX IF NOT EXISTS bookings_event_status
  ON bookings (event_id, status, created_at);

-- Supports the rate-limit lookup, which scans by time across all events.
CREATE INDEX IF NOT EXISTS bookings_created_at ON bookings (created_at);
