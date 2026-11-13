#!/usr/bin/env node
// One-shot diagnostics for the Windows main-window white page (beta.24,
// release-verify run 43434507742). The caller launches pathblender-desktop
// with the diagnostic builder's PB_DEBUG_WEBVIEW_BROWSER_ARGS and a dedicated
// PB_DEBUG_WEBVIEW_DATA_DIR; the WebView2 environment-variable override is not
// relied on. The default probe is strictly READ-ONLY against the app:
//   - polls the loopback remote-debugging endpoint until /json/version answers,
//   - lists every target from /json,
//   - connects over CDP ONLY to page targets whose URL is local app content,
//   - evaluates read-only DOM/location/performance/service-worker queries,
//   - passively records console errors, runtime exceptions, failed loads and
//     HTTP >= 400 responses while attached,
//   - captures an in-WebView screenshot (Page.captureScreenshot).
// With BOTH --recover-synthetic-copy AND PB_PROBE_SYNTHETIC_COPY=1, an observed
// empty, worker-controlled document additionally unregisters this origin's
// worker and reloads, ONLY in the explicitly synthetic copied profile. It never
// clears storage or reads credentials. The exit code is always 0: findings surface through
// <out-dir>/webview-probe-result.json, not through workflow failure.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= args.length) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? fallback : v;
}
const port = Number(arg('port', '9222'));
const waitMs = Number(arg('wait-ms', '90000'));
const observeMs = Number(arg('observe-ms', '45000'));
const outDir = arg('out-dir', 'probe-out');
const recoverSynthetic = args.includes('--recover-synthetic-copy') && process.env.PB_PROBE_SYNTHETIC_COPY === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
mkdirSync(outDir, { recursive: true });
const logFile = `${outDir}/webview-probe.log`;
function log(line) {
  const stamped = `[+${String(Date.now() - startedAt).padStart(6)}ms] ${line}`;
  console.log(stamped);
  appendFileSync(logFile, stamped + '\n');
}

const base = `http://127.0.0.1:${port}`;
const result = {
  endpoint: base,
  startedAt: new Date().toISOString(),
  node: process.version,
  portOpenAfterMs: null,
  portWaitError: null,
  browser: null,
  targets: [],
  pages: [],
  verdict: 'UNKNOWN',
};

function finish() {
  result.finishedAt = new Date().toISOString();
  result.elapsedMs = Date.now() - startedAt;
  writeFileSync(`${outDir}/webview-probe-result.json`, JSON.stringify(result, null, 2) + '\n');
  log(`verdict: ${result.verdict}`);
  process.exit(0);
}

function isLocalUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (['tauri:', 'asset:', 'about:', 'data:', 'devtools:', 'file:'].includes(u.protocol)) return true;
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    return ['tauri.localhost', 'localhost', '127.0.0.1', '::1'].includes(u.hostname);
  }
  return false;
}

