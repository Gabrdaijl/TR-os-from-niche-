'use strict';

function classifyFailure(value) {
  const message = String(value || '').toLowerCase();
  if (/wrongpass|invalid password|unauthori[sz]ed|invalid token/.test(message)) return 'credential_rejected';
  if (/noperm|permissions?|read.?only|not permitted/.test(message)) return 'permission_denied';
  if (/wrong number of arguments|syntax error|invalid argument|invalid key/.test(message)) return 'command_rejected';
  if (/unknown command|unsupported command/.test(message)) return 'unsupported_command';
  if (/max daily request limit|daily request limit|daily limit exceeded/.test(message)) return 'daily_request_limit';
  if (/rate.?limit|too many requests|commands per second|throttl/.test(message)) return 'rate_limited';
  if (/quota|limit exceeded|billing/.test(message)) return 'provider_limit';
  if (/database.*(disabled|suspended|not found)|unknown database/.test(message)) return 'database_unavailable';
  return 'upstream_error';
}

function createRedisCircuit() {
  // One circuit is shared by Redis-backed services in a single app instance.
  const BASE_BACKOFF_MS = 15000;
  const MAX_BACKOFF_MS = 5 * 60 * 1000;
  let failures = 0;
  let retryAt = 0;
  let lastFailure = null;
  function isOpen() { return Date.now() < retryAt; }
  function recordFailure(reason = 'upstream_unavailable') {
    lastFailure = /^[a-z0-9_]{1,48}$/.test(String(reason)) ? String(reason) : 'upstream_unavailable';
    const transient = /^(?:(?:provider_limit|daily_request_limit|rate_limited)(?:_http_\d{3})?|database_unavailable|network_[a-z_]+|upstream_unavailable(?:_http_(?:408|425|429|5\d\d))?|upstream_error(?:_http_(?:408|425|429|5\d\d))?|invalid_response)$/.test(lastFailure);
    if (!transient) { failures = 0; retryAt = 0; return; }
    failures = Math.min(failures + 1, 8);
    retryAt = Date.now() + Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** (failures - 1)));
  }
  function recordSuccess() {
    failures = 0;
    retryAt = 0;
    lastFailure = null;
  }
  function diagnostics() {
    return { open: isOpen(), retryAfterMs: Math.max(0, retryAt - Date.now()), lastFailure };
  }
  return { isOpen, recordFailure, recordSuccess, diagnostics };
}

module.exports = { createRedisCircuit, classifyFailure };
