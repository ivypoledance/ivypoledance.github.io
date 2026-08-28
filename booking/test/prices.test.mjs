// Covers tools/check-prices.mjs, which answers the one question a template
// cannot: is a rate used anywhere at all. A template renders a single page, so
// only a pass over every file can see that nothing references a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCsv } from '../sync-events.mjs';
import { checkPrices, findBlockCalls, sourceFiles } from '../../tools/check-prices.mjs';

const PRICES = 'id,block,label,amount,duration,persons';
const DATES = 'course,name,price_id,date1-from,date1-to,date2-from,date2-to,capacity';
const call = (block, path = 'content/courses/technic/lollipop.md') => ({ path, block });

const run = (prices, calls = [], dates = DATES) => checkPrices(parseCsv(prices), calls, parseCsv(dates));

test('a rate a page calls is fine', () => {
  assert.deepEqual(run(`${PRICES}\ndropin,dropin,Einzeltermin,29,,`, [call('dropin')]), []);
});

test('a rate only a course date names is fine', () => {
  assert.deepEqual(run(
    `${PRICES}\nkurs,,Kurs (4 Termine),82,,`, [],
    `${DATES}\ncourses/technic/lollipop.md,x,kurs,2026-09-01T18:00:00,,,,3`,
  ), []);
});

test('a rate nothing references is an error', () => {
  const problems = run(`${PRICES}\nverwaist,verwaist,Alt,45,,`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /verwaist is never used/);
});

test('a rate with no block that no date names is an error', () => {
  // The block is what a page calls, so without one only a date can reach it.
  const problems = run(`${PRICES}\nkurs,,Kurs,82,,`);
  assert.match(problems.join('\n'), /kurs is never used/);
});

test('a block a page calls but prices.csv does not define is an error', () => {
  const problems = run(`${PRICES}\ndropin,dropin,Einzeltermin,29,,`,
    [call('dropin'), call('tippfehler', 'content/courses/technic/twinpole.md')]);
  assert.match(problems.join('\n'), /twinpole.md: block "tippfehler" is not in prices.csv/);
});

test('a price_id a date names but prices.csv does not define is an error', () => {
  const problems = run(`${PRICES}\nkurs,,Kurs,82,,`, [],
    `${DATES}\ncourses/technic/lollipop.md,x,kurss,2026-09-01T18:00:00,,,,3`);
  assert.match(problems.join('\n'), /price_id "kurss" is not in prices.csv/);
});

test('an amount must be a whole number of euro', () => {
  // A comma would also split the CSV field, so it is refused twice over.
  for (const amount of ['"45,50"', '"€ 45"', 'frei', '']) {
    const problems = run(`${PRICES}\nx,x,Test,${amount},,`, [call('x')]);
    assert.ok(problems.some((p) => /expected a whole number of euro/.test(p)),
      `amount ${amount} should be rejected`);
  }
});

test('a tier row needs both duration and persons', () => {
  assert.match(run(`${PRICES}\nx,x,,50,1 Stunde,`, [call('x')]).join('\n'), /duration but no persons/);
  assert.match(run(`${PRICES}\nx,x,,50,,einzeln`, [call('x')]).join('\n'), /persons but no duration/);
});

test('a named rate needs a label', () => {
  assert.match(run(`${PRICES}\nx,x,,50,,`, [call('x')]).join('\n'), /needs a label/);
});

test('a duplicate id is an error', () => {
  assert.match(run(`${PRICES}\nx,x,A,10,,\nx,x,B,20,,`, [call('x')]).join('\n'), /duplicate id "x"/);
});

test('block calls are found in markdown, with the file that holds them', () => {
  const found = findBlockCalls([
    { path: 'a.md', text: 'text\n{{ <prices block="dropin-29" /> }}\nmore' },
    { path: 'b.md', text: '  {{ <prices block="privat" /> }}\n{{ <prices block="schnupper" /> }}' },
    { path: 'c.md', text: 'no calls here' },
  ]);
  assert.deepEqual(found, [
    { path: 'a.md', block: 'dropin-29' },
    { path: 'b.md', block: 'privat' },
    { path: 'b.md', block: 'schnupper' },
  ]);
});

test('every call form Zola accepts counts as a use', () => {
  // Missing one of these would report a price that is on the site as unused and
  // block a deploy over it. The braced form is how the sibling `de_datetime`
  // component is called in templates/courses/bookingpage.html.
  const forms = [
    '{{ <prices block="x" /> }}',
    "{{ <prices block='x' /> }}",
    '{{ <prices block={"x"} /> }}',
    "{{ <prices block={'x'} /> }}",
    '{{<prices block="x"/>}}',
    '{{ <prices block = "x" /> }}',
    '{{ <prices\n   block="x" /> }}',
  ];
  for (const text of forms) {
    assert.deepEqual(findBlockCalls([{ path: 'p.md', text }]), [{ path: 'p.md', block: 'x' }],
      `not recognised: ${JSON.stringify(text)}`);
  }
});

