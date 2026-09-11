/* =========================================================
   રામદૂત સ્ટોક મેનેજર — app.js  (v5.0)
   Data model:
   • items[]   : { id, name, cat, price, qty(godown), damage, low }
   • sites[]   : { id, name, venue, phone, status, items:{ itemId:qty } }
   • history[] : { id, type, title, detail, date }
   ========================================================= */
const SHOP_KEY = 'rmd_shop';
const ITEMS_KEY = 'rmd_items';
const SITES_KEY = 'rmd_sites';
const HIST_KEY = 'rmd_hist';
const APP_V = 'v5.0';

/* ---------- Database (server SQLite) sync ----------
   SQLite on the server is the source of truth when online.
   localStorage stays as an instant offline cache.
   Every save is pushed to the DB (debounced); on startup we
   pull the DB state and adopt it. All network calls are
   best-effort and never block usage. */
const DB_API = '/api/state';
let dbTimer = null;
let dbOnline = false;

function dbPush() {
  if (!navigator.onLine) { dbOnline = false; renderDbBadge(); return; }
  const body = JSON.stringify({
    settings: shop,
    items,
    sites,
    history,
  });
  fetch(DB_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => { dbOnline = !!(d && d.ok); renderDbBadge(); })
    .catch(() => { dbOnline = false; renderDbBadge(); });
}

function dbPushDebounced() {
  clearTimeout(dbTimer);
  dbTimer = setTimeout(dbPush, 600);
}

function renderDbBadge() {
  const b = $('dbBadge');
  if (!b) return;
  if (dbOnline) {
    b.textContent = '🟢 DB';
    b.classList.remove('off');
    b.classList.add('on');
    b.title = 'ડેટાબેઝ સાથે જોડાયેલ — data સેવ થાય છે';
  } else {
    b.textContent = '🟠 offline';
    b.classList.remove('on');
    b.classList.add('off');
    b.title = 'ડેટાબેઝ નથી — માત્ર ડિવાઇસ પર સેવ';
  }
}

function dbPull() {
  if (!navigator.onLine) { renderDbBadge(); return Promise.resolve(false); }
  return fetch(DB_API)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d) => {
      if (!d || !d.ok || !d.data) return false;
      const { settings, items: si, sites: ss, history: hi } = d.data;
      if (Array.isArray(si)) items = si;
      if (Array.isArray(ss)) sites = ss;
      if (Array.isArray(hi)) history = hi;
      if (settings && typeof settings === 'object' && Object.keys(settings).length) shop = settings;
      else if (shop && !shop.name) shop = { name: 'રામદૂત સ્ટોક મેનેજર' };
      normalizeSites();
      items.forEach((i) => { if (i.damage == null) i.damage = 0; });
      saveItems(); saveSites(); saveHistory(); saveShop();
      dbOnline = true;
      renderDbBadge();
      return true;
    })
    .catch(() => { dbOnline = false; renderDbBadge(); return false; });
}

const $ = (id) => document.getElementById(id);

/* ---------- State ---------- */
let shop = { name: 'રામદૂત સ્ટોક મેનેજર' };
let items = [];
let sites = [];
let history = [];
let catFilter = 'all';
let histFilter = 'all';
let siteFilter = 'all';
let currentSiteId = null;
let siteModalOpen = false;

/* ---------- Helpers ---------- */
function uid() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 7);
}
function money(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}
function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function findItem(id) { return items.find((i) => i.id === id); }
function findSite(id) { return sites.find((s) => s.id === id); }

/* Qty of item currently on ALL sites combined */
function siteTotal(itemId) {
  return sites.reduce((sum, s) => sum + ((s.items && s.items[itemId]) || 0), 0);
}
/* Usable (non-damaged) qty overall */
function itemUsable(it) { return (it.qty || 0) + siteTotal(it.id); }
/* Grand total owned incl damaged */
function itemGrand(it) { return itemUsable(it) + (it.damage || 0); }

function emptyState(icon, msg) {
  return `<div class="empty"><div class="empty-icon">${icon}</div>${msg}</div>`;
}

function addHistory(type, title, detail) {
  history.unshift({ id: uid(), type, title, detail, date: Date.now() });
  if (history.length > 600) history.pop();
  saveHistory();
}
function histIcon(t) {
  return t === 'send' ? '🚚' : t === 'return' ? '↩️' : t === 'damage' ? '⚠️' : '➕';
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ---------- Persistence ---------- */
function saveItems() { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); dbPushDebounced(); }
function saveSites() { localStorage.setItem(SITES_KEY, JSON.stringify(sites)); dbPushDebounced(); }
function saveHistory() { localStorage.setItem(HIST_KEY, JSON.stringify(history)); dbPushDebounced(); }
function saveShop() { localStorage.setItem(SHOP_KEY, JSON.stringify(shop)); dbPushDebounced(); }

function normalizeSites() {
  sites.forEach((s) => {
    if (!s.items) s.items = {};
    if (!s.status) s.status = 'running';
  });
}

