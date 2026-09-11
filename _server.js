// Ramdut Stock Manager — static file server + SQLite database backend
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const PORT = 8080;
const DB_PATH = path.join(ROOT, 'ramdut.db');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/* =========================================================
   DATABASE (SQLite)
   ========================================================= */
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS items(
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sites(
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history(
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

const stmt = {
  clearItems: db.prepare('DELETE FROM items'),
  clearSites: db.prepare('DELETE FROM sites'),
  clearHist: db.prepare('DELETE FROM history'),
  clearSett: db.prepare('DELETE FROM settings'),
  insItem: db.prepare('INSERT OR REPLACE INTO items(id,data) VALUES(?,?)'),
  insSite: db.prepare('INSERT OR REPLACE INTO sites(id,data) VALUES(?,?)'),
  insHist: db.prepare('INSERT OR REPLACE INTO history(id,data) VALUES(?,?)'),
  insSett: db.prepare('INSERT OR REPLACE INTO settings(key,data) VALUES(?,?)'),
  allItems: db.prepare('SELECT data FROM items'),
  allSites: db.prepare('SELECT data FROM sites'),
  allHist: db.prepare('SELECT data FROM history'),
  allSett: db.prepare('SELECT data FROM settings'),
};

function loadState() {
  const parse = (rows) => rows.map((r) => JSON.parse(r.data));
  const settings = {};
  stmt.allSett.all().forEach((r) => Object.assign(settings, JSON.parse(r.data)));
  return {
    settings,
    items: parse(stmt.allItems.all()),
    sites: parse(stmt.allSites.all()),
    history: parse(stmt.allHist.all()),
  };
}

function saveState(state) {
  const items = Array.isArray(state.items) ? state.items : [];
  const sites = Array.isArray(state.sites) ? state.sites : [];
  const history = Array.isArray(state.history) ? state.history : [];
  const settings = (state.settings && typeof state.settings === 'object') ? state.settings : {};

  db.exec('BEGIN');
  try {
    stmt.clearItems.run();
    stmt.clearSites.run();
    stmt.clearHist.run();
    stmt.clearSett.run();
    for (const it of items) stmt.insItem.run(String(it.id), JSON.stringify(it));
    for (const s of sites) stmt.insSite.run(String(s.id), JSON.stringify(s));
    for (const h of history) stmt.insHist.run(String(h.id), JSON.stringify(h));
    for (const k of Object.keys(settings)) stmt.insSett.run(k, JSON.stringify(settings[k]));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/* =========================================================
   HTTP SERVER
   ========================================================= */
const server = http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch (e) {
    urlPath = '/';
  }

  // ---- API routes ----
  if (urlPath === '/api/state') {
    if (req.method === 'GET') {
      try { sendJson(res, 200, { ok: true, data: loadState() }); }
      catch (e) { sendJson(res, 500, { ok: false, error: String(e) }); }
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const raw = await readBody(req);
        const state = JSON.parse(raw);
        saveState(state);
        sendJson(res, 200, { ok: true, saved: true });
      } catch (e) {
        sendJson(res, 400, { ok: false, error: String(e) });
      }
      return;
    }
    sendJson(res, 405, { ok: false, error: 'Method not allowed' });
    return;
  }

  // ---- Static files ----
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Ramdut server + SQLite DB running at http://localhost:' + PORT + '/');
  console.log('DB file: ' + DB_PATH);
});
