import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import url from 'url';
import vm from 'vm';
import { screenOneCase, misdoAnswers } from './engine_harness.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function loadBrowserPrefill() {
  const sandbox = {
    window: {},
    Date, JSON, Object, Array, String, Number, Boolean, Math, Error,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'web/js/petition_prefill.js'), 'utf8'),
    sandbox,
    { filename: 'petition_prefill.js' }
  );
  return sandbox.window.petitionPrefill;
}

const prefill = loadBrowserPrefill();
const localDate = (year, month, day) => new Date(year, month - 1, day).getTime();

test('browser state imports every eligible matter with felonies first', () => {
  const state = {
    phase: 'done',
    cases: {
      felonies: [
        {
          case_name: 'CF-2010-100',
          arresting_agency: 'Oklahoma City Police Department',
          arrest_date: localDate(2010, 1, 2),
          addl_arrests: [[localDate(2010, 1, 3), 'Oklahoma County Sheriff']],
          court: 'District Court of Oklahoma County',
          resolved: false,
          convic_dismiss_defer_drug: 1,
          counts: [['Larceny', 'none'], ['Obstruction', 'none']],
          sentencing_date: localDate(2015, 2, 4),
          fines_paid: true,
          treatment: false,
        },
      ],
      misdos: [
        {
          case_name: 'CM-2018-200',
          arresting_agency: 'Tulsa Police Department',
          arrest_date: localDate(2018, 3, 5),
          addl_arrests: [],
          court: 'Tulsa County District Court',
          resolved: false,
          convic_dismiss_defer_drug: 3,
          sentencing_date: localDate(2019, 4, 6),
          fines_paid: true,
          treatment: false,
          fine_amount: 750,
          imprisoned: true,
        },
      ],
      arrests: [
        {
          case_name: 'AR-2020-300',
          arresting_agency: 'Norman Police Department',
          arrest_date: localDate(2020, 7, 8),
          expir_no_risk: true,
          resolved: true,
        },
        {
          case_name: 'AR-2025-400',
          arresting_agency: 'Edmond Police Department',
          arrest_date: localDate(2025, 9, 10),
          expir_no_risk: false,
          resolved: true,
        },
      ],
    },
  };
  const results = [
    {
      type: 'cases',
      data: {
        'CM-2018-200': {
          verdict: 'Expungeable. > 1 year since dismissal and fines, fees, and restitution fully paid.',
        },
        'AR-2025-400': {
          verdict: 'Not expungeable because SOL not expired and prosecutor did not confirm in writing.',
        },
        'CF-2010-100': {
          verdict: 'Expungeable due to nonviolent felony criteria (no other felony convictions, no misdemeanor convictions in the last 7 years, 5 years since sentence completion, all fines paid).',
        },
        'AR-2020-300': {
          verdict: 'Expungeable because of arrest no charges filed.',
        },
      },
    },
  ];

  const data = prefill.buildPetitionPrefill(state, results);

  assert.equal(data.screening_case_count, 4);
  assert.equal(data.eligible_count, 3);
  assert.deepEqual(
    Array.from(data.cases, (matter) => matter.case_level),
    ['felony', 'misdemeanor', 'arrest']
  );

  const [felony, misdemeanor, arrest] = data.cases;
  assert.equal(felony.criminal_case_number, 'CF-2010-100');
  assert.equal(felony.county, 'Oklahoma');
  assert.equal(felony.arrest_date, '2010-01-02');
  assert.equal(felony.offenses, 'Larceny\nObstruction');
  assert.equal(felony.sentence_completion_date, '2015-02-04');
  assert.equal(felony.category_number, '12');
  assert.match(felony.statutory_language, /nonviolent felony offense/);
  assert.equal(felony.additional_dated_facts[0].date, '2010-01-03');
  assert.match(felony.additional_dated_facts[0].info, /Oklahoma County Sheriff/);
  assert.match(felony.additional_facts, /paid all fines/);

  assert.equal(misdemeanor.case_result, 'dismissal');
  assert.equal(misdemeanor.dismissal_date, '2019-04-06');
  assert.equal(misdemeanor.dismissal_reason, 'after the deferred judgment expired');
  assert.equal(misdemeanor.category_number, '8');

  assert.equal(arrest.kind, 'no_file');
  assert.equal(arrest.arrest_date, '2020-07-08');
  assert.equal(arrest.category_number, '5');
  assert.match(arrest.import_notes[0], /AR-2020-300/);
});

test('prefill accepts the real screening engine state and analysis output', async () => {
  const { engine, stored } = await screenOneCase(1, misdoAnswers({
    sentencing_date: '01-15-2010',
    fines_paid: 'yes',
  }));

  const results = await engine.analyze();
  const data = prefill.buildPetitionPrefill(stored, results);

  assert.equal(data.eligible_count, 1);
  assert.equal(data.cases[0].criminal_case_number, 'CM-2024-1');
  assert.equal(data.cases[0].case_level, 'misdemeanor');
  assert.equal(data.cases[0].arrest_date, '2024-01-10');
  assert.equal(data.cases[0].sentence_completion_date, '2010-01-15');
  assert.equal(data.cases[0].category_number, '11');
});

test('browser authority mapping matches every supplied Section 18 category', () => {
  const examples = [
    ['reclassification as misdemeanor', '16', 'subsequently reclassified as a misdemeanor'],
    ['nonviolent felony criteria', '12', 'separate misdemeanor in the last seven (7) years'],
    ['no counts listed in Section 13', '13', 'not more than two felony offenses'],
    ['Fine < $501', '10', 'fine less than Five Hundred One Dollars ($501.00)'],
    ['>= 5 years since sentencing', '11', 'end of the last misdemeanor sentence'],
    ['> 1 year since dismissal', '8', 'successful completion of a deferred judgment'],
    ['The SOL has expired', '7', 'all charges have been dismissed'],
    ['arrest no charges filed', '5', 'no charges of any type'],
  ];

  for (const [phrase, category, languageFragment] of examples) {
    const authority = prefill.eligibilityAuthority(`Expungeable due to ${phrase}.`);
    assert.equal(authority.category_number, category);
    assert.match(authority.statutory_language, new RegExp(languageFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(prefill.eligibilityAuthority('Expungeable for an unmapped reason.'), null);
});

test('negative verdicts never enter the petition', () => {
  assert.equal(prefill.isEligibleVerdict('Immediately expungeable'), true);
  assert.equal(prefill.isEligibleVerdict('Not expungeable because a waiting period remains'), false);
  assert.equal(prefill.isEligibleVerdict('No result'), false);
});

test('only a completed, valid engine state is accepted', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null };

  values.set('engine_state', JSON.stringify({ phase: 'case-details', cases: {} }));
  assert.equal(prefill.readCompletedEngineState(storage), null);

  values.set('engine_state', JSON.stringify({ phase: 'done', cases: { felonies: [] } }));
  assert.equal(prefill.readCompletedEngineState(storage).phase, 'done');

  values.set('engine_state', '{invalid json');
  assert.equal(prefill.readCompletedEngineState(storage), null);
});
