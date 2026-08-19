/* A Response body is a one-shot stream.
 *
 * submitPetition used to call response.json() and then, in the catch,
 * response.text(). But .json() consumes the stream before it fails to parse,
 * so the .text() call threw "Body has already been consumed" and destroyed
 * whatever the server actually said. Any non-JSON error body hit this: a
 * static host's HTML 404, an empty gateway error, a plain-text 500.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPetitionScript } from './petition_harness.mjs';

const { errorMessageFromResponse } = loadPetitionScript();
const FALLBACK = 'Unable to generate the petition.';

const jsonResponse = (status, payload) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('a JSON validation error still surfaces the server\'s field messages', async () => {
  const message = await errorMessageFromResponse(
    jsonResponse(400, { errors: ['Petitioner name is required.', 'County is required.'] }),
    FALLBACK
  );
  assert.equal(message, 'Petitioner name is required. County is required.');
});

test('a JSON error with a single "error" key surfaces that', async () => {
  const message = await errorMessageFromResponse(
    jsonResponse(500, { error: 'The petition template could not be opened.' }),
    FALLBACK
  );
  assert.equal(message, 'The petition template could not be opened.');
});

test('an HTML error page does not throw and does not leak markup', async () => {
  const html = '<!DOCTYPE html><html><head><title>Site not found</title></head><body>404</body></html>';
  const message = await errorMessageFromResponse(
    new Response(html, { status: 404, headers: { 'Content-Type': 'text/html' } }),
    FALLBACK
  );
  assert.doesNotMatch(message, /</, `leaked markup: ${message}`);
  assert.ok(message.length > 0);
});

test('a static host 404 explains that the generator needs the server', async () => {
  const message = await errorMessageFromResponse(
    new Response('Not Found', { status: 404 }),
    FALLBACK
  );
  assert.match(message, /server/i, `got: ${message}`);
});

test('an empty gateway error falls back instead of throwing', async () => {
  const message = await errorMessageFromResponse(
    new Response('', { status: 502 }),
    FALLBACK
  );
  assert.match(message, /Unable to generate the petition/);
});

test('a short plain-text error is shown as-is', async () => {
  const message = await errorMessageFromResponse(
    new Response('Petition exceeds the maximum page count.', { status: 400 }),
    FALLBACK
  );
  assert.equal(message, 'Petition exceeds the maximum page count.');
});

test('a long plain-text error is not dumped into the page', async () => {
  const message = await errorMessageFromResponse(
    new Response('x'.repeat(5000), { status: 500 }),
    FALLBACK
  );
  assert.ok(message.length < 200, `message was ${message.length} chars`);
});

test('the body is read exactly once, so nothing throws on any status', async () => {
  const bodies = [
    ['', 502],
    ['plain text', 500],
    ['<html>404</html>', 404],
    ['{"error":"json"}', 400],
    ['{malformed json', 400],
  ];
  for (const [body, status] of bodies) {
    const message = await errorMessageFromResponse(new Response(body, { status }), FALLBACK);
    assert.equal(typeof message, 'string', `status ${status} did not yield a string`);
    assert.ok(message.length > 0, `status ${status} yielded an empty message`);
  }
});
