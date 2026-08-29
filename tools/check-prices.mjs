#!/usr/bin/env node
//
// Checks that every row in prices.csv belongs to a course page.
//
//   node tools/check-prices.mjs
//
// Prices are keyed by a course's file name, and the page templates look them up
// by `page.slug`. Nothing is written into a course page to give it a price,
// which removes a whole class of mistake — but it creates one the build cannot
// see, and that is the reason this file exists.
//
// A row naming a course that has no page renders nowhere. There is no template
// to fail, because a course with no prices is the normal case: most course
// pages have none, so "no rows matched" cannot be an error at render time. The
// row simply never appears, and editing it looks like publishing a price change
// while nothing on the site moves.
//
// Exits non-zero and prints a GitHub Actions ::error:: line per problem.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Imported rather than copied so there is one CSV reader in the repository.
// Nothing here writes to booking/.
import { parseCsv } from '../booking/sync-events.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The slug of every course page, which is its file name without `.md`. */
export function coursePages(dir) {
  const slugs = new Map();
  const walk = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return; // a broken symlink or unreadable directory is not a price problem
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      // isDirectory() is false for a symlink, so a cycle cannot hang the walk.
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== '_index.md') {
        slugs.set(entry.name.replace(/\.md$/, ''), path);
      }
    }
  };
  walk(dir);
  return slugs;
}

export function checkPrices(prices, pages) {
  const problems = [];
  const seen = new Set();
  const cells = new Set();

  prices.forEach((row, index) => {
    const where = `prices.csv line ${index + 2}`; // header is line 1
    if (!row.course) { problems.push(`${where}: missing course`); return; }
    if (!row.kind) { problems.push(`${where}: ${row.course} has a row with no kind`); return; }

    // The one thing no template can catch: a page that does not exist has no
    // slug to match, so the row renders nowhere and says nothing about it.
    if (!pages.has(row.course)) {
      problems.push(`${where}: there is no course page called "${row.course}.md", `
        + 'so this price is never shown');
    }

    const key = `${row.course}/${row.kind}`;
    if (seen.has(key)) problems.push(`${where}: ${row.course} has "${row.kind}" twice`);
    seen.add(key);

    if (!/^\d+$/.test(row.amount)) {
      problems.push(`${where}: ${key} has amount "${row.amount}", expected a whole number of euro`);
    }
    // A tier row is the one with a duration, and needs a group size with it.
    // A named rate has neither and needs a label to render as "label: € n".
    if (row.duration && !row.persons) problems.push(`${where}: ${key} has a duration but no persons`);
    if (!row.duration && row.persons) problems.push(`${where}: ${key} has persons but no duration`);
    if (!row.duration && !row.label) problems.push(`${where}: ${key} is a named rate and needs a label`);

    // The table renders one cell per duration and group size and takes the
    // first row that matches, so a second row for the same cell never appears —
    // as invisible as a row on a page that does not exist.
    if (row.duration && row.persons) {
      const cell = JSON.stringify([row.course, row.duration, row.persons]);
      if (cells.has(cell)) {
        problems.push(`${where}: ${row.course} repeats ${row.duration} / ${row.persons}, `
          + 'and only the first of them is ever rendered');
      }
      cells.add(cell);
    }
  });

  return problems;
}

function main() {
  const problems = checkPrices(
    parseCsv(readFileSync(join(root, 'prices.csv'), 'utf8')),
    coursePages(join(root, 'content', 'courses')),
  );
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log('every price belongs to a course page');
}

// Matched by name rather than by full path: `import.meta.url` is realpathed and
// argv[1] is not, so comparing them exits zero without checking anything when
// the repository is reached through a symlink.
if (process.argv[1] && process.argv[1].endsWith('check-prices.mjs')) main();