test('a call in a comment is not a use', () => {
  // templates/components.html documents the component with an example call. If
  // that counted, the rate it names could never be reported as orphaned.
  for (const text of ['{# {{ <prices block="doc" /> }} #}', '<!-- {{ <prices block="doc" /> }} -->']) {
    assert.deepEqual(findBlockCalls([{ path: 'p.md', text }]), [], text);
  }
});

test('an argument that is not a plain string is reported, not guessed', () => {
  // Reading the source cannot say which block these render, so counting them
  // either way would orphan a live rate or vouch for a dead one.
  for (const text of ['{{ <prices block={b} /> }}', '{{ <prices block={"pro" ~ "be"} /> }}',
    '{{ <prices block=x /> }}']) {
    const [found] = findBlockCalls([{ path: 'p.md', text }]);
    assert.equal(found.block, undefined, `should not resolve: ${text}`);
    assert.match(found.unresolved, /^<prices/);
    assert.match(checkPrices(parseCsv(PRICES), [found], parseCsv(DATES)).join('\n'),
      /does not name a block as a plain string/);
  }
});

test('the quoted excerpt stays on one short line', () => {
  // A stray `<prices` in a file with no `>` runs to the end of the file. A
  // GitHub Actions ::error:: command is a single line, so an untrimmed excerpt
  // would push the message itself out of the annotation and into the log.
  const [found] = findBlockCalls([{ path: 'p.md', text: `<prices ${'lang und\n'.repeat(400)}` }]);
  assert.ok(found.unresolved.length <= 64, `excerpt is ${found.unresolved.length} chars`);
  assert.ok(!found.unresolved.includes('\n'), 'excerpt must be one line');
  const [problem] = checkPrices(parseCsv(PRICES), [found], parseCsv(DATES));
  assert.ok(!problem.includes('\n'), 'the whole problem must be one line');
});

test('a second row for the same tier cell is an error, because it never renders', () => {
  // The table takes the first row matching a duration and group size, so a
  // second one is as invisible as an unused row while looking referenced.
  const problems = run(
    `${PRICES}\na,privat,,59,1 Stunde,einzeln\nb,privat,,61,1 Stunde,einzeln`,
    [call('privat')],
  );
  assert.match(problems.join('\n'), /b repeats 1 Stunde \/ einzeln in block "privat"/);
});

test('block-less rows may repeat a tier cell, since no table renders them', () => {
  // They are named by a course date, not shown in a block, so there is nothing
  // for the first row to shadow.
  assert.deepEqual(run(
    `${PRICES}\na,,Workshop A,55,3 Stunden,Gruppe\nb,,Workshop B,65,3 Stunden,Gruppe`, [],
    `${DATES}\ncourses/technic/lollipop.md,x,a,2026-09-01T18:00:00,,,,3`
    + `\ncourses/technic/twinpole.md,y,b,2026-09-02T18:00:00,,,,3`,
  ), []);
});

test('the same tier cell in a different block is fine', () => {
  assert.deepEqual(run(
    `${PRICES}\na,privat,,59,1 Stunde,einzeln\nb,spiral,,59,1 Stunde,einzeln`,
    [call('privat'), call('spiral')],
  ), []);
});

test('the committed prices are all used and well formed', () => {
  // Uses the tool's own file discovery, so a regression there fails here rather
  // than quietly narrowing what CI looks at.
  const root = '..';
  const problems = checkPrices(
    parseCsv(readFileSync(join(root, 'prices.csv'), 'utf8')),
    findBlockCalls(sourceFiles([join(root, 'content'), join(root, 'templates')])),
    parseCsv(readFileSync(join(root, 'coursedates.csv'), 'utf8')),
  );
  assert.deepEqual(problems, [], 'every committed price must be used and well formed');
});

test('the walk finds markdown and templates, and survives a bad path', () => {
  const files = sourceFiles(['../content', '../templates', '../does-not-exist']);
  const paths = files.map((f) => f.path);
  assert.ok(paths.includes('content/courses/technic/spiral.md'), 'nested markdown');
  assert.ok(paths.includes('templates/components.html'), 'templates are walked too');
  assert.ok(paths.some((p) => p.startsWith('content/courses/courses-and-booking/')), 'recurses');
  assert.ok(files.every((f) => /\.(md|html)$/.test(f.path)), 'only sources');
  assert.ok(paths.every((p) => p.startsWith('content/') || p.startsWith('templates/')),
    'returns nothing outside the directories it was given');
});
