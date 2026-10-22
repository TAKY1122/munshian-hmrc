// Shared HMRC Making Tax Digital VAT code for the Munshian apps (munshian-vat and munshian-ledger).
// Change HMRC behaviour here once; each app picks it up when it updates this package.
const path = require('node:path');
const { createClient, describe, HmrcError, HOSTS } = require('./src/client');
const { buildFraudHeaders, formatTimezone, cleanIp, readDevice, clientPort } = require('./src/fraudHeaders');
const { BOXES, validateBoxes, toHmrcBody, netDirection, toNumber, fmt } = require('./src/vatReturn');
const { writeReceiptPdf } = require('./src/receiptPdf');

module.exports = {
  // API client
  createClient, describe, HmrcError, HOSTS,
  // Fraud prevention headers
  buildFraudHeaders, formatTimezone, cleanIp, readDevice, clientPort,
  // The 9 boxes and HMRC's rules for them
  BOXES, validateBoxes, toHmrcBody, netDirection, toNumber, fmt,
  // PDF copy of a filed return with HMRC's receipt
  writeReceiptPdf,
  // Browser script that posts screen/timezone details to /device-info; serve it to signed-in pages.
  deviceInfoScript: path.join(__dirname, 'browser', 'device-info.js'),
};
