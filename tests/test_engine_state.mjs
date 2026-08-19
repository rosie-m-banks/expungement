/* Dates entered by the attorney must survive the trip through sessionStorage.
 *
 * They did not: _handleCaseDetails pushed an already-serialized case onto
 * state.cases, and saveState then serialized the whole array a second time.
 * On that second pass every date was already a number of milliseconds, and
 * dateToMs returns null for anything that is not a Date instance. So every
 * date silently became null, which either crashed the results page or, worse,
 * made a case sentenced yesterday look like it had cleared a five-year wait.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEngine, screenOneCase, misdoAnswers, mmddyyyy } from './engine_harness.mjs';

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);

test('dates entered for a misdemeanor survive being saved to sessionStorage', async () => {
  const { stored } = await screenOneCase(1, misdoAnswers({
    sentencing_date: '01-15-2024',
  }));

  const misdo = stored.cases.misdos[0];
  assert.notEqual(misdo.sentencing_date, null, 'sentencing_date was nulled on save');
  assert.notEqual(misdo.arrest_date, null, 'arrest_date was nulled on save');
  assert.equal(
    new Date(misdo.sentencing_date).getTime(),
    new Date(2024, 0, 15).getTime()
  );
  assert.equal(
    new Date(misdo.arrest_date).getTime(),
    new Date(2024, 0, 10).getTime()
  );
});

test('dates entered for a felony survive being saved to sessionStorage', async () => {
  /* shared_questions.json + felony_questions.json */
  const { stored } = await screenOneCase(0, [
    'CF-2024-1', 'OKC PD', '01-10-2024', '[]', 'Oklahoma County',
    'no', '1', 'True', '01-15-2024', 'yes', 'False',
    [['Larceny of merchandise from retailer', 'none']],
  ]);

  const felony = stored.cases.felonies[0];
  assert.notEqual(felony.sentencing_date, null, 'sentencing_date was nulled on save');
  assert.notEqual(felony.arrest_date, null, 'arrest_date was nulled on save');
});

test('arrest-only case keeps its arrest date', async () => {
  const { stored } = await screenOneCase(2, ['A-2024-1', 'OKC PD', '01-10-2024', 'yes']);
  assert.notEqual(stored.cases.arrests[0].arrest_date, null);
});

test('a recent conviction with fines unpaid does not crash the results page', async () => {
  const { engine } = await screenOneCase(1, misdoAnswers({
    sentencing_date: mmddyyyy(YESTERDAY),
    fines_paid: 'no',
  }));

  /* Threw "can't access property getTime, date is null" before the fix. */
  const out = await engine.analyze();
  const verdict = out.find((o) => o.type === 'cases').data['CM-2024-1'].verdict;
  assert.match(verdict, /[Nn]ot expungeable/);
});

test('a conviction sentenced yesterday has not cleared the five-year wait', async () => {
  const { engine } = await screenOneCase(1, misdoAnswers({
    sentencing_date: mmddyyyy(YESTERDAY),
    fines_paid: 'yes',
  }));

  const out = await engine.analyze();
  const verdict = out.find((o) => o.type === 'cases').data['CM-2024-1'].verdict;
  assert.match(verdict, /< 5 years/, `reported "${verdict}"`);
});

test('the results page reports the dates the attorney entered', async () => {
  const { engine } = await screenOneCase(1, misdoAnswers({
    sentencing_date: '01-15-2024',
  }));

  const out = await engine.analyze();
  const details = out.find((o) => o.type === 'cases').data['CM-2024-1'].details;
  assert.match(details, /Arrest date: 01-10-2024/);
  assert.match(details, /Sentencing date: 01-15-2024/);
});

test('dates survive a multi-case screening, which saves and loads repeatedly', async () => {
  const { engine, sessionStorage, stash } = loadEngine();

  stash((await engine.start()).questions);
  stash((await engine.submitAnswers(['no', 'no', 'no', '3'])).questions);

  stash((await engine.submitAnswers(['0'])).questions);
  stash((await engine.submitAnswers([
    'CF-2019-1', 'OKC PD', '01-10-2019', [['02-01-2019', 'Tulsa PD']], 'Oklahoma County',
    'no', '1', 'True', '03-15-2019', 'yes', 'False', [['Larceny', 'none']],
  ])).questions);

  stash((await engine.submitAnswers(['1'])).questions);
  stash((await engine.submitAnswers([
    'CM-2020-2', 'Tulsa PD', '05-10-2020', '[]', 'Tulsa County',
    'no', '1', 'True', '06-20-2020', 'yes', 'False', '250', 'no',
  ])).questions);

  stash((await engine.submitAnswers(['2'])).questions);
  await engine.submitAnswers(['A-2021-3', 'Norman PD', '07-04-2021', 'yes']);

  const { cases } = JSON.parse(sessionStorage.getItem('engine_state'));
  const nulled = [];
  for (const [kind, list] of Object.entries(cases)) {
    for (const c of list) {
      if (c.arrest_date === null) nulled.push(`${kind}/${c.case_name}/arrest_date`);
      if ('sentencing_date' in c && c.sentencing_date === null) {
        nulled.push(`${kind}/${c.case_name}/sentencing_date`);
      }
      for (const a of c.addl_arrests || []) {
        if (Array.isArray(a) && a[0] === null) nulled.push(`${kind}/${c.case_name}/addl_arrest`);
      }
    }
  }
  assert.deepEqual(nulled, [], `nulled dates: ${nulled.join(', ')}`);

  /* The additional-arrest pairs are the fiddliest field: a date inside an array. */
  const out = await engine.analyze();
  const details = out.find((o) => o.type === 'cases').data['CF-2019-1'].details;
  assert.match(details, /Additional arrests: 02-01-2019 \(Tulsa PD\)/);
});
