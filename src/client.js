// HMRC's Making Tax Digital VAT API: sign-in (OAuth), obligations, returns, liabilities and payments.
// settings: { apiBase, authBase, clientId, clientSecret, redirectUri, scopes, agentAuthVersion ('2.0' or '1.0'), timeoutMs }.
// timeoutMs defaults to 20 seconds. Pass 0 to wait with no limit.
// HOSTS has the sandbox and live addresses for apiBase and authBase.

const HOSTS = {
  sandbox: { apiBase: 'https://test-api.service.hmrc.gov.uk', authBase: 'https://test-www.tax.service.gov.uk' },
  // Live HMRC: real VAT returns. Needs the production application's credentials.
  production: { apiBase: 'https://api.service.hmrc.gov.uk', authBase: 'https://www.tax.service.gov.uk' },
};

class HmrcError extends Error {
  constructor(status, body) {
    super((body && body.message) || `HMRC returned ${status}`);
    this.status = status;
    this.body = body;
  }
}

// HMRC's VAT APIs take the 9-digit number, without a GB prefix.
function normaliseVrn(vrn) {
  const raw = String(vrn ?? '').replace(/\s+/g, '').toUpperCase();
  const digits = raw.startsWith('GB') ? raw.slice(2) : raw;
  if (!/^\d{9}$/.test(digits)) throw new Error('VAT number must be 9 digits');
  return digits;
}

// HMRC's own check is that this is the 4-character id from the obligation. It can include #.
function assertPeriodKey(periodKey) {
  if (typeof periodKey !== 'string' || periodKey.length !== 4 || /[\s\u0000-\u001F\u007F]/.test(periodKey)) {
    throw new Error('Period key must be the 4-character code from the HMRC obligation');
  }
}

// HMRC's agent-mtd-identifiers accepts TARN0000001 and rejects TABC0000001. AARN and XARN are used too.
function normaliseArn(arn) {
  const value = String(arn ?? '').trim().toUpperCase();
  if (!/^[A-Z]ARN\d{7}$/.test(value)) {
    throw new Error('Agent reference number must be a letter, then ARN, then 7 digits (for example AARN0000002)');
  }
  return value;
}

