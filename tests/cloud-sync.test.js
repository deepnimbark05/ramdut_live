/* ============================================================
   Live integration test — cloud + local database sync
   Run:   node tests/cloud-sync.test.js
   Needs: Node 18+ (uses built-in fetch). No dependencies.

   Boots the real app.js inside a sandboxed VM (stub DOM +
   localStorage) against a mock server that implements:
     • Supabase/PostgREST contract  GET/POST /rest/v1/app_state
       (apikey + Bearer auth, ?select=state&id=eq.*,
        upsert via Prefer: resolution=merge-duplicates)
     • local _server.js contract    GET/POST /api/state
   and asserts push, debounced sync, cross-device adoption,
   auth failure handling and the local fallback mode.
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const PORT = 8099;
const ANON_KEY = 'test-anon-key-123';
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Mock server ---------- */
let cloudRow = null;   // { id, state } | null
let cloudPosts = 0;
let localState = null; // last state POSTed to /api/state
let localPosts = 0;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
  };
  const readBody = () => new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
  });

  // --- Supabase REST (cloud mode) ---
  if (u.pathname === '/rest/v1/app_state') {
    if (req.headers.apikey !== ANON_KEY || req.headers.authorization !== 'Bearer ' + ANON_KEY) {
      return send(401, { message: 'Invalid API key' });
    }
    if (req.method === 'GET') {
      assert.strictEqual(u.searchParams.get('select'), 'state', 'GET must select only state');
      assert(/^eq\./.test(u.searchParams.get('id') || ''), 'GET must filter by id=eq.*');
      return send(200, cloudRow ? [{ state: cloudRow.state }] : []);
    }
    if (req.method === 'POST') {
      readBody().then((raw) => {
        const rows = JSON.parse(raw);
        assert(Array.isArray(rows) && rows.length === 1, 'POST body must be a one-row array');
        assert.strictEqual(typeof rows[0].id, 'string', 'row needs id');
        assert(rows[0].state && typeof rows[0].state === 'object', 'row needs state object');
        assert.strictEqual(req.headers.prefer, 'resolution=merge-duplicates,return=minimal',
          'POST must be an upsert (Prefer: resolution=merge-duplicates)');
        cloudRow = { id: rows[0].id, state: rows[0].state }; // upsert semantics
        cloudPosts += 1;
        res.writeHead(201); // return=minimal → empty 201
        res.end();
      });
      return;
    }
    return send(405, { message: 'Method not allowed' });
  }

  // --- local _server.js contract ---
  if (u.pathname === '/api/state') {
    if (req.method === 'GET') {
      return send(200, {
        ok: true,
        data: localState || { settings: {}, items: [], sites: [], history: [] },
      });
    }
    if (req.method === 'POST') {
      readBody().then((raw) => {
        localState = JSON.parse(raw);
        localPosts += 1;
        send(200, { ok: true, saved: true });
      });
      return;
    }
    return send(405, { ok: false });
  }

  send(404, { message: 'Not found' });
});

/* ---------- Browser sandbox (stub DOM + localStorage) ---------- */
function makeEl() {
  return {
    textContent: '', innerHTML: '', value: '', title: '', placeholder: '',
    href: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, focus() {}, click() {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    scrollIntoView() {}, closest() { return null; },
  };
}

/** Load the real app.js into a fresh VM realm and return handles into it. */
function bootApp(ramdutDbConf) {
  const els = new Map();
  const storage = new Map();
  const sandbox = {
    console,
    // Browsers resolve relative URLs against the page origin; Node's fetch
    // cannot — simulate the app being served from the mock server's origin.
    fetch: (input, init) => globalThis.fetch(
      typeof input === 'string' && input.startsWith('/')
        ? 'http://127.0.0.1:' + PORT + input
        : input,
      init,
    ),
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL: globalThis.URL,
    navigator: { onLine: true },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
      clear: () => storage.clear(),
    },
    document: {
      getElementById: (id) => { if (!els.has(id)) els.set(id, makeEl()); return els.get(id); },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => makeEl(),
      body: makeEl(),
      documentElement: makeEl(),
      addEventListener() {},
      removeEventListener() {},
    },
    confirm: () => true,
    alert() {},
    prompt() { return null; },
  };
  sandbox.window = {
    RAMDUT_DB: ramdutDbConf,
    addEventListener() {},
    removeEventListener() {},
    location: { href: 'http://localhost/' },
  };

  vm.createContext(sandbox);
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' }); // runs top-level load()
  const api = vm.runInContext(`(() => ({
    dbPush, dbPull, saveItems, saveShop,
    isCloud: () => !!CLOUD,
    isOnline: () => dbOnline,
    badge: () => { const b = $('dbBadge'); return b ? b.textContent : ''; },
    note: () => { const n = $('dataNote'); return n ? n.textContent : ''; },
    getItems: () => items,
    setItems: (v) => { items = v; },
    getShop: () => shop,
  }))()`, sandbox);
  return { api, storage, els };
}

