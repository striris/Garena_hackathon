/* ============================================================
   ai.js — same-origin API client
   Every request has a hard deadline. Failures are data, not hidden: callers
   retain deterministic heuristics and expose FALLBACK in the audit console.
   ============================================================ */
CF.ai = (function () {
  var REQUEST_TIMEOUT_MS = 16500;
  var FAILURE_TIMEOUT_MS = 3000;
  var simulateFailure = false;

  function failure(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }

  function post(path, payload) {
    if (simulateFailure) {
      return new Promise(function (_, reject) {
        setTimeout(function () { reject(failure('simulated_failure', 'API failure simulated by designer')); }, FAILURE_TIMEOUT_MS);
      });
    }
    if (typeof fetch !== 'function') return Promise.reject(failure('fetch_unavailable'));

    var timeoutMs = REQUEST_TIMEOUT_MS;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (response) {
      return response.json().catch(function () { throw failure('invalid_server_json'); })
        .then(function (body) {
          if (!response.ok) {
            var code = body && body.error && body.error.code ? body.error.code : 'http_' + response.status;
            throw failure(code, body && body.error ? body.error.message : code);
          }
          return body;
        });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') throw failure('timeout', 'AI request exceeded ' + timeoutMs + 'ms');
      throw err;
    }).finally(function () { clearTimeout(timer); });
  }

  function configure(healthState) {
    var serverTimeout = healthState && Number(healthState.timeoutMs);
    if (isFinite(serverTimeout) && serverTimeout > 0) {
      // Give the server enough time to serialize its timeout response instead
      // of aborting the socket at the same instant as the SDK deadline.
      REQUEST_TIMEOUT_MS = Math.ceil(serverTimeout) + 1500;
    }
    return REQUEST_TIMEOUT_MS;
  }

  function health() {
    if (typeof fetch !== 'function') return Promise.resolve({ ready: false, source: 'FALLBACK', reason: 'fetch_unavailable' });
    return fetch('/api/ai/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(failure('health_' + r.status)); })
      .catch(function (err) { return { ready: false, source: 'FALLBACK', reason: err.code || 'offline' }; });
  }

  return {
    get TIMEOUT_MS() { return REQUEST_TIMEOUT_MS; },
    FAILURE_TIMEOUT_MS: FAILURE_TIMEOUT_MS,
    configure: configure,
    health: health,
    saltkin: function (payload) { return post('/api/ai/saltkin', payload); },
    director: function (payload) { return post('/api/ai/director', payload); },
    setFailure: function (value) { simulateFailure = !!value; },
    get simulateFailure() { return simulateFailure; }
  };
})();
