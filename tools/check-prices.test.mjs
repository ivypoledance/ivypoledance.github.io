import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCsv } from '../booking/sync-events.mjs';
import { checkPrices, coursePages } from './check-prices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRICES = 'course,label,amount,duration,persons';
const pages = (...slugs) => new Map(slugs.map((s) => [s, `content/courses/technic/${s}.md`]));
const run = (prices, slugs = ['ayesha']) => checkPrices(parseCsv(prices), pages(...slugs));

test('a price on a course that exists is fine', () => {
  assert.deepEqual(run(`${PRICES}\nayesha,Einzeltermin/Drop-in,29,,`), []);
});

test('a price naming a course page that does not exist is an error', () => {
  const problems = run(`${PRICES}\ntippfehler,Drop-in,29,,`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no course page called "tippfehler.md"/);
});

test('several prices on one course are fine', () => {
  assert.deepEqual(run(
    `${PRICES}\nayesha,Drop-in,29,,\nayesha,Technik-Special,39,,`,
  ), []);
});

test('an amount must be a whole number of euro', () => {
  for (const amount of ['"45,50"', '"€ 45"', 'frei', '']) {
    assert.ok(run(`${PRICES}\nayesha,Test,${amount},,`)
      .some((p) => /expected a whole number of euro/.test(p)), `amount ${amount} should be rejected`);
  }
});

test('a tier row needs both duration and persons', () => {
  assert.match(run(`${PRICES}\nayesha,,50,1 Stunde,`).join('\n'), /duration but no persons/);
  assert.match(run(`${PRICES}\nayesha,,50,,einzeln`).join('\n'), /persons but no duration/);
});

test('a named rate needs a label', () => {
  assert.match(run(`${PRICES}\nayesha,,50,,`).join('\n'), /needs a label/);
});

test('a repeated tier cell is an error, because only the first renders', () => {
  assert.match(run(`${PRICES}\nayesha,,59,1 Stunde,einzeln\nayesha,,61,1 Stunde,einzeln`).join('\n'),
    /ayesha repeats 1 Stunde \/ einzeln/);
});

test('the same tier cell on a different course is fine', () => {
  assert.deepEqual(run(
    `${PRICES}\nayesha,,59,1 Stunde,einzeln\nspiral,,59,1 Stunde,einzeln`, ['ayesha', 'spiral'],
  ), []);
});

test('course pages are found by file name, ignoring section indexes', () => {
  const found = coursePages(join(root, 'content', 'courses'));
  assert.ok(found.has('ayesha'), 'nested page');
  assert.ok(found.has('private-lessons-trial'), 'another section');
  assert.ok(!found.has('_index'), 'section files are not courses');
  assert.equal(coursePages(join(root, 'does-not-exist')).size, 0, 'a missing directory is not a crash');
});

test('the committed prices all belong to a course page', () => {
  const problems = checkPrices(
    parseCsv(readFileSync(join(root, 'prices.csv'), 'utf8')),
    coursePages(join(root, 'content', 'courses')),
  );
  assert.deepEqual(problems, [], 'the committed prices must always belong to a page');
});
