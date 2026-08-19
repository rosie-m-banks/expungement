/* Loads web/js/engine.js the way a browser page does, with sessionStorage and
 * fetch stubbed, so the engine can be driven end-to-end from node.
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import vm from 'vm';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

export function loadEngine() {
  const store = new Map();
  const sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  /* engine.js fetches 'questions/<name>.json' relative to the page. On Pages
   * those files are copied into web/; here they are read from questions/. */
  const fetchStub = async (u) => ({
    json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, u), 'utf8')),
  });

  const win = {};
  const sandbox = {
    window: win, sessionStorage, fetch: fetchStub, console,
    Date, JSON, Object, Array, String, Number, Boolean, Math, Error,
    parseInt, parseFloat, isNaN,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'web/js/engine.js'), 'utf8'),
    sandbox,
    { filename: 'engine.js' }
  );

  const engine = win.engine;

  /* questions.js stashes the pending questions under this key before
   * navigating; submitAnswers reads them back to decode the raw answers. */
  const stash = (questions) =>
    sessionStorage.setItem('current_questions', JSON.stringify(questions));

  return { engine, sessionStorage, stash };
}

/** Walk prelim -> case-type -> case-details for a single case.
 *  caseType: 0 = felony, 1 = misdemeanor, 2 = arrest-only.
 *  Returns the stored (serialized) state plus helpers. */
export async function screenOneCase(caseType, detailAnswers) {
  const { engine, sessionStorage, stash } = loadEngine();

  stash((await engine.start()).questions);
  /* pending=no, out_of_state=no, serving=no, num_cases=1 */
  stash((await engine.submitAnswers(['no', 'no', 'no', '1'])).questions);
  stash((await engine.submitAnswers([String(caseType)])).questions);
  await engine.submitAnswers(detailAnswers);

  return {
    engine,
    stored: JSON.parse(sessionStorage.getItem('engine_state')),
  };
}

/** Format a Date the way questions.js collectAnswers emits it (MM-DD-YYYY). */
export function mmddyyyy(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}-${d}-${date.getFullYear()}`;
}

/** Raw answers for a misdemeanor, in the order shared_questions.json +
 *  misdo_questions.json are concatenated. */
export function misdoAnswers({ sentencing_date, fines_paid = 'yes', disposition = '1' }) {
  return [
    'CM-2024-1',        // case name
    'OKC PD',           // arresting agency
    '01-10-2024',       // arrest date
    '[]',               // additional arrests (optional)
    'Oklahoma County',  // court
    'no',               // resolved by acquittal/pardon/etc
    disposition,        // 1 = Conviction
    'True',             // treatment (hidden unless drug court)
    sentencing_date,    // sentencing / probation-end date
    fines_paid,         // fines, fees, restitution paid
    'False',            // SOL expired etc (hidden unless dismissal)
    '1000',             // fine amount
    'yes',              // imprisonment / suspended / deferred
  ];
}
