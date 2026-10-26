// HMRC fraud prevention headers for the WEB_APP_VIA_SERVER connection method.
// Spec: https://developer.service.hmrc.gov.uk/guides/fraud-prevention/connection-method/web-app-via-server/
const crypto = require('node:crypto');

const enc = encodeURIComponent;

// HMRC forbids placeholder values such as "undefined" or "null". A missing
// key-value pair is left out; the header itself is left out when nothing remains.
// https://developer.service.hmrc.gov.uk/guides/fraud-prevention/getting-it-right/
function present(v) {
  if (v === undefined || v === null || v === '') return false;
  if (typeof v === 'number' && !Number.isFinite(v)) return false;
  if (typeof v === 'string' && /^(undefined|null)$/i.test(v)) return false;
  return true;
}

function keyValues(obj) {
  return Object.entries(obj)
    .filter(([k, v]) => present(k) && present(v))
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
    .join('&');
}

function cleanIp(ip) {
  if (!ip) return '';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

// device: what the browser told us (see public/device-info.js)
// multiFactor: { type, timestamp (Date), uniqueReference } for the user's second sign-in step, if any.
function buildFraudHeaders({ clientIp, clientPort, deviceId, userId, device = {}, product, vendorPublicIp, licenseKey, multiFactor }) {
  const ip = cleanIp(clientIp);
  const headers = {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Public-IP': ip,
    'Gov-Client-Public-IP-Timestamp': new Date().toISOString(),
    'Gov-Client-Public-Port': clientPort ? String(clientPort) : '',
    'Gov-Client-Device-ID': present(deviceId) ? String(deviceId) : '',
    'Gov-Client-User-IDs': keyValues({ [product.name]: userId }),
    'Gov-Client-Timezone': device.timezone || '',
    'Gov-Client-Screens': device.screen ? keyValues(device.screen) : '',
    'Gov-Client-Window-Size': device.window ? keyValues(device.window) : '',
    'Gov-Client-Browser-JS-User-Agent': device.userAgent || '',
    'Gov-Client-Browser-Do-Not-Track': device.doNotTrack ? 'true' : 'false',
    'Gov-Vendor-Version': keyValues({ [product.name]: product.version }),
    'Gov-Vendor-Product-Name': present(product && product.name) ? enc(product.name) : '',
  };
  if (multiFactor) {
    const stamp = multiFactor.timestamp instanceof Date && !Number.isNaN(multiFactor.timestamp.getTime())
      ? multiFactor.timestamp
      : null;
    headers['Gov-Client-Multi-Factor'] = keyValues({
      type: multiFactor.type,
      // HMRC wants UTC to the minute, e.g. 2026-10-20T23:15Z.
      timestamp: stamp ? `${stamp.toISOString().slice(0, 16)}Z` : '',
      'unique-reference': multiFactor.uniqueReference,
    });
  }
  if (licenseKey) {
    const hash = crypto.createHash('sha256').update(licenseKey).digest('hex');
    headers['Gov-Vendor-License-IDs'] = keyValues({ [product.name]: hash });
  }
  if (present(vendorPublicIp)) {
    headers['Gov-Vendor-Public-IP'] = String(vendorPublicIp);
    // Each hop needs both addresses. Omit the whole header rather than send "for=undefined".
    if (present(ip)) headers['Gov-Vendor-Forwarded'] = keyValues({ by: vendorPublicIp, for: ip });
  }
  // Drop anything we could not collect. Never send an empty value or the words undefined/null.
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => present(v)));
}

// Turns "-60" style minutes from getTimezoneOffset() into "UTC+01:00".
function formatTimezone(offsetMinutes) {
  const total = -offsetMinutes;
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

// The browser details posted by browser/device-info.js, cleaned up for buildFraudHeaders.
function readDevice(body) {
  const b = body || {};
  // Missing or non-numeric sizes stay absent. Number('') is 0, which would be a fake screen size.
  const num = (v) => {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const measured = (obj, keys) => {
    if (!obj || typeof obj !== 'object') return undefined;
    const out = {};
    for (const key of keys) {
      const n = num(obj[key]);
      if (n !== undefined) out[key] = n;
    }
    return Object.keys(out).length ? out : undefined;
  };
  return {
    timezone: Number.isFinite(b.timezoneOffset) ? formatTimezone(b.timezoneOffset) : '',
    screen: measured(b.screen, ['width', 'height', 'scaling-factor', 'colour-depth']),
    window: measured(b.window, ['width', 'height']),
    userAgent: typeof b.userAgent === 'string' ? b.userAgent.slice(0, 500) : '',
    doNotTrack: b.doNotTrack === true,
  };
}

// Headers a host's proxy may use to pass on the visitor's own port.
const PORT_HEADERS = ['x-forwarded-client-port', 'x-client-port', 'x-real-port', 'x-remote-port'];

// The visitor's port. Behind a proxy the socket's port is the proxy's, so only a proxy header will do.
function clientPort(req, behindProxy) {
  if (!behindProxy) return req.socket.remotePort;
  const name = PORT_HEADERS.find((h) => /^\d+$/.test(req.headers[h] || ''));
  return name ? req.headers[name] : '';
}

module.exports = { buildFraudHeaders, formatTimezone, cleanIp, readDevice, clientPort };
