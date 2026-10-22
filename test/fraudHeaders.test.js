const test = require('node:test');
const assert = require('node:assert');
const { buildFraudHeaders, formatTimezone } = require('../src/fraudHeaders');

const product = { name: 'munshian-vat', version: '0.1.0' };

test('formats browser timezone offsets the way HMRC expects', () => {
  assert.strictEqual(formatTimezone(0), 'UTC+00:00');
  assert.strictEqual(formatTimezone(-60), 'UTC+01:00');
  assert.strictEqual(formatTimezone(330), 'UTC-05:30');
});

test('builds WEB_APP_VIA_SERVER headers from request and browser data', () => {
  const h = buildFraudHeaders({
    clientIp: '::ffff:203.0.113.6',
    clientPort: 51234,
    deviceId: 'beec798b-b366-47fa-b1f8-92cede14a1ce',
    userId: 'user 1',
    device: {
      timezone: 'UTC+01:00',
      screen: { width: 1920, height: 1080, 'scaling-factor': 1, 'colour-depth': 24 },
      window: { width: 1256, height: 803 },
      userAgent: 'Mozilla/5.0',
      doNotTrack: false,
    },
    product,
    vendorPublicIp: '198.51.100.7',
    licenseKey: 'abc',
    multiFactor: { type: 'TOTP', timestamp: new Date('2026-10-20T23:15:42.123Z'), uniqueReference: 'abc123' },
  });
  assert.strictEqual(h['Gov-Client-Multi-Factor'], 'type=TOTP&timestamp=2026-10-20T23%3A15Z&unique-reference=abc123');
  assert.strictEqual(h['Gov-Client-Connection-Method'], 'WEB_APP_VIA_SERVER');
  assert.strictEqual(h['Gov-Client-Public-IP'], '203.0.113.6');
  assert.strictEqual(h['Gov-Client-Public-Port'], '51234');
  assert.match(h['Gov-Client-Public-IP-Timestamp'], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.strictEqual(h['Gov-Client-User-IDs'], 'munshian-vat=user%201');
  assert.strictEqual(h['Gov-Client-Screens'], 'width=1920&height=1080&scaling-factor=1&colour-depth=24');
  assert.strictEqual(h['Gov-Client-Window-Size'], 'width=1256&height=803');
  assert.strictEqual(h['Gov-Client-Browser-Do-Not-Track'], 'false');
  assert.strictEqual(h['Gov-Vendor-Version'], 'munshian-vat=0.1.0');
  assert.strictEqual(h['Gov-Vendor-Forwarded'], 'by=198.51.100.7&for=203.0.113.6');
  assert.match(h['Gov-Vendor-License-IDs'], /^munshian-vat=[0-9a-f]{64}$/);
});

test('leaves out headers it could not collect', () => {
  const h = buildFraudHeaders({ clientIp: '127.0.0.1', clientPort: 1, deviceId: 'x', userId: 'u', product });
  assert.ok(!('Gov-Client-Screens' in h));
  assert.ok(!('Gov-Vendor-Public-IP' in h));
  assert.ok(!('Gov-Vendor-License-IDs' in h));
});