/* ---------- Scenarios ---------- */
async function main() {
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', resolve);
  });

  // 1) Cloud boot: empty store → handshake + initial push, badge 🟢 Cloud
  const cloud = bootApp({
    provider: 'supabase',
    url: 'http://127.0.0.1:' + PORT,
    anonKey: ANON_KEY,
    storeId: 'main',
  });
  assert.strictEqual(cloud.api.isCloud(), true, 'cloud mode must be detected');
  await sleep(700);
  assert.strictEqual(cloud.api.isOnline(), true, 'online after cloud handshake');
  assert.strictEqual(cloud.api.badge(), '🟢 Cloud', 'badge must show cloud');
  assert(cloudRow, 'initial push must seed the empty cloud store');
  assert.deepStrictEqual(cloudRow.state.items, [], 'seeded state must contain items[]');
  assert(Array.isArray(cloudRow.state.sites) && Array.isArray(cloudRow.state.history));
  assert(cloudPosts >= 1, 'state must be POSTed to the cloud');
  assert(cloud.api.note().includes('cloud'), 'settings note must mention cloud');
  console.log('PASS 1 - cloud handshake: badge shows cloud, initial state pushed');

  // 2) Save -> debounced (600 ms) push to the cloud
  cloud.api.setItems([{ id: 'i1', name: 'Chair', cat: 'furniture', price: 500, qty: 10, damage: 0, low: 2 }]);
  cloud.api.saveItems();
  await sleep(1000);
  assert.strictEqual(cloudRow.state.items.length, 1, 'cloud must receive the saved item');
  assert.strictEqual(cloudRow.state.items[0].name, 'Chair');
  console.log('PASS 2 - save() pushes to cloud after 600 ms debounce');

  // 3) "Another device" writes to the cloud -> this device adopts it on pull
  cloudRow = {
    id: 'main',
    state: {
      settings: { name: 'Other Device Shop' },
      items: [{ id: 'i2', name: 'Table', cat: 'furniture', price: 900, qty: 3, damage: 0, low: 1 }],
      sites: [{ id: 's1', name: 'Site A', venue: 'Vadodara', phone: '', status: 'running', items: {} }],
      history: [],
    },
  };
  const changed = await cloud.api.dbPull();
  assert.strictEqual(changed, true, 'dbPull must adopt remote state');
  assert.strictEqual(cloud.api.getItems()[0].name, 'Table', 'items adopted from cloud');
  assert.strictEqual(cloud.api.getShop().name, 'Other Device Shop', 'settings adopted');
  console.log('PASS 3 - pull adopts data pushed from another device');

  // 4) Wrong credentials -> graceful offline badge, no crash
  await sleep(800); // let pending debounced pushes from scenario 3 settle
  const bad = bootApp({
    provider: 'supabase',
    url: 'http://127.0.0.1:' + PORT,
    anonKey: 'wrong-key',
    storeId: 'main',
  });
  await sleep(700);
  assert.strictEqual(bad.api.isCloud(), true, 'bad config still selects cloud mode');
  assert.strictEqual(bad.api.isOnline(), false, 'auth failure must mark offline');
  assert.strictEqual(bad.api.badge(), '🟠 offline', 'badge must show offline');
  console.log('PASS 4 - invalid credentials degrade to offline (data stays local)');

  // 5) No config -> local /api/state fallback (old behaviour)
  const local = bootApp({});
  await sleep(1000);
  assert.strictEqual(local.api.isCloud(), false, 'empty config must use local mode');
  assert.strictEqual(local.api.badge(), '🟢 DB', 'badge must show DB in local mode');
  assert.strictEqual(local.api.isOnline(), true, 'local handshake must succeed');
  assert(localPosts >= 1, 'state must be POSTed to /api/state');
  assert(Array.isArray(localState.items) && localState.settings && typeof localState.settings === 'object');
  console.log('PASS 5 - local /api/state fallback works unchanged');

  // 6) Local server has data -> adopted
  localState = {
    settings: { name: 'Local Shop' },
    items: [{ id: 'b1', name: 'Bench', cat: 'furniture', price: 700, qty: 5, damage: 0, low: 1 }],
    sites: [],
    history: [],
  };
  const localChanged = await local.api.dbPull();
  assert.strictEqual(localChanged, true, 'local dbPull must adopt server state');
  assert.strictEqual(local.api.getItems()[0].name, 'Bench');
  assert.strictEqual(local.api.badge(), '🟢 DB');
  console.log('PASS 6 - local mode adopts server state');

  await sleep(800); // flush pending debounced timers before closing
  server.close();
  console.log('');
  console.log('All 6 tests passed  (cloud posts: ' + cloudPosts + ', local posts: ' + localPosts + ')');
}

main().catch((err) => {
  console.error('');
  console.error('FAIL - ' + (err && err.message));
  try { server.close(); } catch (e) { /* ignore */ }
  process.exit(1);
});
