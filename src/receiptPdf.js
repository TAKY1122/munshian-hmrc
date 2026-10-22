// A PDF copy of a submitted VAT return with HMRC's receipt details, laid out like HMRC's own copy.
const PDFDocument = require('pdfkit');
const { BOXES } = require('./vatReturn');

const LABELS = Object.fromEntries(BOXES.map((b) => [b.box, b.hmrcLabel]));

const NAVY = '#192B4F';
const GREY = '#667085';
const LINE = '#E5EAF1';


const PAYMENT = { DD: 'Direct Debit', BANK: 'Bank payment' };

function money(n, pence) {
  if (typeof n !== 'number') return '';
  const text = Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: pence ? 2 : 0, maximumFractionDigits: pence ? 2 : 0 });
  return `${n < 0 ? '-' : ''}£${text}`;
}

function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "1 Jul 2026", as HMRC writes it (Node's en-GB gives "Sept").
function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function dateTime(iso) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/London' });
}

// Writes the PDF for one receipt to a stream (e.g. the HTTP response).
// business: { name, address: [lines] } from the Check a UK VAT number API, or null if it wasn't available.
// options: { logo (path to a PNG), author (the PDF's author field) }.
function writeReceiptPdf(receipt, out, business = null, { logo, author = 'Munshian' } = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `VAT return ${receipt.vrn} ${receipt.end || ''}`, Author: author } });
  doc.pipe(out);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  if (logo) doc.image(logo, left, 40, { height: 34 });
  doc.font('Helvetica').fontSize(9).fillColor(GREY)
    .text(`Generated ${dateTime(new Date().toISOString())}`, left, 52, { width, align: 'right' });
  doc.y = 120;

  const name = business && business.name;
  doc.fillColor(GREY).fontSize(16).text(`Submitted VAT return for ${name || `VAT number ${receipt.vrn}`}`, left);
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font('Helvetica-Bold').fontSize(24)
    .text(receipt.start && receipt.end ? `${shortDate(receipt.start)} to ${shortDate(receipt.end)}` : 'VAT return');
  doc.moveDown(0.6).font('Helvetica').fontSize(11).fillColor(NAVY);
  if (name) {
    doc.font('Helvetica-Bold').text(name).font('Helvetica');
    for (const line of business.address || []) doc.text(line);
    doc.text(`VAT number: ${receipt.vrn}`);
    doc.moveDown(0.6);
  }
  if (receipt.due) doc.text(`Return due date: ${longDate(receipt.due)}`);
  doc.text(`Date submitted: ${longDate(receipt.submittedAt)}`);

  const row = (label, value, { bold = false, title } = {}) => {
    const y = doc.y;
    const labelX = left + 56;
    const valueW = 110;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor(bold ? NAVY : GREY);
    const labelW = width - 56 - valueW;
    const h = doc.heightOfString(label, { width: labelW });
    if (title) doc.font('Helvetica-Bold').fillColor(NAVY).text(title, left, y, { width: 50 });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(bold ? NAVY : GREY).text(label, labelX, y, { width: labelW });
    doc.fillColor(NAVY).text(value, left + width - valueW, y, { width: valueW, align: 'right' });
    doc.y = y + h + 8;
    doc.moveTo(left, doc.y - 4).lineTo(left + width, doc.y - 4).strokeColor(LINE).lineWidth(0.5).stroke();
    doc.x = left;
  };
  const heading = (text) => {
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(14).fillColor(NAVY).text(text, left);
    doc.moveDown(0.5);
  };

  heading('VAT details');
  for (const b of BOXES.slice(0, 5)) {
    row(LABELS[b.box], money(receipt.return[b.field], b.pence), { bold: b.box === 5, title: `Box ${b.box}` });
  }
  heading('Additional information');
  for (const b of BOXES.slice(5)) {
    row(LABELS[b.box], money(receipt.return[b.field], b.pence), { title: `Box ${b.box}` });
  }

  const h = receipt.hmrc || {};
  heading('HMRC receipt');
  const details = [
    ['Form bundle number', h.formBundleNumber],
    ['Receipt ID', h.receiptId],
    ['Receipt timestamp', h.receiptTimestamp && dateTime(h.receiptTimestamp)],
    ['Processing date', h.processingDate && dateTime(h.processingDate)],
    ['Charge reference', h.chargeRefNumber],
    ['Payment indicator', h.paymentIndicator && (PAYMENT[h.paymentIndicator] || h.paymentIndicator)],
    ['Correlation ID', h.correlationId],
  ].filter(([, v]) => v);
  for (const [label, value] of details) {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10.5).fillColor(GREY).text(label, left, y, { width: 160 });
    doc.fillColor(NAVY).text(String(value), left + 170, y, { width: width - 170 });
    doc.y = Math.max(doc.y, y + 14) + 4;
  }

  doc.end();
}

module.exports = { writeReceiptPdf };