function load() {
  try { shop = JSON.parse(localStorage.getItem(SHOP_KEY)) || { name: 'રામદૂત સ્ટોક મેનેજર' }; } catch (e) {}
  try { items = JSON.parse(localStorage.getItem(ITEMS_KEY)) || []; } catch (e) { items = []; }
  try { sites = JSON.parse(localStorage.getItem(SITES_KEY)) || []; } catch (e) { sites = []; }
  try { history = JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch (e) { history = []; }

  normalizeSites();
  items.forEach((i) => { if (i.damage == null) i.damage = 0; });

  const hn = $('shopName');
  if (hn) hn.textContent = shop.name;
  const sn = $('setShopName');
  if (sn) sn.value = shop.name;
  const vt = $('verTag');
  if (vt) vt.textContent = APP_V;
  refresh();
  // Online: adopt DB state (source of truth) and re-render.
  dbPull().then((changed) => { if (changed) { refresh(); } else { dbPush(); } });
}

function refresh() {
  renderStats();
  renderCats();
  renderStock(($('search') && $('search').value) || '');
  renderSiteList();
  renderHistory();
  renderLowStock();
  renderRunningSites();
  renderRecent();
  if (siteModalOpen && currentSiteId && findSite(currentSiteId)) renderSiteDetail(currentSiteId);
}

/* ---------- Navigation & Modal ---------- */
function showV(v, btn) {
  closeModal();
  currentSiteId = null;
  document.querySelectorAll('.view').forEach((x) => x.classList.remove('active'));
  const target = $(v);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  else {
    const match = document.querySelector('.nav-btn[data-view="' + v + '"]');
    if (match) match.classList.add('active');
  }

  if (v === 'stock') { renderCats(); renderStock(($('search') && $('search').value) || ''); }
  if (v === 'history') renderHistory();
  if (v === 'sites') renderSiteList();
  if (v === 'home') { renderStats(); renderLowStock(); renderRunningSites(); renderRecent(); }
}

function openSettings() {
  showV('settings', document.querySelector('.nav-btn[data-view="settings"]'));
}

function openModal(title, body) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = body;
  $('modal').classList.remove('hidden');
}
function closeModal() {
  const m = $('modal');
  if (m) m.classList.add('hidden');
  siteModalOpen = false;
  currentSiteId = null;
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function renderStats() {
  const tW = items.reduce((s, i) => s + (i.qty || 0), 0);
  const tS = items.reduce((s, i) => s + siteTotal(i.id), 0);
  const tD = items.reduce((s, i) => s + (i.damage || 0), 0);
  const tVal = items.reduce((s, i) => s + (i.price || 0) * itemUsable(i), 0);

  $('sTotal').textContent = tW + tS + tD;
  $('sWarehouse').textContent = tW;
  $('sSite').textContent = tS;
  $('sDamage').textContent = tD;
  $('sValue').textContent = money(tVal);
}

function renderLowStock() {
  const el = $('lowStock');
  if (!el) return;
  const low = items.filter((i) => (i.low || 0) > 0 && (i.qty || 0) <= i.low).sort((a, b) => a.qty - b.qty);
  if (!low.length) { el.innerHTML = emptyState('✅', 'બધા માલનો સ્ટોક ઠીક છે'); return; }
  el.innerHTML = low.map((i) => `
    <div class="item">
      <div class="item-name">${esc(i.name)} <span class="low-badge">ઓછો સ્ટોક</span></div>
      <div class="item-cat">${esc(i.cat || 'અન્ય')}</div>
      <div class="item-stats">
        <div class="mini-stat"><span>ગોડાઉન</span><b>${i.qty || 0}</b></div>
        <div class="mini-stat"><span>લિમિટ</span><b>${i.low}</b></div>
      </div>
    </div>`).join('');
}

function renderRunningSites() {
  const el = $('runningSites');
  if (!el) return;
  const run = sites.filter((s) => s.status !== 'complete');
  if (!run.length) { el.innerHTML = emptyState('🏗️', 'અત્યારે કોઈ ચાલુ સાઇટ નથી'); return; }
  el.innerHTML = run.map((s) => `
    <div class="run-site" onclick="openSiteDetail('${s.id}')">
      <div>
        <b>${esc(s.name)}</b>
        <div class="muted">${esc(s.venue || '')}${s.phone ? ' • ' + esc(s.phone) : ''}</div>
      </div>
      <span class="site-count">${siteTotal(s.id)}</span>
    </div>`).join('');
}

function renderRecent() {
  const el = $('recent');
  if (!el) return;
  const rec = history.slice(0, 5);
  el.innerHTML = rec.length ? rec.map(histHtml).join('') : emptyState('🕐', 'હજુ કોઈ હિસ્ટરી નથી');
}

/* ===========================================================
   STOCK / GODOWN
   ========================================================= */
function renderCats() {
  const el = $('catFilters');
  if (!el) return;
  const cats = ['all', ...new Set(items.map((i) => i.cat || 'અન્ય').map((c) => (c || '').trim()).filter(Boolean))];
  el.innerHTML = cats.map((c) =>
    `<button class="chip ${catFilter === c ? 'active' : ''}" onclick="setCat('${c}',this)">${c === 'all' ? 'બધું' : esc(c)}</button>`
  ).join('');
}

function setCat(c, el) {
  catFilter = c;
  document.querySelectorAll('#catFilters .chip').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  renderStock(($('search') && $('search').value) || '');
}

function renderStock(q) {
  const el = $('stockList');
  if (!el) return;
  const query = (q || '').toLowerCase().trim();
  let list = items.filter((i) =>
    !query ||
    (i.name || '').toLowerCase().includes(query) ||
    (i.cat || '').toLowerCase().includes(query)
  );
  if (catFilter !== 'all') list = list.filter((i) => (i.cat || 'અન્ય').trim() === catFilter);

  if (!list.length) { el.innerHTML = emptyState('📦', 'કોઈ માલ નથી. “➕ નવો” બટનથી ઉમેરો'); return; }
  el.innerHTML = list.map(itemCard).join('');
}

function itemCard(it) {
  const st = siteTotal(it.id);
  const usu = itemUsable(it);
  const low = (it.low || 0) > 0 && (it.qty || 0) <= it.low
    ? `<span class="low-badge">ઓછો સ્ટોક</span>` : '';
  return `
  <div class="item">
    <div class="item-top">
      <div>
        <div class="item-name">${esc(it.name)} ${low}</div>
        <div class="item-cat">${esc(it.cat || 'અન્ય')}${it.price ? ` • ${money(it.price)}` : ''}</div>
      </div>
    </div>
    <div class="item-stats">
      <div class="mini-stat"><span>ગોડાઉન</span><b>${it.qty || 0}</b></div>
      <div class="mini-stat"><span>સાઇટ પર</span><b>${st}</b></div>
      <div class="mini-stat"><span>તૂટેલો</span><b style="${(it.damage||0)>0?'color:var(--red);cursor:pointer;':''}" onclick="${(it.damage||0)>0?'openDamageEdit()':''}">${it.damage || 0}</b></div>
      <div class="mini-stat"><span>કુલ</span><b>${usu}</b></div>
    </div>
    <div class="item-actions">
      <button class="btn blue" onclick="openSend('${it.id}')">🚚 સાઇટ મોકલો</button>
      <button class="btn red" onclick="openDamage('${it.id}')">⚠️ તૂટેલો</button>
      <button class="btn green" onclick="openEdit('${it.id}')">✏️</button>
      <button class="btn danger" onclick="deleteItem('${it.id}')">🗑️</button>
    </div>
  </div>`;
}

function histHtml(h) {
  return `<div class="history-item">
    <div class="h-icon ${h.type}"><span>${histIcon(h.type)}</span></div>
    <div class="h-body">
      <div class="h-title">${esc(h.title)}</div>
      <div class="h-detail">${esc(h.detail)}</div>
      <div class="h-date">${fmtDate(h.date)}</div>
    </div>
  </div>`;
}

/* ===========================================================
   MODAL FORM HELPERS
   ========================================================= */
function mainItemOpts(selectedId) {
  if (!items.length) return '<option value="">કોઈ માલ નથી — પહેલા નવો માલ ઉમેરો</option>';
  return items.map((i) =>
    `<option value="${i.id}" ${i.id === selectedId ? 'selected' : ''}>${esc(i.name)} (ગોડાઉન ${i.qty || 0})</option>`
  ).join('');
}

function siteOpts(selectedId) {
  if (!sites.length) return '<option value="">પહેલા સાઇટ ઉમેરો</option>';
  return sites.map((s, i) =>
    `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>(${i + 1}) ${esc(s.name)}${s.venue ? ' — ' + esc(s.venue) : ''}</option>`
  ).join('');
}

function sendSiteName() {
  const s = $('sSite');
  if (!s || !s.value) return '';
  const site = findSite(s.value);
  return site ? esc(site.name) : '';
}
function updateSendSiteNote() {
  const n = $('sSiteNote');
  if (n) n.innerHTML = sendSiteName() ? `➡️ મોકલાશે → <b>${sendSiteName()}</b>` : '➡️ પહેલા સાઇટ પસંદ કરો';
}

/* ===========================================================
   ADD / EDIT / DELETE ITEM
   ========================================================= */
function openAdd() {
  const catOpts = [...new Set(items.map((i) => i.cat).filter(Boolean))];
  openModal('➕ નવો માલ (ગોડાઉન)',
    `<div class="form-group">
      <label>માલનું નામ</label><input id="newName" placeholder="દા.ત. LED, સમાનો, વિંડો">
      <label>કેટેગરી</label>
      <input id="newCat" list="catList" placeholder="દા.ત. light, paint, પ્લમ્બિંગ">
      <datalist id="catList">${catOpts.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>કિંમત (₹)</label><input id="newPrice" type="number" min="0" value="0" placeholder="0">
      <label>કુલ કેટલા છે</label><input id="newQty" type="number" min="0" value="0" placeholder="0">
      <label>ઓછો સ્ટોક (લિમિટ)</label><input id="newLow" type="number" min="0" value="0" placeholder="0">
      <button class="btn primary full" onclick="submitAdd()">➕ ઉમેરો</button>
    </div>`);
}

function submitAdd() {
  const name = ($('newName').value || '').trim();
  if (!name) { toast('માલનું નામ લખો'); return; }
  const qty = Math.max(0, parseInt($('newQty').value || '0', 10));
  items.push({
    id: uid(),
    name,
    cat: ($('newCat').value || 'અન્ય').trim() || 'અન્ય',
    price: Math.max(0, parseFloat($('newPrice').value || '0')),
    qty,
    damage: 0,
    low: Math.max(0, parseInt($('newLow').value || '0', 10)),
  });
  saveItems();
  addHistory('add', `નવો માલ: ${name}`, `${qty} ગોડાઉનમાં`);
  toast(`${name} ઉમેર્યો`);
  closeModal();
  refresh();
}

function openEdit(id) {
  const it = findItem(id);
  if (!it) return;
  openModal('✏️ ફેરફાર કરો',
    `<div class="form-group">
      <label>માલનું નામ</label><input id="edName" value="${esc(it.name)}">
      <label>કેટેગરી</label><input id="edCat" value="${esc(it.cat || 'અન્ય')}">
      <label>કિંમત (₹)</label><input id="edPrice" type="number" min="0" value="${it.price || 0}">
      <label>ગોડાઉનમાં કુલ સંખ્યા</label><input id="edQty" type="number" min="0" value="${it.qty || 0}">
      <label>ઓછો સ્ટોક (લિમિટ)</label><input id="edLow" type="number" min="0" value="${it.low || 0}">
      <button class="btn primary full" onclick="editSave('${id}')">સેવ કરો</button>
    </div>`);
}

function editSave(id) {
  const it = findItem(id);
  if (!it) return;
  const name = ($('edName').value || '').trim();
  if (!name) { toast('નામ લખો'); return; }
  it.name = name;
  it.cat = ($('edCat').value || 'અન્ય').trim() || 'અન્ય';
  it.price = Math.max(0, parseFloat($('edPrice').value || '0'));
  it.qty = Math.max(0, parseInt($('edQty').value || '0', 10));
  it.low = Math.max(0, parseInt($('edLow').value || '0', 10));
  saveItems();
  toast('ફેરફાર સેવ થયો');
  closeModal();
  refresh();
}

function deleteItem(id) {
  const it = findItem(id);
  if (!it) return;
  if (!confirm(`ખરેખર “${it.name}” દાલ કરવો છે?`)) return;
  items = items.filter((x) => x.id !== id);
  sites.forEach((s) => { if (s.items) delete s.items[id]; });
  saveItems(); saveSites();
  closeModal();
  refresh();
  toast('માલ દાલ કર્યો');
}

/* ===========================================================
   SEND TO SITE  (એક સાથે બહુ માલ મોકલો)
   ========================================================= */
function openSend(itemId) {
  if (!items.length) { toast('પહેલા માલ ઉમેરો'); return; }
  if (!sites.length) { toast('પહેલા સાઇટ ઉમેરો'); return; }
  openModal('🚚 સાઇટ પર માલ મોકલો',
    `<div class="form-group">
      <label>કઈ સાઇટ પર</label>
      <select id="msSite" onchange="updateMsSiteNote()">${siteOpts(currentSiteId)}</select>
      <p class="qty-note" id="msSiteNote" style="font-size:13px;font-weight:700;color:#4f46e5"></p>
      <label>કેટલા મોકલવા છે — દરેક માલની સંખ્યા લખો (એક સાથે બધા મોકલી શકાય)</label>
      <div id="msList" class="ms-list"></div>
      <div class="ms-total">કુલ મોકલાશે: <b id="msTotal">0</b> પ્રાયુતા</div>
      <button class="btn primary full" onclick="multiSendSubmit()">🚚 બધા મોકલો</button>
    </div>`);
  renderMsList(itemId);
  updateMsSiteNote();
}

function updateMsSiteNote() {
  const n = $('msSiteNote');
  if (!n) return;
  const s = $('msSite');
  const site = s && s.value ? findSite(s.value) : null;
  n.innerHTML = site ? `➡️ મોકલાશે → <b>${esc(site.name)}</b>` : '➡️ પહેલા સાઇટ પસંદ કરો';
}

function renderMsList(focusItemId) {
  const box = $('msList');
  if (!box) return;
  box.innerHTML = items.map((it) => {
    const st = it.qty || 0;
    const focus = it.id === focusItemId ? ' style="outline:2px solid #4f46e5"' : '';
    return `
    <div class="ms-item"${focus}>
      <div class="ms-name">
        <b>${esc(it.name)}</b>
        <span class="muted">ગોડાઉનમાં: ${st}</span>
      </div>
      <input class="ms-qty" id="msq_${it.id}" type="number" min="0" max="${st}" value="${it.id === focusItemId ? 1 : 0}" oninput="updateMsTotal()">
    </div>`;
  }).join('');
  updateMsTotal();
}

function updateMsTotal() {
  const t = $('msTotal');
  if (!t) return;
  let total = 0;
  items.forEach((it) => {
    const inp = $('msq_' + it.id);
    if (inp) total += parseInt(inp.value || '0', 10);
  });
  t.textContent = total;
}

function multiSendSubmit() {
  const site = findSite($('msSite').value);
  if (!site) { toast('સાઇટ પસંદ કરો'); return; }

  // પહેલા બધું ચેક કરો, પછી જ ઓછું કરો
  const plan = [];
  let any = false;
  for (const it of items) {
    const inp = $('msq_' + it.id);
    if (!inp) continue;
    const q = parseInt(inp.value || '0', 10);
    if (q <= 0) continue;
    if (q > (it.qty || 0)) { toast(`${it.name}: ગોડાઉનમાં ફક્ત ${it.qty || 0} છે`); return; }
    plan.push({ it, q });
    any = true;
  }
  if (!any) { toast('કંઈ પણ સંખ્યા લખો'); return; }

  if (!site.items) site.items = {};
  let total = 0;
  const lines = [];
  for (const { it, q } of plan) {
    it.qty = (it.qty || 0) - q;
    site.items[it.id] = (site.items[it.id] || 0) + q;
    total += q;
    lines.push(`${it.name} ${q}`);
  }
  saveItems(); saveSites();
  addHistory('send', `${plan.length} માલ → ${site.name}`, lines.join(', '));
  toast(`${plan.length} માલ (કુલ ${total}) → ${site.name} મોકલ્યા`);
  if (!keepSitePopupOpen()) closeModal();
  refresh();
}

/* ===========================================================
   RETURN FROM SITE
   ========================================================= */
function openReturn() {
  if (!sites.length) { toast('પહેલા સાઇટ ઉમેરો'); return; }
  openModal('↩️ સાઇટ પરથી માલ પાછો લાવો',
    `<div class="form-group">
      <label>કઈ સાઇટ પરથી</label>
      <select id="rSite" onchange="renderReturnItems()">${siteOpts()}</select>
      <label>કયો માલ</label>
      <select id="rItem"></select>
      <label>કેટલા પાછા લાવવા છે</label>
      <input id="rQty" type="number" min="1" placeholder="0">
      <p class="qty-note">જેટલા પાછા લાવો એ ગોડાઉનમાં ઉમેરાય; બાકીના સાઇટ પર રહે.</p>
      <button class="btn green full" onclick="returnSubmit()">↩️ પાછા લાવો</button>
    </div>`);
  renderReturnItems();
}

function renderReturnItems() {
  const sel = $('rSite');
  const box = $('rItem');
  if (!sel || !box) return;
  const site = findSite(sel.value);
  const pairs = site
    ? Object.keys(site.items || {}).filter((id) => (site.items[id] || 0) > 0).map((id) => [id, site.items[id]])
    : [];
  if (!site || !pairs.length) {
    box.innerHTML = '<option value="">આ સાઇટ પર કોઈ માલ નથી</option>';
    return;
  }
  box.innerHTML = pairs.map(([id, n]) => {
    const it = findItem(id);
    return it ? `<option value="${it.id}">${esc(it.name)} (સાઇટ પર ${n})</option>` : '';
  }).join('');
}

function returnSubmit() {
  const site = findSite($('rSite').value);
  const it = findItem($('rItem').value);
  const qty = parseInt($('rQty').value || '0', 10);
  if (!site) { toast('સાઇટ પસંદ કરો'); return; }
  if (!it) { toast('માલ પસંદ કરો'); return; }
  if (qty <= 0) { toast('પ્રાયુતા લખો'); return; }

  const onSite = (site.items && site.items[it.id]) || 0;
  if (qty > onSite) { toast(`આ સાઇટ પર ફક્ત ${onSite} છે`); return; }

  site.items[it.id] = onSite - qty;
  if (site.items[it.id] <= 0) delete site.items[it.id];
  it.qty = (it.qty || 0) + qty;
  saveItems(); saveSites();

  const left = onSite - qty;
  addHistory('return', `${it.name} ગોડાઉન પાછું → ${site.name}`, left > 0
    ? `${qty} પાછા; સાઇટ પર ${left} રહ્યા`
    : `${qty} બધા પાછા`);
  toast(`પાછા: ${it.name} (${qty})` + (left > 0 ? ` — સાઇટ પર ${left} રહ્યા` : ''));
  if (!keepSitePopupOpen()) closeModal();
  refresh();
}
/* ===========================================================
   DAMAGE
   ========================================================= */
function openDamage(itemId) {
  if (!items.length) { toast('પહેલા માલ ઉમેરો'); return; }
  openModal('⚠️ તૂટેલો માલ (નુકસાન)',
    `<div class="form-group">
      <label>કયો માલ</label>
      <select id="dItem">${mainItemOpts(itemId)}</select>
      <label>ક્યાંથી</label>
      <select id="dFrom">
        <option value="godown">ગોડાઉન (main)</option>
        ${sites.map((s) => {
          const t = Object.values(s.items || {}).reduce((a, b) => a + b, 0);
          return `<option value="${s.id}">${esc(s.name)} (સાઇટ પર ${t})</option>`;
        }).join('')}
      </select>
      <label>કેટલો તૂટ્યો</label>
      <input id="dQty" type="number" min="1" placeholder="0">
      <button class="btn primary full" onclick="damageSubmit()">⚠️ નોંધ કરો</button>
    </div>`);
}

function damageSubmit() {
  const it = findItem($('dItem').value);
  if (!it) { toast('માલ પસંદ કરો'); return; }
  const qty = parseInt($('dQty').value || '0', 10);
  if (qty <= 0) { toast('પ્રાયુતા લખો'); return; }

  const from = $('dFrom').value;
  let fromLabel = 'ગોડાઉન';
  if (from === 'godown') {
    if (qty > (it.qty || 0)) { toast(`ગોડાઉનમાં ફક્ત ${it.qty || 0} છે`); return; }
    it.qty -= qty;
  } else {
    const site = findSite(from);
    if (!site) return;
    const onSite = (site.items && site.items[it.id]) || 0;
    if (qty > onSite) { toast(`આ સાઇટ પર ફક્ત ${onSite} છે`); return; }
    site.items[it.id] = onSite - qty;
    if (site.items[it.id] <= 0) delete site.items[it.id];
    fromLabel = site.name;
  }

  it.damage = (it.damage || 0) + qty;
  saveItems(); saveSites();
  addHistory('damage', `તૂટેલો: ${it.name}`, `${qty} (${fromLabel})`);
  toast(`તૂટેલો: ${it.name} (${qty})`);
  if (!keepSitePopupOpen()) closeModal();
    refresh();
}

/* ===========================================================
   DAMAGE — EDIT / SUMMARY
   ========================================================= */
// Show an editable summary of all damaged items across the shop.
// Tap a qty to edit it → live change to item.damage → save.
let damageEditCacheSite = null; // 'godown' or siteId for damage source filter
function openDamageEdit(siteId) {
  // siteId optional: if given, show only damages sourced from that site.
  damageEditCacheSite = siteId || null;
  const rows = items.filter((i) => (i.damage || 0) > 0).sort((a, b) => (b.damage || 0) - (a.damage || 0));
  if (!rows.length) {
    toast('કોઈપણ તૂટેલો માલ નથી');
    return;
  }
  openModal('⚠️ તૂટેલો માલ (એડિટ)',
    `<div class="form-group">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <label style="font-weight:700;">કુલ તૂટેલો માલ</label>
        <b style="font-size:15px;color:var(--red);">${rows.length} આઈટમ • ${rows.reduce((s, i) => s + (i.damage || 0), 0)} એકમ</b>
      </div>
      <div class="damage-summary" style="max-height:52vh;overflow:auto;">
        ${rows.map((i) => `
          <div class="dmg-row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
            <div style="flex:1;">
              <div class="item-name">${esc(i.name)}</div>
              <div class="item-cat muted">${esc(i.cat || 'અન્ય')}</div>
            </div>
            <input id="dmg_${i.id}" type="number" min="0" step="1" value="${i.damage || 0}"
                   oninput="updateDmgTotal('${i.id}')"
                   style="width:80px;text-align:center;border:1px solid var(--border);border-radius:8px;padding:6px;font-weight:700;background:#fff;">
            <div style="width:95px;text-align:right;">
              <div class="muted" style="font-size:11px;">કિંમત</div>
              <b>${money((i.damage || 0) * (i.price || 0))}</b>
            </div>
            <button class="btn danger sm" style="padding:6px 8px;" onclick="event.stopPropagation();dropDamageItem('${i.id}')" title="આ આઈટમ drop કરો">🗑️</button>
          </div>
        `).join('')}
      </div>
      <hr>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <label>કુલ તૂટેલો</label>
        <b id="dmgTotalQty" style="font-size:18px;color:var(--red);">${rows.reduce((s, i) => s + (i.damage || 0), 0)}</b>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
        <label>કુલ કિંમત</label>
        <b id="dmgTotalVal">${money(rows.reduce((s, i) => s + (i.damage || 0) * (i.price || 0), 0))}</b>
      </div>
      <button class="btn primary full" onclick="saveDamageEdit()" style="margin-top:12px;">💾 સેવ કરો</button>
    </div>`);
  // Initialize live totals
  updateAllDmgTotals();
}

// Recompute grand total qty & value for the damage edit popup
function updateAllDmgTotals() {
  const rows = items.filter((i) => (i.damage || 0) >= 0);
  const tQty = rows.reduce((s, i) => s + (parseInt($(`dmg_${i.id}`).value || '0', 10) || 0), 0);
  const tVal = rows.reduce((s, i) => {
    const q = parseInt($(`dmg_${i.id}`).value || '0', 10) || 0;
    return s + q * (i.price || 0);
  }, 0);
  const tQtyEl = $('dmgTotalQty');
  const tValEl = $('dmgTotalVal');
  if (tQtyEl) tQtyEl.textContent = tQty;
  if (tValEl) tValEl.textContent = money(tVal);
}
function updateDmgTotal(itemId) {
  const el = $(`dmg_${itemId}`);
  let v = parseInt(el.value || '0', 10);
  if (isNaN(v) || v < 0) v = 0;
  el.value = v;
  updateAllDmgTotals();
}

// Drop (remove) an entry from the damaged list: clears its damage
// and returns the damaged qty back to godown stock.
function dropDamageItem(itemId) {
  const it = findItem(itemId);
  if (!it) return;
  const n = it.damage || 0;
  if (n <= 0) return;
  it.qty = (it.qty || 0) + n;
  it.damage = 0;
  saveItems(); saveSites();
  addHistory('damage', 'તૂટેલો માલ drop', `${it.name} (${n})`);
  toast(`🗑️ ${it.name} drop: ${n} ગોડાઉનમાં પાછા`);
  // Re-open the popup so the dropped row disappears & totals refresh
  openDamageEdit(damageEditCacheSite);
}

function saveDamageEdit() {
  items.forEach((i) => {
    const el = $(`dmg_${i.id}`);
    if (!el) return;
    let v = parseInt(el.value || '0', 10);
    if (isNaN(v) || v < 0) v = 0;
    const delta = v - (i.damage || 0);
    if (delta !== 0) {
      // restore the goods: damaged qty that was removed goes back to godown
      if (delta < 0) {
        i.qty = (i.qty || 0) + Math.abs(delta);
      } else {
        // newly damaged goods go out of usable godown stock
        i.qty = Math.max(0, (i.qty || 0) - delta);
      }
      i.damage = v;
    }
  });
  saveItems(); saveSites();
  addHistory('damage', 'તૂટેલો માલ એડિટ', 'જાતનાર કદ બદલ્યો');
  toast('💾 તૂટેલો માલ એપડેટ થયો');
  closeModal();
  refresh();
}

/* ===========================================================
   SITES — LIST & MANAGEMENT
   ========================================================= */
function setSiteFilter(f, el) {
  siteFilter = f;
  document.querySelectorAll('#siteFilters .chip').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  renderSiteList();
}

function renderSiteList() {
  const el = $('siteList');
  if (!el) return;
  const list = sites.filter((s) => siteFilter === 'all' || s.status === siteFilter);
  if (!list.length) {
    el.innerHTML = emptyState('🏢', sites.length
      ? (siteFilter === 'running' ? 'કોઈ ચાલુ સાઇટ નથી' : 'કોઈ પૂર્ણ સાઇટ નથી')
      : 'હજુ કોઈ સાઇટ ઉમેરી નથી');
    return;
  }
  el.innerHTML = list.map(siteCard).join('');
}

function siteCard(s) {
  const running = s.status !== 'complete';
  return `
  <div class="site-card" onclick="openSiteDetail('${s.id}')">
    <div class="site-card-head">
      <b>${esc(s.name)}</b>
      <span class="site-count">${siteTotal(s.id)}</span>
    </div>
    <div class="site-info">
      <div class="muted">${esc(s.venue || '')}${s.phone ? ' • ' + esc(s.phone) : ''}</div>
      <div class="muted">ક્લિક કરી ખોલો → આ સાઇટનો ખાતું</div>
    </div>
    <div class="site-status-row">
      <span class="site-badge ${running ? 'running' : 'done'}">${running ? '🟢 ચાલુ' : '✅ પૂર્ણ'}</span>
      <div class="site-actions">
        <button class="btn sm ${running ? 'blue' : 'green'}" onclick="event.stopPropagation();toggleSiteStatus('${s.id}')">${running ? '✅ પૂર્ણ કરો' : '🔄 ચાલુ કરો'}</button>
        <button class="btn blue sm" onclick="event.stopPropagation();openSiteEdit('${s.id}')">✏️</button>
        <button class="btn danger sm" onclick="event.stopPropagation();deleteSite('${s.id}')">🗑️</button>
      </div>
    </div>
  </div>`;
}

function addSite() {
  const name = ($('siteName').value || '').trim();
  if (!name) { toast('સાઇટનું નામ લખો'); return; }
  sites.push({
    id: uid(),
    name,
    venue: ($('siteVenue').value || '').trim(),
    phone: ($('sitePhone').value || '').trim(),
    items: {},
    status: 'running',
  });
  saveSites();
  $('siteName').value = '';
  $('siteVenue').value = '';
  $('sitePhone').value = '';
  toast('સાઇટ ઉમેરી');
  renderSiteList();
  renderRunningSites();
}

function openSiteEdit(id) {
  const s = findSite(id);
  if (!s) return;
  openModal('✏️ સાઇટ',
    `<div class="form-group">
      <label>નામ</label><input id="edSiteName" value="${esc(s.name)}">
      <label>સ્થળ</label><input id="edSiteVenue" value="${esc(s.venue || '')}">
      <label>ફોન</label><input id="edSitePhone" value="${esc(s.phone || '')}" type="tel">
      <button class="btn primary full" onclick="siteEditSave('${id}')">સેવ કરો</button>
    </div>`);
}

function siteEditSave(id) {
  const s = findSite(id);
  if (!s) return;
  const name = ($('edSiteName').value || '').trim();
  if (!name) { toast('નામ લખો'); return; }
  s.name = name;
  s.venue = ($('edSiteVenue').value || '').trim();
  s.phone = ($('edSitePhone').value || '').trim();
  saveSites();
  toast('સાઇટ સેવ થઈ');
  closeModal();
  renderSiteList();
  renderRunningSites();
}

function toggleSiteStatus(id) {
  const s = findSite(id);
  if (!s) return;
  s.status = s.status === 'complete' ? 'running' : 'complete';
  saveSites();
  const label = s.status === 'complete' ? 'પૂર્ણ' : 'ચાલુ';
  toast(`સાઇટ “${s.name}” → ${label}`);
  if (siteModalOpen && currentSiteId === id) renderSiteDetail(id);
  renderSiteList();
  renderRunningSites();
}

function deleteSite(id) {
  if (!confirm('આ સાઇટ દાલ કરવી છે? (તેના માલ ગોડાઉનમાં પાછા આવશે નહીં — સાવધાન!)')) return;
  const s = findSite(id);
  if (s && s.items) {
    Object.keys(s.items).forEach((itId) => {
      const it = findItem(itId);
      if (it) it.qty = (it.qty || 0) + (s.items[itId] || 0);
    });
  }
  sites = sites.filter((x) => x.id !== id);
  saveItems(); saveSites();
  renderSiteList();
  renderRunningSites();
  toast('સાઇટ દાલ કરી (માલ ગોડાઉનમાં પાછો)');
}
/* ===========================================================
   SITE DETAIL — POPUP
   ========================================================= */
function openSiteDetail(id) {
  currentSiteId = id;
  siteModalOpen = true;
  renderSiteDetail(id);
}
function closeSiteDetail() { closeModal(); }

/* Keep the site popup open & re-render it if currently inside one */
function keepSitePopupOpen() {
  if (siteModalOpen && currentSiteId && findSite(currentSiteId)) {
    renderSiteDetail(currentSiteId);
    return true;
  }
  return false;
}

function renderSiteDetail(siteId) {
  const site = findSite(siteId);
  if (!site) { closeModal(); return; }

  const entries = Object.entries(site.items || {}).filter(([, n]) => n > 0);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const running = site.status !== 'complete';
  const badge = `<span class="site-badge ${running ? 'running' : 'done'}">${running ? '🟢 ચાલુ' : '✅ પૂર્ણ'}</span>`;

  let rows;
  if (!entries.length) {
    rows = `<div class="empty"><div class="empty-icon">📭</div>આ સાઇટ પર હજુ કોઈ માલ નથી<br><br>
      <button class="btn primary" onclick="openSend()">➕ પહેલો માલ મોકલો</button></div>`;
  } else {
    rows = entries.map(([itemId, n]) => {
      const it = findItem(itemId);
      const nm = it ? esc(it.name) : '?' + itemId;
      return `
      <div class="site-item-card">
        <div class="sit-top">
          <b>${nm}</b>
          <span class="sit-qty">${n}</span>
        </div>
        <div class="sit-actions">
          <button class="btn green" onclick="openSiteReturn('${site.id}','${itemId}')">↩️ પાછા</button>
          <button class="btn blue" onclick="openSiteEditItem('${site.id}','${itemId}')">✏️ Edit</button>
          <button class="btn red" onclick="openSiteDamage('${site.id}','${itemId}')">⚠️ તૂટેલો</button>
        </div>
      </div>`;
    }).join('');
  }

  const body = `
    <div class="sd-title">
      <div class="muted">${esc(site.venue || '')}${site.phone ? ' • ' + esc(site.phone) : ''} ${badge}</div>
      <button class="link" onclick="openSiteEdit('${site.id}')">✏️ સાઇટની માહિતી બદલો</button>
    </div>
    <div class="card" style="padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div class="muted">આ સાઇટ પર કુલ</div><b style="font-size:24px">${total}</b></div>
        <button class="btn primary sm" onclick="openSend()">➕ માલ મોકલો (ઘણા સાથે)</button>
      </div>
    </div>
    ${rows}`;

  openModal(`🏢 ${esc(site.name)}`, body);
}

/* Site-scoped EDIT qty directly on site (ગોડાઉન ઓછું/વધું આપોઆપ) */
function openSiteEditItem(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  openModal(`✏️ ${esc(it.name)} — સાઇટ પર`,
    `<div class="form-group">
      <p class="qty-note">સાઇટ <b>${esc(site.name)}</b> પર હાલ <b>${onSite}</b> છે.</p>
      <label>સાઇટ પર કેટલા રાખવા છે (નવી સંખ્યા)</label>
      <input id="seQty" type="number" min="0" value="${onSite}">
      <p class="qty-note">• સંખ્યા વધારો = ગોડાઉનમાંથી મોકલાશે<br>• સંખ્યા ઓછી કરો = ગોડાઉનમાં પાછા આવશે<br>ગોડાઉનમાં હાલ: <b>${it.qty || 0}</b></p>
      <button class="btn primary full" onclick="siteEditItemSave('${siteId}','${itemId}')">સેવ કરો</button>
    </div>`);
}

function siteEditItemSave(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  const newQty = parseInt($('seQty').value || '', 10);
  if (isNaN(newQty) || newQty < 0) { toast('સાચી સંખ્યા લખો'); return; }
  const diff = newQty - onSite;
  if (diff === 0) { if (!keepSitePopupOpen()) closeModal(); return; }

  if (!site.items) site.items = {};
  if (diff > 0) { // ગોડાઉનમાંથી વધારો
    if (diff > (it.qty || 0)) { toast(`ગોડાઉનમાં ફક્ત ${it.qty || 0} છે`); return; }
    it.qty = (it.qty || 0) - diff;
    site.items[itemId] = newQty;
    addHistory('send', `${it.name} → ${site.name} (એડિટ)`, `${diff} વધાર્યા, કુલ ${newQty}`);
    toast(`${it.name}: +${diff} → ${site.name}`);
  } else { // ગોડાઉનમાં પાછા
    const back = -diff;
    it.qty = (it.qty || 0) + back;
    site.items[itemId] = newQty;
    if (site.items[itemId] <= 0) delete site.items[itemId];
    addHistory('return', `${it.name} ગોડાઉન પાછું (એડિટ) → ${site.name}`, `${back} પાછા`);
    toast(`${it.name}: −${back} ગોડાઉન પાછા`);
  }
  saveItems(); saveSites();
  if (!keepSitePopupOpen()) closeModal();
  refresh();
}

/* Site-scoped return (partial qty from a specific site+item) */
function openSiteReturn(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  openModal(`↩️ ${esc(it.name)} પાછા લાવો`,
    `<div class="form-group">
      <p class="qty-note">સાઇટ <b>${esc(site.name)}</b> પર હાલ ${onSite} છે.</p>
      <label>કેટલા પાછા લાવવા છે</label>
      <input id="srQty" type="number" min="1" max="${onSite}" placeholder="0">
      <div class="big-qty" id="srLeft"></div>
      <p class="qty-note" id="srNote">બાકી પ્રાયુતા સાઇટ પર રહેશે</p>
      <button class="btn green full" onclick="siteReturnSubmit('${siteId}','${itemId}')">↩️ પાછા લાવો</button>
    </div>`);
  const q = $('srQty');
  q.oninput = () => {
    const v = parseInt(q.value || '0', 10);
    const left = Math.max(0, onSite - v);
    const leftEl = $('srLeft');
    if (leftEl) leftEl.textContent = left > 0 ? `${onSite} − ${v} = ${left} સાઇટ પર રહેશે` : 'બધા પાછા આવી જશે';
  };
}

function siteReturnSubmit(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  const qty = parseInt($('srQty').value || '0', 10);
  if (qty <= 0) { toast('પ્રાયુતા લખો'); return; }
  if (qty > onSite) { toast(`આ સાઇટ પર ફક્ત ${onSite} છે`); return; }

  site.items[itemId] = onSite - qty;
  if (site.items[itemId] <= 0) delete site.items[itemId];
  it.qty = (it.qty || 0) + qty;
  saveItems(); saveSites();

  const left = onSite - qty;
  addHistory('return', `${it.name} ગોડાઉન પાછું → ${site.name}`, left > 0
    ? `${qty} પાછા; સાઇટ પર ${left} રહ્યા` : `${qty} બધા પાછા`);
  toast(`પાછા: ${it.name} (${qty})` + (left > 0 ? ` — સાઇટ પર ${left} રહ્યા` : ''));
  if (!keepSitePopupOpen()) closeModal();
  refresh();
}

/* Site-scoped damage */
function openSiteDamage(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  openModal(`⚠️ ${esc(it.name)} તૂટેલો`,
    `<div class="form-group">
      <p class="qty-note">સાઇટ <b>${esc(site.name)}</b> પર હાલ ${onSite} છે.</p>
      <label>કેટલો તૂટ્યો</label>
      <input id="sdmQty" type="number" min="1" max="${onSite}" placeholder="0">
      <button class="btn red full" onclick="siteDamageSubmit('${siteId}','${itemId}')">⚠️ નોંધ કરો</button>
    </div>`);
}

function siteDamageSubmit(siteId, itemId) {
  const site = findSite(siteId);
  const it = findItem(itemId);
  if (!site || !it) return;
  const onSite = (site.items && site.items[itemId]) || 0;
  const qty = parseInt($('sdmQty').value || '0', 10);
  if (qty <= 0) { toast('પ્રાયુતા લખો'); return; }
  if (qty > onSite) { toast(`આ સાઇટ પર ફક્ત ${onSite} છે`); return; }

  site.items[itemId] = onSite - qty;
  if (site.items[itemId] <= 0) delete site.items[itemId];
  it.damage = (it.damage || 0) + qty;
  saveItems(); saveSites();
  addHistory('damage', `તૂટેલો: ${it.name}`, `${qty} (${site.name})`);
  toast(`તૂટેલો: ${it.name} (${qty})`);
  if (!keepSitePopupOpen()) closeModal();
  refresh();
}
/* ===========================================================
   HISTORY
   ========================================================= */
function setHistFilter(f, el) {
  histFilter = f;
  document.querySelectorAll('#histFilters .chip').forEach((x) => x.classList.remove('active'));
  if (el) el.classList.add('active');
  renderHistory();
}

function renderHistory() {
  const el = $('historyList');
  if (!el) return;
  const list = history.filter((h) => histFilter === 'all' || h.type === histFilter);
  el.innerHTML = list.length
    ? list.map(histHtml).join('')
    : emptyState('📋', 'કોઈ હિસ્ટરી નથી');
}

/* ===========================================================
   SETTINGS
   ========================================================= */
function saveShopName() {
  const n = ($('setShopName').value || '').trim();
  if (!n) { toast('દુકાનનું નામ લખો'); return; }
  shop.name = n;
  saveShop();
  const hn = $('shopName');
  if (hn) hn.textContent = n;
  toast('નામ સેવ થયું');
}

function backup() {
  const data = { settings: shop, items, sites, history };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ramdut-stock-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('💾 Backup થઈ ગયું');
}

function restore() { $('restoreFile').click(); }

function doRestore(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (d.settings) shop = d.settings;
      items = d.items || [];
      sites = d.sites || [];
      history = d.history || [];
      normalizeSites();
      items.forEach((i) => { if (i.damage == null) i.damage = 0; });
      saveItems(); saveSites(); saveHistory(); saveShop();
      const hn = $('shopName');
      if (hn) hn.textContent = shop.name;
      const sn = $('setShopName');
      if (sn) sn.value = shop.name;
      toast('📥 Restore સફળ');
      refresh();
    } catch (err) {
      toast('⚠️ અમાન્ય backup file');
    }
  };
  r.readAsText(file);
}

function resetData() {
  if (!confirm('બધો data delete થઈ જશે. ચાલુ રાખવું?')) return;
  for (const k of [ITEMS_KEY, SITES_KEY, HIST_KEY, SHOP_KEY]) localStorage.removeItem(k);
  items = []; sites = []; history = [];
  shop = { name: 'રામદૂત સ્ટોક મેનેજર' };
  dbPush(); // also clear the database
  toast('🗑️ Data delete થઈ ગયું');
  refresh();
}

/* ===========================================================
   INIT
   ========================================================= */
load();

/* Service worker (progressive enhancement, ignore if unsupported) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}