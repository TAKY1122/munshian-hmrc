// The 9 VAT boxes, the field names HMRC's submit API uses for them, HMRC's own wording, and HMRC's rules.
// Rules: https://developer.service.hmrc.gov.uk/api-documentation/docs/api/service/vat-api/1.0
const BOXES = [
  { box: 1, field: 'vatDueSales', label: 'VAT due on sales', pence: true, hmrcLabel: 'VAT due in the period on sales and other outputs' },
  { box: 2, field: 'vatDueAcquisitions', label: 'VAT due on acquisitions from other EC member states', pence: true, hmrcLabel: 'VAT due in the period on acquisitions of goods made in Northern Ireland from EU Member States' },
  { box: 3, field: 'totalVatDue', label: 'Total VAT due', pence: true, hmrcLabel: 'Total VAT due (this is the total of box 1 and 2)' },
  { box: 4, field: 'vatReclaimedCurrPeriod', label: 'VAT reclaimed on purchases', pence: true, hmrcLabel: 'VAT reclaimed in the period on purchases and other inputs (including acquisitions in Northern Ireland from EU member states)' },
  { box: 5, field: 'netVatDue', label: 'Net VAT to pay or reclaim', pence: true, positive: true, hmrcLabel: 'Net VAT to pay to HMRC or reclaim (this is the difference between box 3 and 4)' },
  { box: 6, field: 'totalValueSalesExVAT', label: 'Total value of sales ex VAT', pence: false, hmrcLabel: 'Total value of sales and all other outputs excluding any VAT' },
  { box: 7, field: 'totalValuePurchasesExVAT', label: 'Total value of purchases ex VAT', pence: false, hmrcLabel: 'Total value of purchases and all other inputs excluding any VAT' },
  { box: 8, field: 'totalValueGoodsSuppliedExVAT', label: 'Total value of goods supplied to EC ex VAT', pence: false, hmrcLabel: 'Total value of dispatches of goods and related costs (excluding VAT) from Northern Ireland to EU Member States' },
  { box: 9, field: 'totalAcquisitionsExVAT', label: 'Total acquisitions from EC ex VAT', pence: false, hmrcLabel: 'Total value of acquisitions of goods and related costs (excluding VAT) made in Northern Ireland from EU Member States' },
];

const MAX = { pence: 9999999999999.99, pounds: 9999999999999, box5: 99999999999.99 };

// Turns a cell value into a number, accepting things like "£1,234.50".
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const cleaned = value.replace(/[£,\s]/g, '');
  if (cleaned === '') return NaN;
  return Number(cleaned);
}

function hasAtMostDecimals(n, places) {
  const scaled = n * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

// values: { 1: ..., 2: ..., ... 9: ... } straight from the spreadsheet.
// Returns { boxes, errors } where boxes holds clean numbers keyed by box number.
function validateBoxes(values) {
  const boxes = {};
  const errors = [];
  for (const b of BOXES) {
    const raw = values[b.box];
    if (raw === undefined || raw === null || raw === '') {
      errors.push(`Box ${b.box} is empty`);
      continue;
    }
    const n = toNumber(raw);
    if (!Number.isFinite(n)) {
      errors.push(`Box ${b.box} is not a number ("${raw}")`);
      continue;
    }
    if (b.pence && !hasAtMostDecimals(n, 2)) errors.push(`Box ${b.box} can have at most 2 decimal places`);
    if (!b.pence && !hasAtMostDecimals(n, 0)) errors.push(`Box ${b.box} must be whole pounds (no pence)`);
    const max = b.positive ? MAX.box5 : b.pence ? MAX.pence : MAX.pounds;
    if (b.positive && n < 0) errors.push(`Box ${b.box} can't be negative`);
    if (Math.abs(n) > max) errors.push(`Box ${b.box} is too large`);
    boxes[b.box] = n;
  }
  if (errors.length) return { boxes, errors };

  // Compare in pence so 0.1 + 0.2 style rounding can't cause false errors.
  const p = (box) => Math.round(boxes[box] * 100);
  if (p(1) + p(2) !== p(3)) {
    errors.push(`Box 3 should be Box 1 + Box 2 (${fmt(boxes[1] + boxes[2])}), but it is ${fmt(boxes[3])}`);
  }
  if (Math.abs(p(3) - p(4)) !== p(5)) {
    errors.push(`Box 5 should be the difference between Box 3 and Box 4 (${fmt(Math.abs(boxes[3] - boxes[4]))}), but it is ${fmt(boxes[5])}`);
  }
  return { boxes, errors };
}

function fmt(n) {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Box 5 alone doesn't say which way the money goes, so work it out from boxes 3 and 4.
function netDirection(boxes) {
  if (boxes[3] > boxes[4]) return 'pay';
  if (boxes[3] < boxes[4]) return 'reclaim';
  return 'nil';
}

// The JSON body for HMRC's "Submit VAT return for period" endpoint.
// HMRC rejects a return unless finalised is true, which is the user's declaration.
function toHmrcBody(periodKey, boxes, finalised) {
  if (finalised !== true) {
    throw new Error('HMRC only accepts a VAT return with finalised set to true');
  }
  const body = { periodKey };
  for (const b of BOXES) body[b.field] = boxes[b.box];
  body.finalised = true;
  return body;
}

module.exports = { BOXES, validateBoxes, toHmrcBody, netDirection, toNumber, fmt };
