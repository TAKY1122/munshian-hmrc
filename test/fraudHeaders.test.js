const test = require('node:test');
const assert = require('node:assert');
const { buildFraudHeaders, formatTimezone, readDevice } = require('../src/fraudHeaders');

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

test('omits missing screen, window and vendor values instead of sending undefined', () => {
  const device = readDevice({
    timezoneOffset: 0,
    screen: { width: 1920, height: '', 'scaling-factor': 'nope', 'colour-depth': null },
    window: { width: undefined, height: 640 },
    userAgent: 'Mozilla/5.0',
  });
  const h = buildFraudHeaders({
    clientIp: '::ffff:203.0.113.6',
    clientPort: undefined,
    deviceId: undefined,
    userId: undefined,
    device,
    product: { name: 'munshian-vat', version: undefined },
    vendorPublicIp: '198.51.100.7',
    multiFactor: { type: undefined, timestamp: undefined, uniqueReference: undefined },
  });
  const wire = [...new Headers(h).entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
  assert.doesNotMatch(wire, /undefined|null/i);
  assert.strictEqual(h['Gov-Client-Screens'], 'width=1920');
  assert.strictEqual(h['Gov-Client-Window-Size'], 'height=640');
  assert.ok(!('Gov-Client-Public-Port' in h));
  assert.ok(!('Gov-Client-Device-ID' in h));
  assert.ok(!('Gov-Client-User-IDs' in h));
  assert.ok(!('Gov-Vendor-Version' in h));
  assert.strictEqual(h['Gov-Vendor-Product-Name'], 'munshian-vat');
  assert.strictEqual(h['Gov-Vendor-Public-IP'], '198.51.100.7');
  assert.strictEqual(h['Gov-Vendor-Forwarded'], 'by=198.51.100.7&for=203.0.113.6');
  assert.ok(!('Gov-Client-Multi-Factor' in h));

  const noClientIp = buildFraudHeaders({
    vendorPublicIp: '198.51.100.7',
    deviceId: null,
    userId: 'u',
    product,
  });
  assert.strictEqual(noClientIp['Gov-Vendor-Public-IP'], '198.51.100.7');
  assert.ok(!('Gov-Vendor-Forwarded' in noClientIp));
  assert.ok(!('Gov-Client-Public-IP' in noClientIp));
  assert.ok(!('Gov-Client-Device-ID' in noClientIp));
  assert.doesNotMatch([...new Headers(noClientIp).values()].join('\n'), /undefined|null/i);
});

test('drops a key whose value was passed in as undefined', () => {
  const h = buildFraudHeaders({
    clientIp: '203.0.113.6',
    clientPort: 51234,
    deviceId: 'beec798b-b366-47fa-b1f8-92cede14a1ce',
    userId: 'user 1',
    device: {
      timezone: 'UTC+00:00',
      screen: { width: 1920, height: undefined, 'scaling-factor': 1, 'colour-depth': 24 },
      window: { width: undefined, height: undefined },
      userAgent: 'Mozilla/5.0',
      doNotTrack: false,
    },
    product,
  });
  assert.strictEqual(h['Gov-Client-Screens'], 'width=1920&scaling-factor=1&colour-depth=24');
  assert.ok(!('Gov-Client-Window-Size' in h));
  assert.doesNotMatch(JSON.stringify(h), /undefined|null/i);
});
