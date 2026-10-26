const test = require('node:test');
const assert = require('node:assert');
const { validateBoxes, toHmrcBody, netDirection, toNumber } = require('../src/vatReturn');

const good = { 1: 123, 2: 0, 3: 123, 4: 0, 5: 123, 6: 615, 7: 0, 8: 0, 9: 0 };

test('accepts a correct return', () => {
  const { errors } = validateBoxes(good);
  assert.deepStrictEqual(errors, []);
});

test('accepts money written as text with £ and commas', () => {
  const { boxes, errors } = validateBoxes({ ...good, 1: '£1,000.10', 3: '1,000.10', 5: 1000.1, 6: '5,000' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(boxes[1], 1000.1);
});

test('does not trip over floating point when adding pence', () => {
  const { errors } = validateBoxes({ ...good, 1: 0.1, 2: 0.2, 3: 0.3, 5: 0.3 });
  assert.deepStrictEqual(errors, []);
});

test('flags box 3 and box 5 that do not add up', () => {
  const { errors } = validateBoxes({ ...good, 3: 120, 5: 120 });
  assert.ok(errors.some((e) => e.startsWith('Box 3 should be')));
  const r2 = validateBoxes({ ...good, 4: 23, 5: 123 });
  assert.ok(r2.errors.some((e) => e.startsWith('Box 5 should be')));
});

test('box 5 is the difference either way, so reclaims work', () => {
  const values = { ...good, 1: 100, 3: 100, 4: 250, 5: 150 };
  const { boxes, errors } = validateBoxes(values);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(netDirection(boxes), 'reclaim');
});

test('rejects hex and scientific notation instead of treating them as amounts', () => {
  assert.ok(Number.isNaN(toNumber('0x10')));
  assert.ok(Number.isNaN(toNumber('1e3')));
  assert.ok(Number.isNaN(toNumber('0b10')));
  assert.ok(Number.isNaN(toNumber('1.2.3')));
  assert.strictEqual(toNumber('-12.50'), -12.5);
  assert.strictEqual(toNumber(16), 16);
  const { errors } = validateBoxes({ ...good, 1: '0x10' });
  assert.ok(errors.some((e) => e.startsWith('Box 1 is not a number')));
});

test('flags empty boxes, pence in boxes 6 to 9, and too many decimals', () => {
  const { errors } = validateBoxes({ ...good, 2: '', 6: 615.5, 1: 123.456 });
  assert.ok(errors.includes('Box 2 is empty'));
  assert.ok(errors.includes('Box 6 must be whole pounds (no pence)'));
  assert.ok(errors.includes('Box 1 can have at most 2 decimal places'));
});

test('maps boxes to the field names HMRC expects', () => {
  const { boxes } = validateBoxes(good);
  assert.deepStrictEqual(toHmrcBody('18A2', boxes, true), {
    periodKey: '18A2',
    vatDueSales: 123,
    vatDueAcquisitions: 0,
    totalVatDue: 123,
    vatReclaimedCurrPeriod: 0,
    netVatDue: 123,
    totalValueSalesExVAT: 615,
    totalValuePurchasesExVAT: 0,
    totalValueGoodsSuppliedExVAT: 0,
    totalAcquisitionsExVAT: 0,
    finalised: true,
  });
});