function createClient(settings) {
  const timeoutMs = settings.timeoutMs === undefined ? 20000 : settings.timeoutMs;

  function hmrcFetch(url, opts = {}) {
    if (!timeoutMs || opts.signal) return fetch(url, opts);
    return fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  }

  function authorizeUrl(state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      scope: settings.scopes.join(' '),
      state,
      redirect_uri: settings.redirectUri,
    });
    return `${settings.authBase}/oauth/authorize?${params}`;
  }

  async function tokenRequest(fields) {
    const res = await hmrcFetch(`${settings.apiBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, ...fields }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, body);
    return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: Date.now() + body.expires_in * 1000 };
  }

  function exchangeCode(code) {
    return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri });
  }

  // A token for the app itself (not a user), for application-restricted APIs.
  function applicationToken() {
    return tokenRequest({ grant_type: 'client_credentials' });
  }

  function refresh(refreshToken) {
    return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async function apiGet(path, { accessToken, fraudHeaders, testScenario }) {
    const headers = { Accept: 'application/vnd.hmrc.1.0+json', Authorization: `Bearer ${accessToken}`, ...fraudHeaders };
    if (testScenario) headers['Gov-Test-Scenario'] = testScenario;
    const res = await hmrcFetch(`${settings.apiBase}${path}`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, body);
    return body;
  }

  const vatPath = (vrn) => `/organisations/vat/${encodeURIComponent(normaliseVrn(vrn))}`;

  async function getObligations(vrn, { from, to, status }, opts) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (status) params.set('status', status);
    return apiGet(`${vatPath(vrn)}/obligations?${params}`, opts);
  }

  async function getLiabilities(vrn, { from, to }, opts) {
    return apiGet(`${vatPath(vrn)}/liabilities?${new URLSearchParams({ from, to })}`, opts);
  }

  async function getPayments(vrn, { from, to }, opts) {
    return apiGet(`${vatPath(vrn)}/payments?${new URLSearchParams({ from, to })}`, opts);
  }

  // Submits one VAT return. HMRC sends the receipt details back in headers as well as the body.
  async function submitReturn(vrn, body, { accessToken, fraudHeaders }) {
    assertPeriodKey(body && body.periodKey);
    const res = await hmrcFetch(`${settings.apiBase}${vatPath(vrn)}/returns`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.hmrc.1.0+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...fraudHeaders,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, data);
    return {
      ...data,
      receiptId: res.headers.get('Receipt-ID'),
      receiptTimestamp: res.headers.get('Receipt-Timestamp'),
      correlationId: res.headers.get('X-CorrelationId'),
    };
  }

  // Agent Authorisation API: ask a VAT client to authorise this agent.
  // knownFact is the client's VAT registration date (YYYY-MM-DD). Returns the new invitation ID.
  // Version 2.0 takes service as a string, 1.0 as a list.
  const agentAuthVersion = settings.agentAuthVersion === '1.0' ? '1.0' : '2.0';
  const AGENT_AUTH_ACCEPT = `application/vnd.hmrc.${agentAuthVersion}+json`;
  const AGENT_AUTH_SERVICE = agentAuthVersion === '1.0' ? ['MTD-VAT'] : 'MTD-VAT';

  async function createInvitation(arn, vrn, knownFact, { accessToken, fraudHeaders }) {
    arn = normaliseArn(arn);
    vrn = normaliseVrn(vrn);
    const res = await hmrcFetch(`${settings.apiBase}/agents/${encodeURIComponent(arn)}/invitations`, {
      method: 'POST',
      headers: {
        Accept: AGENT_AUTH_ACCEPT,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...fraudHeaders,
      },
      body: JSON.stringify({
        service: AGENT_AUTH_SERVICE,
        clientType: 'business',
        clientIdType: 'vrn',
        clientId: vrn,
        knownFact,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, body);
    // The new invitation's address comes back in the Location header (or the body's self link).
    const location = res.headers.get('Location') || (body._links && body._links.self && body._links.self.href) || '';
    return body.invitationId || location.split('/').pop();
  }

  async function getInvitation(arn, invitationId, { accessToken, fraudHeaders }) {
    arn = normaliseArn(arn);
    const res = await hmrcFetch(`${settings.apiBase}/agents/${encodeURIComponent(arn)}/invitations/${encodeURIComponent(invitationId)}`, {
      headers: { Accept: AGENT_AUTH_ACCEPT, Authorization: `Bearer ${accessToken}`, ...fraudHeaders },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, body);
    return body;
  }

  // Check a UK VAT number API 2.0 (application-restricted): the business's registered name and address.
  // Returns null when the number isn't VAT registered. The app token is reused until it nearly expires.
  let appToken = null;

  async function checkVatNumber(vrn) {
    vrn = normaliseVrn(vrn);
    if (!appToken || Date.now() > appToken.expiresAt - 60 * 1000) appToken = await applicationToken();
    const res = await hmrcFetch(`${settings.apiBase}/organisations/vat/check-vat-number/lookup/${encodeURIComponent(vrn)}`, {
      headers: { Accept: 'application/vnd.hmrc.2.0+json', Authorization: `Bearer ${appToken.accessToken}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 404) return null;
    if (!res.ok) throw new HmrcError(res.status, body);
    const { name, vatNumber, address = {} } = body.target || {};
    const lines = ['line1', 'line2', 'line3', 'line4', 'line5', 'postcode'].map((k) => address[k]).filter(Boolean);
    return { name, vatNumber, address: lines, countryCode: address.countryCode, processingDate: body.processingDate };
  }

  // Sandbox only. Needs the "Create Test User" API added to the sandbox app.
  async function createTestUser(kind, serviceNames) {
    const { accessToken } = await applicationToken();
    const res = await hmrcFetch(`${settings.apiBase}/create-test-user/${kind}`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.hmrc.1.0+json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ serviceNames }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new HmrcError(res.status, body);
    return body;
  }

  function createTestAgent() {
    return createTestUser('agents', ['agent-services']);
  }

  // A VAT-registered business the sandbox's agent system knows about.
  function createTestVatClient() {
    return createTestUser('organisations', ['mtd-vat']);
  }

  // Sandbox only: accepts an invitation as if the client had approved it.
  // The Agent Authorisation Test Support API is open access, so no token or subscription is needed.
  async function acceptTestInvitation(invitationId) {
    const res = await hmrcFetch(`${settings.apiBase}/agent-authorisation-test-support/invitations/${encodeURIComponent(invitationId)}`, {
      method: 'PUT',
      headers: { Accept: 'application/vnd.hmrc.1.0+json' },
    });
    if (!res.ok) throw new HmrcError(res.status, await res.json().catch(() => ({})));
  }

  // Sandbox only. Needs the "Test Fraud Prevention Headers" API added to the sandbox app.
  function validateFraudHeaders(opts) {
    return apiGet('/test/fraud-prevention-headers/validate', opts);
  }

  return {
    authorizeUrl, exchangeCode, refresh, applicationToken, getObligations, getLiabilities, getPayments, submitReturn, validateFraudHeaders,
    checkVatNumber, createInvitation, getInvitation, createTestAgent, createTestVatClient, acceptTestInvitation,
  };
}

// HMRC's error body as one readable sentence.
function describe(err) {
  const b = err.body || {};
  const inner = Array.isArray(b.errors) ? b.errors.map((e) => e.message).filter(Boolean).join(' ') : '';
  return [b.message || err.message, inner].filter(Boolean).join(' ');
}

module.exports = { createClient, describe, HmrcError, HOSTS };