async function getJson(path, timeoutMs = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(base + path, { signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`websocket error: ${e.message || 'unknown'}`)), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${msg.error.message} (code ${msg.error.code})`));
      else res(msg.result);
    } else if (msg.method) {
      for (const l of listeners) {
        try {
          l(msg);
        } catch {
          /* listener bugs must never kill the probe */
        }
      }
    }
  });
  return {
    opened,
    send(method, params = {}, timeoutMs = 10000) {
      const id = nextId++;
      const p = new Promise((res, rej) => {
        pending.set(id, { res, rej });
        setTimeout(() => {
          if (pending.delete(id)) rej(new Error(`timeout: ${method}`));
        }, timeoutMs);
      });
      ws.send(JSON.stringify({ id, method, params }));
      return p;
    },
    onEvent(l) {
      listeners.push(l);
    },
    close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

// Single read-only expression: property reads and performance API queries
// only, each field isolated in try/catch so one failure cannot hide the rest.
const SNAPSHOT_EXPR = `(() => {
  const out = {};
  const t = (label, f) => { try { out[label] = f(); } catch (e) { out[label] = 'EVAL_ERR:' + (e && e.message ? e.message : String(e)); } };
  t('href', () => location.href);
  t('readyState', () => document.readyState);
  t('title', () => document.title);
  t('elementCount', () => document.querySelectorAll('*').length);
  t('bodyExists', () => !!document.body);
  t('bodyChildCount', () => (document.body ? document.body.childElementCount : null));
  t('bodyTextLength', () => (document.body ? (document.body.innerText || '').trim().length : null));
  t('bodyTextSample', () => (document.body ? (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1500) : null));
  t('rootExists', () => !!document.getElementById('root'));
  t('rootChildCount', () => { const r = document.getElementById('root'); return r ? r.childElementCount : null; });
  t('rootTextLength', () => { const r = document.getElementById('root'); return r ? (r.textContent || '').trim().length : null; });
  t('hasTauriInternals', () => typeof window.__TAURI_INTERNALS__ !== 'undefined');
  t('hasTauri', () => typeof window.__TAURI__ !== 'undefined');
  t('tauriMetadata', () => {
    const m = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.metadata;
    return m ? JSON.parse(JSON.stringify(m)) : null;
  });
  t('navigatorOnLine', () => navigator.onLine);
  t('userAgent', () => navigator.userAgent);
  t('viewport', () => [window.innerWidth, window.innerHeight]);
  t('devicePixelRatio', () => window.devicePixelRatio);
  t('navTiming', () => {
    const n = performance.getEntriesByType('navigation')[0];
    return n ? {
      name: n.name, type: n.type, responseStart: Math.round(n.responseStart),
      responseEnd: Math.round(n.responseEnd), domContentLoadedEventEnd: Math.round(n.domContentLoadedEventEnd),
      loadEventEnd: Math.round(n.loadEventEnd), transferSize: n.transferSize,
    } : null;
  });
  t('paintTiming', () => performance.getEntriesByType('paint').map((e) => ({ name: e.name, t: Math.round(e.startTime) })));
  t('resourceCount', () => performance.getEntriesByType('resource').length);
  t('resources', () => performance.getEntriesByType('resource').slice(-50).map((e) => ({
    name: String(e.name).slice(0, 200), initiatorType: e.initiatorType,
    durationMs: Math.round(e.duration), transferSize: e.transferSize,
    responseStatus: typeof e.responseStatus === 'number' ? e.responseStatus : null,
  })));
  return out;
})()`;

const SERVICE_WORKER_EXPR = `(async () => {
  try {
    if (!('serviceWorker' in navigator)) return { supported: false, secureContext: window.isSecureContext };
    const registrations = await navigator.serviceWorker.getRegistrations();
    const describe = (worker) => worker ? { scriptURL: worker.scriptURL, state: worker.state } : null;
    return {
      supported: true,
      secureContext: window.isSecureContext,
      controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
      registrations: registrations.map((r) => ({
        scope: r.scope,
        active: describe(r.active),
        waiting: describe(r.waiting),
        installing: describe(r.installing),
      })),
    };
  } catch (e) {
    return { error: String(e && e.message ? e.message : e), secureContext: window.isSecureContext };
  }
})()`;

function normEval(r) {
  if (r === undefined || r === null) return { evalError: 'no result' };
  if (r.evalError) return r;
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    return { exception: `${d.text || ''} ${d.exception && d.exception.description ? d.exception.description : ''}`.trim() };
  }
  if (r.result && r.result.value !== undefined) return r.result.value;
  return { evalError: 'unexpected evaluate result shape' };
}

function classify(snapshot, events) {
  const exceptions = events.filter((e) => e.kind === 'exception').length;
  let core;
  if (!snapshot || typeof snapshot !== 'object') core = 'NO_DOM_READ';
  else if (snapshot.evalError || snapshot.exception) core = 'NO_DOM_READ';
  else if (!snapshot.bodyExists) core = 'NO_BODY';
  else if ((snapshot.elementCount || 0) === 0) core = 'DOM_EMPTY';
  else if ((snapshot.bodyTextLength || 0) > 0 || (snapshot.rootTextLength || 0) > 0) core = 'DOM_CONTENT_PRESENT';
  else core = 'DOM_SKELETON_NO_TEXT';
  return exceptions > 0 ? `${core}+JS_EXCEPTIONS(${exceptions})` : core;
}

async function recoverSyntheticPage(session, pageNumber, late, serviceWorkers) {
  if (late.bodyExists !== true || late.rootExists || (late.bodyTextLength || 0) > 0 || typeof serviceWorkers.controller !== 'string' || !serviceWorkers.controller.endsWith('/sw.js')) {
    return { skipped: 'empty-document-and-service-worker-precondition-not-met' };
  }
  const expression = `(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return Promise.all(registrations.filter((r) => r.scope === location.origin + '/').map((r) => r.unregister()));
  })()`;
  const unregistrations = normEval(await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }));
  if (!Array.isArray(unregistrations) || unregistrations.length === 0 || unregistrations.some((value) => value !== true)) {
    return { unregistrations, recovered: false, error: 'worker-unregister-failed' };
  }
  await session.send('Page.reload', { ignoreCache: true });
  const deadline = Date.now() + 20000;
  let lateSnapshot = null;
  do {
    const raw = await session.send('Runtime.evaluate', { expression: SNAPSHOT_EXPR, returnByValue: true })
      .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
    lateSnapshot = normEval(raw);
    if (lateSnapshot.rootExists && (lateSnapshot.bodyTextLength || 0) > 0) break;
    await sleep(250);
  } while (Date.now() < deadline);
  const workersRaw = await session.send('Runtime.evaluate', { expression: SERVICE_WORKER_EXPR, awaitPromise: true, returnByValue: true })
    .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
  const recovery = {
    unregistrations,
    recovered: lateSnapshot.rootExists === true && (lateSnapshot.bodyTextLength || 0) > 0,
    lateSnapshot,
    serviceWorkers: normEval(workersRaw),
    screenshot: null,
  };
  try {
    const cap = await session.send('Page.captureScreenshot', { format: 'png' });
    recovery.screenshot = `webview-after-unregister-${pageNumber}.png`;
    writeFileSync(`${outDir}/${recovery.screenshot}`, Buffer.from(cap.data, 'base64'));
  } catch (e) {
    recovery.screenshot = `capture failed: ${e && e.message ? e.message : e}`;
  }
  log(`[DEBUG-window-restart] synthetic recovery: recovered=${recovery.recovered}, screenshot=${recovery.screenshot}`);
  return recovery;
}

async function main() {
  log(`probe start: endpoint ${base}, wait ${waitMs}ms, observe ${observeMs}ms, out ${outDir}`);
  if (typeof WebSocket !== 'function') {
    result.verdict = 'PROBE_ERROR_NO_WEBSOCKET_GLOBAL';
    result.probeError = `node ${process.version} lacks a global WebSocket`;
    finish();
  }

  const waitDeadline = Date.now() + waitMs;
  let version = null;
  let lastError = 'no attempt made';
  while (Date.now() < waitDeadline) {
    try {
      version = await getJson('/json/version');
      result.portOpenAfterMs = Date.now() - startedAt;
      break;
    } catch (e) {
      const cause = e && e.cause ? `/${e.cause.code || e.cause.message || e.cause}` : '';
      lastError = `${e && e.message ? e.message : String(e)}${cause}`;
    }
    await sleep(500);
  }
  if (!version) {
    result.portWaitError = lastError;
    log(`remote-debugging endpoint never answered: ${lastError}`);
    result.verdict = 'PORT_UNAVAILABLE';
    finish();
  }
  log(`endpoint answered after ${result.portOpenAfterMs}ms: browser ${version.Browser || 'unknown'}`);
  result.browser = {
    Browser: version.Browser || null,
    'Protocol-Version': version['Protocol-Version'] || null,
    'User-Agent': version['User-Agent'] || null,
  };

  const targetDeadline = Date.now() + 30000;
  let targets = [];
  while (Date.now() < targetDeadline) {
    targets = await getJson('/json').catch(() => []);
    if (targets.some((t) => t.type === 'page')) break;
    await sleep(1000);
  }
  result.targets = targets.map((t) => ({
    type: t.type,
    title: String(t.title || '').slice(0, 120),
    url: String(t.url || '').slice(0, 300),
  }));
  log(`/json targets (${targets.length}): ${result.targets.map((t) => `${t.type} ${t.url}`).join(' ; ') || '(none)'}`);

  const pages = targets.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl && isLocalUrl(t.url)).slice(0, 3);
  if (pages.length === 0) {
    result.verdict = targets.some((t) => t.type === 'page') ? 'NO_LOCAL_PAGE_TARGET' : 'NO_PAGE_TARGETS';
    finish();
  }

  for (const [i, page] of pages.entries()) {
    const observeDeadline = Date.now() + observeMs;
    const events = [];
    const pushEvent = (e) => {
      if (events.length < 400) events.push(e);
    };
    let session;
    try {
      session = connect(page.webSocketDebuggerUrl);
      await session.opened;
    } catch (e) {
      result.pages.push({ url: page.url, title: page.title, connectError: String(e && e.message ? e.message : e) });
      continue;
    }
    log(`connected to page target ${i + 1}/${pages.length}: ${page.url}`);
    for (const m of ['Runtime.enable', 'Log.enable', 'Network.enable', 'Page.enable']) {
      await session.send(m).catch((e) => pushEvent({ kind: 'cdp-error', where: m, error: String(e && e.message ? e.message : e) }));
    }
    session.onEvent((msg) => {
      const tRel = Date.now() - startedAt;
      try {
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails || {};
          pushEvent({
            kind: 'exception', t: tRel, text: String(d.text || ''),
            url: d.url || null, line: d.lineNumber ?? null,
            desc: String(d.exception ? (d.exception.description || d.exception.value || '') : '').slice(0, 1500),
          });
        } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
          pushEvent({
            kind: `console.${msg.params.type}`, t: tRel,
            args: (msg.params.args || []).map((a) => String(a.value ?? a.description ?? a.type ?? '')).join(' | ').slice(0, 800),
          });
        } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes((msg.params.entry || {}).level)) {
          const en = msg.params.entry || {};
          pushEvent({
            kind: `log.${en.level}`, t: tRel, source: en.source,
            url: String(en.url || '').slice(0, 200), text: String(en.text || '').slice(0, 800),
          });
        } else if (msg.method === 'Network.loadingFailed') {
          pushEvent({
            kind: 'net-failed', t: tRel, requestId: msg.params.requestId,
            error: msg.params.errorText, type: msg.params.type || null, canceled: !!msg.params.canceled,
          });
        } else if (msg.method === 'Network.responseReceived') {
          const st = (msg.params.response || {}).status;
          if (typeof st === 'number' && st >= 400) {
            pushEvent({ kind: `net-http-${st}`, t: tRel, url: String((msg.params.response || {}).url || '').slice(0, 200) });
          }
        } else if (['Page.domContentEventFired', 'Page.loadEventFired', 'Page.frameNavigated', 'Page.navigatedWithinDocument'].includes(msg.method)) {
          pushEvent({ kind: msg.method, t: tRel, url: String((msg.params.frame || {}).url || '').slice(0, 200) });
        }
      } catch {
        /* event parsing must never kill the session */
      }
    });

    await sleep(1500);
    const earlyRaw = await session.send('Runtime.evaluate', { expression: SNAPSHOT_EXPR, returnByValue: true })
      .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
    const early = normEval(earlyRaw);
    while (Date.now() < observeDeadline) await sleep(1000);
    const lateRaw = await session.send('Runtime.evaluate', { expression: SNAPSHOT_EXPR, returnByValue: true })
      .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
    const late = normEval(lateRaw);
    const serviceWorkerRaw = await session.send('Runtime.evaluate', { expression: SERVICE_WORKER_EXPR, awaitPromise: true, returnByValue: true })
      .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
    const serviceWorkers = normEval(serviceWorkerRaw);
    const navigation = await session.send('Page.getNavigationHistory')
      .then((h) => ({
        currentIndex: h.currentIndex,
        entries: (h.entries || []).map((e) => ({ url: String(e.url || '').slice(0, 300), transitionType: e.transitionType || null })),
      }))
      .catch((e) => ({ evalError: String(e && e.message ? e.message : e) }));
    let screenshot = null;
    try {
      const cap = await session.send('Page.captureScreenshot', { format: 'png' });
      screenshot = `webview-page-${i + 1}.png`;
      writeFileSync(`${outDir}/${screenshot}`, Buffer.from(cap.data, 'base64'));
    } catch (e) {
      screenshot = `capture failed: ${e && e.message ? e.message : e}`;
    }
    const pageResult = { url: page.url, title: String(page.title || '').slice(0, 120), earlySnapshot: early, lateSnapshot: late, serviceWorkers, navigation, screenshot, events };
    if (recoverSynthetic) {
      try {
        pageResult.syntheticRecovery = await recoverSyntheticPage(session, i + 1, late, serviceWorkers);
      } catch (e) {
        pageResult.syntheticRecovery = { recovered: false, error: String(e && e.message ? e.message : e) };
      }
    }
    session.close();
    log(`page ${i + 1}: verdict input ready (early/late snapshots + ${events.length} events), screenshot: ${screenshot}`);
    result.pages.push(pageResult);
    if (i === 0) result.verdict = classify(late, events);
  }
  if (result.verdict === 'UNKNOWN') result.verdict = 'NO_USABLE_PAGE_SESSION';
  finish();
}

main().catch((e) => {
  result.verdict = 'PROBE_ERROR';
  result.probeError = String(e && e.stack ? e.stack : e);
  finish();
});
