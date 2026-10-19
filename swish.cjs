'use strict';

const https = require('node:https');

function createSwishClient(env = process.env, request = fetch) {
  const payeeAlias = String(env.SWISH_PAYEE_ALIAS || '').replace(/\D/g, '');
  const certificateValue = String(env.SWISH_CERT_P12_BASE64 || '').replace(/\s/g, '');
  let certificate = null;
  if (certificateValue && /^[A-Za-z0-9+/]+={0,2}$/.test(certificateValue)) {
    try { certificate = Buffer.from(certificateValue, 'base64'); } catch {}
  }
  let callbackUrl = '';
  try {
    const parsed = new URL(env.SWISH_CALLBACK_URL || '');
    if (parsed.protocol === 'https:' && parsed.pathname === '/api/swish/callback' && !parsed.username && !parsed.password) callbackUrl = parsed.href;
  } catch {}
  const passphrase = String(env.SWISH_CERT_PASSWORD || '');
  const environment = String(env.SWISH_ENV || '');
  const configured = ['mss', 'production'].includes(environment) && payeeAlias.length >= 8 && payeeAlias.length <= 15 && !!certificate?.length && !!passphrase && !!callbackUrl;
  const apiBase = environment === 'mss'
    ? 'https://mss.cpc.getswish.net/swish-cpcapi'
    : environment === 'production' ? 'https://cpc.getswish.net/swish-cpcapi' : '';

  function apiRequest(instructionUUID, payload) {
    const url = new URL(apiBase + '/api/v2/paymentrequests/' + instructionUUID);
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'PUT',
        minVersion: 'TLSv1.2',
        pfx: certificate,
        passphrase,
        headers: { 'content-type': 'application/json', accept: 'application/json' }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode || 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8')
        }));
      });
      req.setTimeout(12000, () => req.destroy(new Error('Swish connection timed out')));
      req.on('error', reject);
      req.end(JSON.stringify(payload));
    });
  }

  async function createPayment({ instructionUUID, reference, amount, callbackIdentifier, message }) {
    if (!configured) {
      const error = new Error('Automatisk Swish är inte ansluten. Admin behöver konfigurera Swish Commerce och servercertifikatet.');
      error.status = 503;
      throw error;
    }
    const result = await apiRequest(instructionUUID, {
      payeeAlias,
      amount,
      currency: 'SEK',
      callbackUrl,
      payeePaymentReference: reference,
      message: String(message || 'TR-os abonnemang').slice(0, 50),
      callbackIdentifier
    });
    if (result.status !== 201) {
      const error = new Error('Swish kunde inte starta betalningen (HTTP ' + result.status + '). Kontrollera Commerce-avtalet, numret och certifikatet.');
      error.status = result.status === 401 || result.status === 403 || result.status === 422 ? 503 : 502;
      throw error;
    }
    const token = result.headers.paymentrequesttoken;
    if (typeof token !== 'string' || !token.trim()) {
      const error = new Error('Swish skapade ingen betalningslänk. Försök igen eller kontrollera Swish-inställningen.');
      error.status = 502;
      throw error;
    }
    return { token: token.trim() };
  }

  async function qr(token) {
    if (typeof token !== 'string' || !token || token.length > 500) {
      const error = new Error('Swish-betalningen saknar QR-kod.');
      error.status = 404;
      throw error;
    }
    let response;
    try {
      response = await request('https://mpc.getswish.net/qrg-swish/api/v1/commerce', {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'image/png' },
        body: JSON.stringify({ format: 'png', size: 300, token }),
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      const error = new Error('Swish QR-kod kunde inte hämtas. Försök igen.');
      error.status = 502;
      throw error;
    }
    if (!response.ok || !String(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
      const error = new Error('Swish QR-kod kunde inte skapas. Försök igen.');
      error.status = 502;
      try { await response.body?.cancel(); } catch {}
      throw error;
    }
    return Buffer.from(await response.arrayBuffer());
  }

  return Object.freeze({ configured, payeeAlias, callbackUrl, createPayment, qr });
}

module.exports = { createSwishClient };
