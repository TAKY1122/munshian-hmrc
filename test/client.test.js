const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const hmrc = require('..');

const settings = { ...hmrc.HOSTS.sandbox, clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.test/callback', scopes: ['read:vat', 'write:vat'] };

test('builds the HMRC sign-in address', () => {
  const url = new URL(hmrc.createClient(settings).authorizeUrl('xyz'));
  assert.strictEqual(url.origin, 'https://test-www.tax.service.gov.uk');
  assert.strictEqual(url.searchParams.get('scope'), 'read:vat write:vat');
  assert.strictEqual(url.searchParams.get('state'), 'xyz');
});

test('submits a return with the receipt headers and reports HMRC errors', async () => {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    if (opts.method === 'POST' && url.endsWith('/returns')) {
      return new Response(JSON.stringify({ formBundleNumber: '123' }), { status: 201, headers: { 'Receipt-ID': 'r1', 'X-CorrelationId': 'c1' } });
    }
    return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Nothing here', errors: [{ message: 'Really nothing' }] }), { status: 404 });
  };
  const client = hmrc.createClient(settings);
  const body = hmrc.toHmrcBody('26A1', { 1: 10, 2: 0, 3: 10, 4: 2, 5: 8, 6: 50, 7: 10, 8: 0, 9: 0 }, true);
  const r = await client.submitReturn('123456789', body, { accessToken: 't', fraudHeaders: { 'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER' } });
  assert.deepStrictEqual([r.formBundleNumber, r.receiptId, r.correlationId], ['123', 'r1', 'c1']);
  assert.strictEqual(calls[0].url, 'https://test-api.service.hmrc.gov.uk/organisations/vat/123456789/returns');
  assert.strictEqual(calls[0].opts.headers['Gov-Client-Connection-Method'], 'WEB_APP_VIA_SERVER');
  await assert.rejects(client.getObligations('123456789', { from: '2026-01-01', to: '2026-12-31' }, { accessToken: 't' }), (err) => {
    assert.ok(err instanceof hmrc.HmrcError);
    assert.strictEqual(hmrc.describe(err), 'Nothing here Really nothing');
    return true;
  });
});

test('reads browser details for the fraud headers', () => {
  const d = hmrc.readDevice({ timezoneOffset: -60, screen: { width: '1920', height: 1080 }, userAgent: 'UA', doNotTrack: true });
  assert.deepStrictEqual([d.timezone, d.screen.width, d.userAgent, d.doNotTrack], ['UTC+01:00', 1920, 'UA', true]);
});

test('writes a receipt PDF', async () => {
  const out = new PassThrough();
  const chunks = [];
  out.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => out.on('end', resolve));
  hmrc.writeReceiptPdf({ vrn: '123456789', start: '2026-01-01', end: '2026-03-31', submittedAt: '2026-04-20T10:00:00Z', return: hmrc.toHmrcBody('26A1', { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1, 6: 5, 7: 0, 8: 0, 9: 0 }, true), hmrc: { formBundleNumber: '1' } }, out);
  await done;
  assert.ok(Buffer.concat(chunks).subarray(0, 5).toString() === '%PDF-');
});
