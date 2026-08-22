// Covers turning coursedates.csv into the payload the API receives, including
// the malformed input that should stop a sync rather than push bad dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, courseTitle, buildEvents } from '../sync-events.mjs';

const HEADER = 'course,name,price,date1-from,date1-to,date2-from,date2-to,capacity';
const courses = {
  'courses/technic/lollipop.md': '+++\ntitle = "Lollipop ☆"\ntemplate = "courses/bookingpage.html"\n+++\nbody',
  'courses/technic/twinpole.md': '+++\ntitle = "Twinpole ☆"\n+++\n',
};
const readCourse = (path) => courses[path] ?? null;

test('reads quoted fields and commas inside them', () => {
  const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,"Sommer, Teil 1",€39.-,2026-09-01T18:00:00,,,,3`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Sommer, Teil 1');
  assert.equal(rows[0].capacity, '3');
  assert.equal(rows[0]['date2-from'], '');
});

test('doubled quotes become one', () => {
  const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,"He said ""hi""",,2026-09-01T18:00:00,,,,3`);
  assert.equal(rows[0].name, 'He said "hi"');
});

test('blank lines are ignored', () => {
  const rows = parseCsv(`${HEADER}\n\ncourses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,,3\n\n`);
  assert.equal(rows.length, 1);
});

test('the course title comes from the front matter', () => {
  assert.equal(courseTitle(courses['courses/technic/lollipop.md']), 'Lollipop ☆');
  assert.equal(courseTitle('no front matter here'), '');
  assert.equal(courseTitle('+++\nweight = 3\n+++\n'), '');
});

test('a full row becomes an event', () => {
  const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,Sommer,€39.-,2026-09-01T18:00:00,2026-09-01T19:30:00,2026-09-08T18:00:00,2026-09-08T19:30:00,3`);
  const { events, problems } = buildEvents(rows, readCourse);

  assert.deepEqual(problems, []);
  assert.deepEqual(events, [{
    // Slashes are stripped so the id is safe in a URL path.
    id: 'courses-technic-lollipop.md@2026-09-01t18:00:00',
    course_path: 'courses/technic/lollipop.md',
    course_title: 'Lollipop ☆',
    name: 'Sommer',
    price: '€39.-',
    starts_at: '2026-09-01T18:00:00',
    ends_at: '2026-09-01T19:30:00',
    second_starts_at: '2026-09-08T18:00:00',
    second_ends_at: '2026-09-08T19:30:00',
    capacity: 3,
  }]);
});

test('empty optional dates become null rather than empty strings', () => {
  const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,,3`);
  const { events } = buildEvents(rows, readCourse);
  assert.equal(events[0].ends_at, null);
  assert.equal(events[0].second_starts_at, null);
  assert.equal(events[0].second_ends_at, null);
});

test('a blank capacity means unlimited places', () => {
  for (const value of ['', '   ']) {
    const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,,${value}`);
    const { events, problems } = buildEvents(rows, readCourse);
    assert.deepEqual(problems, []);
    assert.equal(events[0].capacity, null, `capacity "${value}" should mean unlimited`);
  }
});

test('a capacity column missing altogether means unlimited', () => {
  const rows = parseCsv('course,name,price,date1-from,date1-to,date2-from,date2-to\ncourses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,');
  const { events, problems } = buildEvents(rows, readCourse);
  assert.deepEqual(problems, []);
  assert.equal(events[0].capacity, null);
});

test('a capacity that is present but unusable stops the sync', () => {
  for (const value of ['0', '-1', 'six', '3.5']) {
    const rows = parseCsv(`${HEADER}\ncourses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,,${value}`);
    const { events, problems } = buildEvents(rows, readCourse);
    assert.equal(events.length, 0, `capacity "${value}" should be rejected`);
    assert.match(problems[0], /blank for unlimited, or a positive whole number/);
  }
});

test('a date pointing at a course page that does not exist stops the sync', () => {
  const rows = parseCsv(`${HEADER}\ncourses/technic/ghost.md,x,,2026-09-01T18:00:00,,,,3`);
  const { events, problems } = buildEvents(rows, readCourse);
  assert.equal(events.length, 0);
  assert.match(problems[0], /no such course page/);
});

test('missing course or start date is reported with the line number', () => {
  const rows = parseCsv(`${HEADER}\n,x,,2026-09-01T18:00:00,,,,3\ncourses/technic/lollipop.md,x,,,,,,3`);
  const { problems } = buildEvents(rows, readCourse);
  assert.match(problems[0], /line 2: missing course/);
  assert.match(problems[1], /line 3: missing date1-from/);
});

test('the same course twice at the same time is rejected', () => {
  const row = 'courses/technic/lollipop.md,x,,2026-09-01T18:00:00,,,,3';
  const { problems } = buildEvents(parseCsv(`${HEADER}\n${row}\n${row}`), readCourse);
  assert.match(problems.at(-1), /duplicate date/);
});

test('the same course at different times is fine', () => {
  const rows = parseCsv([
    HEADER,
    'courses/technic/lollipop.md,Morgens,,2026-09-01T10:00:00,,,,3',
    'courses/technic/lollipop.md,Abends,,2026-09-01T18:00:00,,,,3',
  ].join('\n'));
  const { events, problems } = buildEvents(rows, readCourse);
  assert.deepEqual(problems, []);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
});

test('the repository CSV parses and builds cleanly', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const rows = parseCsv(readFileSync('../coursedates.csv', 'utf8'));
  const { events, problems } = buildEvents(rows, (p) => (
    existsSync(`../content/${p}`) ? readFileSync(`../content/${p}`, 'utf8') : null
  ));
  assert.deepEqual(problems, [], 'the committed CSV must always sync');
  assert.ok(events.length > 0);
  for (const event of events) {
    // null is legitimate and means unlimited; a number must be usable.
    assert.ok(event.capacity === null || event.capacity > 0, `${event.id} has capacity ${event.capacity}`);
    assert.ok(event.course_title, `${event.course_path} has no title`);
  }
});
