#!/usr/bin/env node
// Fails when a price names a course page that does not exist, which `zola
// build` cannot: a course with no prices is the ordinary case.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parseCsv } from '../booking/sync-events.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function coursePages(dir) {
  const slugs = new Map();
  const walk = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
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
  const seenKinds = new Set();
  const seenTierCells = new Set();

  prices.forEach((row, index) => {
    const where = `prices.csv line ${index + 2}`;
    if (!row.course) { problems.push(`${where}: missing course`); return; }
    if (!row.kind) { problems.push(`${where}: ${row.course} has a row with no kind`); return; }

    if (!pages.has(row.course)) {
      problems.push(`${where}: there is no course page called "${row.course}.md", `
        + 'so this price is never shown');
    }

    const kind = `${row.course}/${row.kind}`;
    if (seenKinds.has(kind)) problems.push(`${where}: ${row.course} has "${row.kind}" twice`);
    seenKinds.add(kind);

    if (!/^\d+$/.test(row.amount)) {
      problems.push(`${where}: ${kind} has amount "${row.amount}", expected a whole number of euro`);
    }
    if (row.duration && !row.persons) problems.push(`${where}: ${kind} has a duration but no persons`);
    if (!row.duration && row.persons) problems.push(`${where}: ${kind} has persons but no duration`);
    if (!row.duration && !row.label) problems.push(`${where}: ${kind} is a named rate and needs a label`);

    if (row.duration && row.persons) {
      const cell = JSON.stringify([row.course, row.duration, row.persons]);
      if (seenTierCells.has(cell)) {
        problems.push(`${where}: ${row.course} repeats ${row.duration} / ${row.persons}, `
          + 'and only the first of them is ever rendered');
      }
      seenTierCells.add(cell);
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

if (process.argv[1] && process.argv[1].endsWith('check-prices.mjs')) main();
