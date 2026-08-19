/* Loads web/js/petition.js outside a browser.
 *
 * petition.js is a plain script, not a module: it looks up its form elements
 * at top level and wires every listener inside DOMContentLoaded. Stubbing
 * getElementById and swallowing addEventListener is therefore enough to load
 * it. Because the script is non-strict, its top-level function declarations
 * become properties of the sandbox global, which is how the tests reach them.
 */
import fs from 'fs';
import path from 'path';
import url from 'url';
import vm from 'vm';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function stubElement() {
  const el = {
    textContent: '',
    value: '',
    dataset: {},
    disabled: false,
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => stubElement(),
    appendChild() {},
    remove() {},
  };
  return el;
}

export function loadPetitionScript() {
  const sandbox = {
    document: {
      getElementById: () => stubElement(),
      addEventListener() {},
      createElement: () => stubElement(),
      body: stubElement(),
    },
    sessionStorage: {
      getItem: () => null,
      setItem() {},
      removeItem() {},
    },
    window: { location: { href: '' } },
    console,
    fetch: async () => { throw new Error('fetch not stubbed for this test'); },
    Response, Headers, Request,
    URL, JSON, Object, Array, String, Number, Boolean, Math, Date, Error, TypeError,
    parseInt, parseFloat, isNaN, encodeURIComponent,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'web/js/petition.js'), 'utf8'),
    sandbox,
    { filename: 'petition.js' }
  );
  return sandbox;
}
