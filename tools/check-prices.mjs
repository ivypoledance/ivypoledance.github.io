#!/usr/bin/env node
//
// Checks that every row in prices.csv is reachable and well formed.
//
//   node tools/check-prices.mjs
//
// A reference that does not resolve already fails `zola build`, because the
// templates index the matching row directly, and fails the sync, which reports
// it. This covers the other direction, which neither can see: a rate that
// nothing uses. A template renders one page at a time and so can never answer
// "is this used anywhere in the repository"; only a pass over every file can.
//
// That matters because an unused rate is silent. Editing it looks like
// publishing a price change, and nothing on the site moves.
//
// A row is reachable if something calls its block, or a course date names its
// id. Rows with no block exist for dates alone and are reached that way.
//
// Exits non-zero and prints a GitHub Actions ::error:: line per problem.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

import { parseCsv } from '../booking/sync-events.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Each call, taken up to the `/` that closes it.
const CALL = /<prices\b[^>]*/g;
// The argument, in every form Zola accepts: a double- or single-quoted literal,
// optionally braced. The braced form is how the sibling `de_datetime` component
// is called in templates/courses/bookingpage.html, so it is not exotic here.
// Missing a form would report a price that is on the site as unused, which is
// the one mistake this file must not make.
//
// The whole argument has to be consumed, hence the anchored tail. Allowing a
// trailing remainder would read `block={"pro" ~ "be"}` as the literal "pro" and
// report a block nobody wrote.
const LITERAL = new RegExp(
  '^<prices\\s+block\\s*=\\s*'
  + '(?:\\{\\s*(?:"([^"]*)"|\'([^\']*)\')\\s*\\}|"([^"]*)"|\'([^\']*)\')'
  + '\\s*/?\\s*$',
);
// Tera and HTML comments. A comment showing how to call the component — as the
// documentation above `prices` in templates/components.html does — must not
// count as a use, or the rate it names can never be reported as orphaned.
const COMMENTS = [/\{#[\s\S]*?#\}/g, /<!--[\s\S]*?-->/g];

/**
 * One line, short enough to quote in an error.
 *
 * `CALL` runs to the next `>` or, if the file has none, to its end: seven files
 * under content/ contain no `>` at all. A GitHub Actions `::error::` command is
 * a single line, so an untrimmed excerpt would push the message itself past the
 * first newline and out of the annotation.
 */
function excerpt(call) {
  const oneLine = call.trim().replace(/\s+/g, ' ');
  return oneLine.length > 60 ? `${oneLine.slice(0, 60)} …` : oneLine;
}

/**
 * Every `prices` call in the given files. A call whose argument is not a string
 * literal — a variable, or an expression — cannot be resolved by reading the
 * source, and is returned as `unresolved` rather than guessed at.
 */
export function findBlockCalls(files) {
  const calls = [];
  for (const { path, text } of files) {
    const stripped = COMMENTS.reduce((acc, re) => acc.replace(re, ''), text);
    for (const [call] of stripped.matchAll(CALL)) {
      const literal = call.match(LITERAL);
      if (literal) calls.push({ path, block: literal.slice(1).find((g) => g !== undefined) });
      else calls.push({ path, unresolved: excerpt(call) });
    }
  }
  return calls;
}

/** Markdown and template sources, the two places a component can be called. */
export function sourceFiles(dirs) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a broken symlink or unreadable directory is not a price problem
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      // isDirectory() is false for a symlink, so a cycle cannot hang the walk.
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.(md|html)$/.test(entry.name)) {
        out.push({ path: relative(root, path), text: readFileSync(path, 'utf8') });
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return out;
}

export function checkPrices(prices, calls, courseDates) {
  const problems = [];
  const blocks = new Set(prices.map((r) => r.block).filter((b) => b !== ''));
  const ids = new Set(prices.map((r) => r.id));
  const usedBlocks = new Set(calls.filter((c) => c.block !== undefined).map((c) => c.block));
  const usedIds = new Set(courseDates.map((r) => (r.price_id ?? '').trim()).filter((v) => v !== ''));

  // Reading the source cannot say which block such a call renders, so it cannot
  // be counted as a use and cannot be checked. Reporting it is the honest
  // answer: guessing would either orphan a live rate or vouch for a dead one.
  for (const { path, unresolved } of calls.filter((c) => c.unresolved)) {
    problems.push(`${path}: \`${unresolved}\` does not name a block as a plain `
      + 'string, so it cannot be checked — write the block name literally');
  }

  const seenIds = new Set();
  const seenCells = new Set();
  prices.forEach((row, index) => {
    const where = `prices.csv line ${index + 2}`; // header is line 1
    if (!row.id) { problems.push(`${where}: missing id`); return; }
    if (seenIds.has(row.id)) problems.push(`${where}: duplicate id "${row.id}"`);
    seenIds.add(row.id);

    if (!/^\d+$/.test(row.amount)) {
      problems.push(`${where}: ${row.id} has amount "${row.amount}", expected a whole number of euro`);
    }
    // A tier row is the one with a duration, and needs a group size with it.
    // A named rate has neither and needs a label to render as "label: € n".
    if (row.duration && !row.persons) problems.push(`${where}: ${row.id} has a duration but no persons`);
    if (!row.duration && row.persons) problems.push(`${where}: ${row.id} has persons but no duration`);
    if (!row.duration && !row.label) problems.push(`${where}: ${row.id} is a named rate and needs a label`);

    // The table renders one cell per duration and group size and takes the
    // first row that matches, so a second row for the same cell never appears.
    // It would pass the reachability test below while being just as invisible
    // as an unused row, which is the thing this file exists to prevent. Rows
    // with no block are named by a date and never reach the table, so they are
    // free to repeat a duration and group size.
    if (row.block && row.duration && row.persons) {
      const cell = JSON.stringify([row.block, row.duration, row.persons]);
      if (seenCells.has(cell)) {
        problems.push(`${where}: ${row.id} repeats ${row.duration} / ${row.persons} in block `
          + `"${row.block}", and only the first of them is ever rendered`);
      }
      seenCells.add(cell);
    }

    if (!((row.block && usedBlocks.has(row.block)) || usedIds.has(row.id))) {
      problems.push(`${where}: ${row.id} is never used — nothing calls `
        + `${row.block ? `block "${row.block}"` : 'a block'} and no course date names it`);
    }
  });

  // The other direction is already caught by the build and the sync, but saying
  // so here too costs nothing and gives the better message.
  for (const { path, block } of calls.filter((c) => c.block !== undefined)) {
    if (!blocks.has(block)) problems.push(`${path}: block "${block}" is not in prices.csv`);
  }
  courseDates.forEach((row, index) => {
    const id = (row.price_id ?? '').trim();
    if (id !== '' && !ids.has(id)) {
      problems.push(`coursedates.csv line ${index + 2}: price_id "${id}" is not in prices.csv`);
    }
  });

  return problems;
}

function main() {
  const read = (name) => parseCsv(readFileSync(join(root, name), 'utf8'));
  const problems = checkPrices(
    read('prices.csv'),
    findBlockCalls(sourceFiles([join(root, 'content'), join(root, 'templates')])),
    read('coursedates.csv'),
  );
  if (problems.length) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log('every price is used and well formed');
}

// Matched by name rather than by full path: `import.meta.url` is realpathed and
// argv[1] is not, so comparing them exits zero without checking anything when
// the repository is reached through a symlink.
if (process.argv[1] && process.argv[1].endsWith('check-prices.mjs')) main();
