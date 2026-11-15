// Minimap: drawing (shared by the corner map, the large map window and the image export), saving per account, export/import.
import { DIRS } from './config.js';
import { sid, q, get } from './api.js';

const $ = id => document.getElementById(id);
export const MAPCOL = { indoor: '#a07a52', city: '#8a8f99', road: '#b09a6a', forest: '#2f6f3a', grass: '#5f9f4f', cave: '#5b5068', water: '#3f78b0', beach: '#d6c48a',
  snow: '#cfd8e3', lava: '#c8552b', desert: '#c9ab6a', mount: '#96623f', swamp: '#40584a', plain: '#5f9f4f' };
export const TERRAIN_ZH = { indoor: '室內', city: '城鎮', road: '道路', forest: '森林', grass: '草地', cave: '洞穴', water: '水域', beach: '海邊',
  snow: '雪地', lava: '熔岩', desert: '荒漠', mount: '山地', swamp: '沼澤', plain: '平地' };

const parse = k => k.split(',').map(Number);

// draw one floor of one area. view = {cx, cy, S, W?, H?} : the map cell drawn at the centre, pixels per cell, drawing size
export function drawRooms(g, rooms, z, view, opt = {}) {
  const { cx, cy, S, W = g.canvas.width, H = g.canvas.height } = view;
  const px = (x, y) => [W / 2 + (x - cx) * S, H / 2 + (y - cy) * S];
  const box = Math.max(4, Math.round(S * (opt.names ? 0.34 : 0.56)));
  g.lineWidth = Math.max(1.5, S / 10); g.strokeStyle = '#59606d'; g.lineCap = 'round';
  for (const [k, r] of rooms) {
    const [x, y, rz] = parse(k); if (rz !== z) continue;
    const [X, Y] = px(x, y);
    for (const e of r.exits) {
      const d = DIRS[e]; if (!d || d.dz) continue;
      const to = r.links?.[e] && parse(r.links[e]);
      g.beginPath(); g.moveTo(X, Y);
      if (to && to[2] === z && (to[0] !== x + d.dx || to[1] !== y + d.dy)) { const [TX, TY] = px(to[0], to[1]); g.lineTo(TX, TY); }      // pushed apart: draw the whole road
      else g.lineTo(X + d.dx * S / 2, Y + d.dy * S / 2);
      g.stroke();
    }
  }
  for (const [k, r] of rooms) {
    const [x, y, rz] = parse(k); if (rz !== z) continue;
    const [X, Y] = px(x, y);
    if (X < -S || Y < -S || X > W + S || Y > H + S) continue;
    g.fillStyle = MAPCOL[r.terrain] || '#777'; g.fillRect(X - box / 2, Y - box / 2, box, box);
    const up = r.exits.includes('up'), down = r.exits.includes('down');
    if (up || down) {                                          // small arrows for stairs
      g.fillStyle = '#fff'; const a = Math.max(2, box / 4);
      if (up) { g.beginPath(); g.moveTo(X, Y - a); g.lineTo(X - a, Y); g.lineTo(X + a, Y); g.fill(); }
      if (down) { g.beginPath(); g.moveTo(X, Y + a); g.lineTo(X - a, Y); g.lineTo(X + a, Y); g.fill(); }
    }
    if (opt.here && x === opt.here.x && y === opt.here.y) { g.lineWidth = 2; g.strokeStyle = '#ffb53c'; g.strokeRect(X - box / 2 - 3, Y - box / 2 - 3, box + 6, box + 6); g.strokeStyle = '#59606d'; g.lineWidth = Math.max(1.5, S / 10); }
    if (opt.names) {
      g.fillStyle = '#d9dde4'; g.font = `${Math.max(9, Math.min(13, S / 4.4))}px "Microsoft JhengHei", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(r.name.length > 7 ? r.name.slice(0, 6) + '…' : r.name, X, Y + box / 2 + 2, S * 0.98);
    }
  }
}

// bounds of one floor, in cells
function bounds(rooms, z) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of rooms.keys()) { const [x, y, rz] = parse(k); if (rz !== z) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
const floors = rooms => [...new Set([...rooms.keys()].map(k => parse(k)[2]))].sort((a, b) => b - a);
const areaName = (map, i) => map.names[i] || mostCommon(map.sheets[i]) || `區域 ${i + 1}`;
function mostCommon(rooms) {
  const c = new Map(); for (const r of rooms.values()) c.set(r.name, (c.get(r.name) || 0) + 1);
  let best = '', n = 0; for (const [k, v] of c) if (v > n) { best = k; n = v; }
  return best && `${best}一帶`;
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const safeName = s => s.replace(/[\\/:*?"<>|\s]+/g, '_');

// ------------------------------------------------------------------ the module
export function initMap(map, getRoom) {
  // ---- saving: one file per account on the local server
  let saveTimer = 0, dirty = false;
  const save = () => {
    clearTimeout(saveTimer); dirty = false;
    if (demo) return Promise.resolve();
    return fetch('/api/map' + q, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s: sid, map: map.toJSON() }) })
      .then(r => { $('mapInfo').title = r.ok ? `已存檔 ${new Date().toLocaleTimeString()}` : '存檔失敗'; })
      .catch(() => { $('mapInfo').title = '存檔失敗'; dirty = true; });
  };
  // Whenever the page (re)connects, the server replays its recent output. Moves in that replay are already in the map,
  // so the replay may scribble on it freely: when it ends, the map is put back (from the saved file on first load, from a
  // snapshot on a reconnect) and only the cursor is moved to the room the replay ended in. Nothing is saved meanwhile.
  let replaying = true, first = true, snapshot = null, demo = false;
  const changed = () => { if (replaying || demo) return redraw(); dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500); redraw(); };
  map.onChange = changed;
  addEventListener('pagehide', () => { if (dirty && !replaying) navigator.sendBeacon('/api/map' + q, new Blob([JSON.stringify({ s: sid, map: map.toJSON() })], { type: 'application/json' })); });
  const ready = get('/api/map' + q).then(j => j?.format === 'kkmud-map' && j.sheets?.some(s => s.rooms?.length) ? j : null).catch(() => null);
  function replayStart() { replaying = true; if (!first) snapshot = map.toJSON(); }
  async function replayEnd() {
    const target = first ? await ready : snapshot;
    first = false; snapshot = null;
    if (target) { try { map.load(target); } catch { /* unreadable file: keep what the replay built */ } }
    replaying = false;
    const r = getRoom(); if (r && target) map.locate(r);
    if (!target && map.size) changed();                        // first run ever: keep and save what the replay built
    redraw();
  }

  // ---- corner map
  function redraw() {
    const c = $('map'), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    drawRooms(g, map.rooms, map.z, { cx: map.x, cy: map.y, S: 18 }, { here: map });
    $('mapInfo').textContent = `${map.rooms.size} 個房間${map.z ? ` · 樓層 ${map.z > 0 ? '+' : ''}${map.z}` : ''}${map.sheets.length > 1 ? ` · ${areaName(map, map.s)}` : ''}`;
    if ($('mapDlg').open) big.draw();
  }

  // ---- large map window
  const big = {
    sheet: 0, z: 0, cx: 0, cy: 0, S: 34, names: true,
    open() {
      this.sheet = map.s; this.z = map.z; this.cx = map.x; this.cy = map.y;
      $('mapDlg').showModal(); this.fill(); this.resize(); this.fit();
      // a large area fitted to the window gets tiny: then zoom in on where you are instead
      if (this.S < 24 && this.sheet === map.s) { this.S = 34; this.cx = map.x; this.cy = map.y; this.draw(); }
    },
    fill() {
      const sel = $('mapSheet'); sel.textContent = '';
      map.sheets.forEach((sh, i) => { if (sh.size || i === map.s) sel.add(new Option(`${areaName(map, i)}（${sh.size}）${i === map.s ? ' ← 目前' : ''}`, i)); });
      sel.value = this.sheet;
      const fl = $('mapFloor'); fl.textContent = '';
      for (const z of floors(map.sheets[this.sheet]).concat(map.sheets[this.sheet].size ? [] : [0])) fl.add(new Option(z === 0 ? '地面' : z > 0 ? `樓上 +${z}` : `地下 ${z}`, z));
      if (![...fl.options].some(o => +o.value === this.z)) this.z = +fl.options[0]?.value || 0;
      fl.value = this.z;
      $('mapAreaName').value = map.names[this.sheet] || '';
      $('mapAreaName').placeholder = mostCommon(map.sheets[this.sheet]) || '未命名';
      $('mapStats').textContent = `共 ${map.size} 個房間，${map.sheets.filter(s => s.size).length} 個區域`;
    },
    resize() { const c = $('mapBig'), r = c.getBoundingClientRect(); c.width = Math.round(r.width); c.height = Math.round(r.height); this.draw(); },
    fit() {
      const b = bounds(map.sheets[this.sheet], this.z); if (!b) return;
      const c = $('mapBig');
      this.cx = (b.x0 + b.x1) / 2; this.cy = (b.y0 + b.y1) / 2;
      this.S = Math.max(6, Math.min(80, Math.min(c.width / (b.x1 - b.x0 + 2), c.height / (b.y1 - b.y0 + 2))));
      this.draw();
    },
    draw() {
      const c = $('mapBig'), g = c.getContext('2d');
      g.fillStyle = '#0e1013'; g.fillRect(0, 0, c.width, c.height);
      const here = this.sheet === map.s && this.z === map.z ? map : null;
      drawRooms(g, map.sheets[this.sheet], this.z, this, { names: this.names && this.S >= 26, here });
    },
    cellAt(e) {
      const c = $('mapBig'), r = c.getBoundingClientRect();
      return [Math.round(this.cx + (e.clientX - r.left - c.width / 2) / this.S), Math.round(this.cy + (e.clientY - r.top - c.height / 2) / this.S)];
    },
  };

  // ---- export / import
  function exportPng() {
    const rooms = map.sheets[big.sheet], b = bounds(rooms, big.z);
    if (!b) return;
    let S = 64; const wCells = b.x1 - b.x0 + 2, hCells = b.y1 - b.y0 + 2;
    S = Math.max(16, Math.min(S, Math.floor(8000 / Math.max(wCells, hCells))));             // keep the image a sane size
    const c = document.createElement('canvas'); c.width = Math.max(520, wCells * S); c.height = hCells * S + 64;     // wide enough for the title
    const g = c.getContext('2d');
    g.fillStyle = '#0e1013'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#ffe2a3'; g.font = '20px "Microsoft JhengHei", sans-serif'; g.textBaseline = 'top'; g.textAlign = 'left';
    const floorTxt = big.z === 0 ? '' : big.z > 0 ? ` 樓上 +${big.z}` : ` 地下 ${big.z}`;
    g.fillText(`${areaName(map, big.sheet)}${floorTxt}`, 14, 12);
    g.fillStyle = '#8791a0'; g.font = '13px "Microsoft JhengHei", sans-serif';
    g.fillText(`萬王之王 MUD · ${[...rooms.keys()].filter(k => parse(k)[2] === big.z).length} 個房間 · ${new Date().toLocaleString()}`, 14, 38);
    g.save(); g.translate(0, 64);
    drawRooms(g, rooms, big.z, { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, S, W: c.width, H: c.height - 64 }, { names: S >= 26 });
    g.restore();
    c.toBlob(blob => download(`kk-map-${safeName(areaName(map, big.sheet))}${floorTxt ? '-' + big.z : ''}-${stamp()}.png`, blob), 'image/png');
  }
  function exportJson() {
    const who = ($('profile')?.selectedOptions[0]?.textContent || sid).replace(/^●\s*/, '');
    download(`kk-map-${safeName(who)}-${stamp()}.json`, new Blob([JSON.stringify(map.toJSON(), null, 1)], { type: 'application/json' }));
  }
  async function importJson(file) {
    let j;
    try { j = JSON.parse(await file.text()); const test = new map.constructor(); test.load(j); } catch (e) { alert('無法匯入：' + e.message); return; }
    const n = j.sheets.reduce((a, s) => a + (s.rooms?.length || 0), 0);
    if (!confirm(`匯入「${file.name}」（${n} 個房間）會取代目前的小地圖（${map.size} 個房間）。確定嗎？\n建議先匯出目前的地圖備份。`)) return;
    map.load(j); const r = getRoom(); if (r) map.locate(r);
    await save(); big.sheet = map.s; big.z = map.z; big.cx = map.x; big.cy = map.y; big.fill(); redraw();
  }

  // ---- wiring
  $('map').onclick = () => big.open();
  $('map').title = '點一下開啟大地圖';
  $('mapClose').onclick = () => $('mapDlg').close();
  $('mapSheet').onchange = () => { big.sheet = +$('mapSheet').value; big.z = 0; big.fill(); big.fit(); };
  $('mapFloor').onchange = () => { big.z = +$('mapFloor').value; big.fit(); };
  $('mapAreaName').onchange = () => { map.names[big.sheet] = $('mapAreaName').value.trim().slice(0, 30); big.fill(); changed(); };
  $('mapNames').onchange = () => { big.names = $('mapNames').checked; big.draw(); };
  $('mapFit').onclick = () => big.fit();
  $('mapHere').onclick = () => { big.sheet = map.s; big.z = map.z; big.cx = map.x; big.cy = map.y; big.S = Math.max(big.S, 30); big.fill(); big.draw(); };
  $('mapPng').onclick = exportPng;
  $('mapJson').onclick = exportJson;
  $('mapImport').onclick = () => $('mapFile').click();
  $('mapFile').onchange = () => { const f = $('mapFile').files[0]; $('mapFile').value = ''; if (f) importJson(f); };
  $('mapClear').onclick = async () => {
    if (!confirm(`清除這個帳號的整張小地圖（${map.size} 個房間）？這個動作無法復原，建議先匯出 JSON 備份。`)) return;
    map.clear(); const r = getRoom(); if (r) map.locate(r);
    await save(); big.sheet = 0; big.z = 0; big.cx = map.x; big.cy = map.y; big.fill(); redraw();
  };
  $('mapAreaDel').onclick = async () => {
    const sh = map.sheets[big.sheet];
    if (!sh.size || !confirm(`刪除區域「${areaName(map, big.sheet)}」（${sh.size} 個房間）？無法復原。`)) return;
    sh.clear(); map.names[big.sheet] = '';
    if (big.sheet === map.s) { const r = getRoom(); if (r) map.locate(r); }
    await save(); big.sheet = map.s; big.z = map.z; big.fill(); big.fit(); redraw();
  };

  // pan, zoom, hover
  const cv = $('mapBig'); let drag = null;
  cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, cx: big.cx, cy: big.cy }; cv.setPointerCapture(e.pointerId); };
  cv.onpointerup = () => { drag = null; };
  cv.onpointermove = e => {
    if (drag) { big.cx = drag.cx - (e.clientX - drag.x) / big.S; big.cy = drag.cy - (e.clientY - drag.y) / big.S; big.draw(); return; }
    const [x, y] = big.cellAt(e), r = map.sheets[big.sheet].get(`${x},${y},${big.z}`);
    $('mapHover').textContent = r ? `${r.name}　${TERRAIN_ZH[r.terrain] || r.terrain}　出口：${r.exits.join('、') || '無'}` : '';
  };
  cv.onwheel = e => {
    e.preventDefault();
    const c = cv.getBoundingClientRect(), mx = e.clientX - c.left - cv.width / 2, my = e.clientY - c.top - cv.height / 2;
    const wx = big.cx + mx / big.S, wy = big.cy + my / big.S;
    big.S = Math.max(4, Math.min(90, big.S * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    big.cx = wx - mx / big.S; big.cy = wy - my / big.S; big.draw();
  };
  new ResizeObserver(() => { if ($('mapDlg').open) big.resize(); }).observe(cv);

  // demo text must not end up in the account's saved map
  function demoMode() { if (demo) return false; demo = true; clearTimeout(saveTimer); dirty = false; return true; }

  return { redraw, replayStart, replayEnd, save, demoMode };
}
