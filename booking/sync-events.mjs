#!/usr/bin/env node
// Pushes the dates in coursedates.csv to the booking API.
//
// The CSV is the source of truth, so this sends the whole set: dates removed
// from the file are removed from the booking store too.
//
//   node booking/sync-events.mjs --dry-run     print what would be sent
//   node booking/sync-events.mjs               send it
//
// Needs BOOKING_API and BOOKING_ADMIN_TOKEN when not doing a dry run.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { eventId } from './src/validate.js';

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, no embedded newlines. */
export function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"') {
          if (line[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
        } else field += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { fields.push(field); field = ''; }
      else field += char;
    }
    fields.push(field);
    rows.push(fields.map((f) => f.trim()));
  }
  if (!rows.length) return [];
  const [header, ...body] = rows;
  return body.map((fields) => Object.fromEntries(header.map((key, i) => [key, fields[i] ?? ''])));
}

/**
 * The file name without directory or extension, which is what Zola exposes as
 * `page.slug` and what prices.csv keys on. `courses/technic/ayesha.md` is
 * `ayesha`.
 */
export function courseSlug(coursePath) {
  return coursePath.split('/').pop().replace(/\.md$/, '');
}

/** Course title from the page's TOML front matter, so emails name the course. */
export function courseTitle(markdown) {
  const match = markdown.match(/^\+\+\+\s*([\s\S]*?)\s*\+\+\+/);
  const title = (match?.[1] ?? '').match(/^\s*title\s*=\s*"([^"]*)"/m);
  return title?.[1] ?? '';
}

/**
 * Renders an amount the way templates/components.html does, so the price in a
 * confirmation mail reads exactly as it does on the page.
 */
function formatPrice(amount) {
  return `€ ${amount}`;
}

/**
 * @param rows parsed CSV rows
 * @param readCourse (coursePath) => markdown | null
 * @param priceRows parsed rows of prices.csv, the only place amounts live
 */
export function buildEvents(rows, readCourse, priceRows) {
  const events = [];
  const problems = [];
  const amounts = new Map();

  // A price belongs to a course, so a date's `kind` is only meaningful next to
  // the course it is on: `kurs-4-termine` means something different under a
  // different course, and nothing at all under most.
  //
  // A repeated pair would resolve differently on each side — a Map keeps the
  // last row, the templates filter and take the first — putting one amount on
  // the page and another in the customer's confirmation mail with nothing to
  // show for it, so it stops the sync instead.
  for (const [index, row] of priceRows.entries()) {
    const key = `${row.course}/${row.kind}`;
    if (amounts.has(key)) {
      problems.push(`prices.csv line ${index + 2}: ${row.course} has "${row.kind}" twice`);
      continue;
    }
    amounts.set(key, row.amount);
  }

  rows.forEach((row, index) => {
    const line = index + 2; // header is line 1
    const coursePath = row.course;
    const startsAt = row['date1-from'];

    if (!coursePath) { problems.push(`coursedates.csv line ${line}: missing course`); return; }
    if (!startsAt) { problems.push(`coursedates.csv line ${line}: missing date1-from`); return; }

    // Blank means unlimited places. A value that is present must still be
    // usable, so a typo cannot quietly turn into "no limit".
    const raw = (row.capacity ?? '').trim();
    let capacity = null;
    if (raw !== '') {
      capacity = Number(raw);
      if (!Number.isInteger(capacity) || capacity <= 0) {
        problems.push(`coursedates.csv line ${line}: capacity must be blank for unlimited, or a positive whole number, got "${row.capacity}"`);
        return;
      }
    }

    const markdown = readCourse(coursePath);
    if (markdown === null) { problems.push(`coursedates.csv line ${line}: no such course page ${coursePath}`); return; }

    // The column names one of that course's prices, resolved here so the
    // Worker, the database and the mails only ever see a finished amount.
    // Blank means the date shows no price; a value that does not resolve is a
    // typo and stops the sync rather than silently dropping the price.
    const kind = (row.kind ?? '').trim();
    let price = '';
    if (kind !== '') {
      const slug = courseSlug(coursePath);
      const amount = amounts.get(`${slug}/${kind}`);
      if (amount === undefined) {
        problems.push(`coursedates.csv line ${line}: ${slug} has no price called "${kind}" in prices.csv`);
        return;
      }
      if (!/^\d+$/.test(amount)) {
        // Otherwise the mail says "Preis:  € " and the page renders a bare sign.
        problems.push(`coursedates.csv line ${line}: ${slug}/${kind} has amount "${amount}", `
          + 'expected a whole number of euro');
        return;
      }
      price = formatPrice(amount);
    }

    events.push({
      id: eventId(coursePath, startsAt),
      course_path: coursePath,
      course_title: courseTitle(markdown),
      name: row.name ?? '',
      price,
      starts_at: startsAt,
      ends_at: row['date1-to'] || null,
      second_starts_at: row['date2-from'] || null,
      second_ends_at: row['date2-to'] || null,
      capacity,
    });
  });

  const ids = events.map((e) => e.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) problems.push(`coursedates.csv: duplicate date for the same course: ${duplicate}`);

  return { events, problems };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const root = process.cwd();

  const rows = parseCsv(readFileSync(join(root, 'coursedates.csv'), 'utf8'));
  const priceRows = parseCsv(readFileSync(join(root, 'prices.csv'), 'utf8'));
  const { events, problems } = buildEvents(rows, (coursePath) => {
    const file = join(root, 'content', coursePath);
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  }, priceRows);

  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }

  // A blank capacity is legitimate, but silently unlimited places is worth
  // saying out loud on every sync so a forgotten limit is visible.
  const unlimited = events.filter((e) => e.capacity === null);
  if (unlimited.length) {
    console.log(`::warning::${unlimited.length} date(s) have no capacity and cannot fill up: `
      + unlimited.map((e) => `${e.course_path} ${e.starts_at}`).join(', '));
  }

  if (dryRun) {
    console.log(JSON.stringify({ events }, null, 2));
    console.log(`\n${events.length} event(s) would be synced`);
    return;
  }

  const api = process.env.BOOKING_API;
  const token = process.env.BOOKING_ADMIN_TOKEN;
  if (!api || !token) {
    console.error('::error::BOOKING_API and BOOKING_ADMIN_TOKEN must be set');
    process.exit(1);
  }

  const response = await fetch(`${api.replace(/\/$/, '')}/api/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`::error::sync failed (${response.status}): ${body}`);
    process.exit(1);
  }
  console.log(`synced ${events.length} event(s): ${body}`);
}

// Only run when invoked directly, so the helpers above stay importable in tests.
if (process.argv[1] && process.argv[1].endsWith('sync-events.mjs')) {
  await main();
}
