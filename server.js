// KK MUD graphical client - local proxy server (no dependencies).
//   node server.js [port]        then open http://localhost:8140/
// Bridges the browser to the text MUD over telnet (Big5 <-> UTF-8), serves the extracted game assets, and runs the
// per-account automation (see lib/session.js). Several accounts can be connected at once: one page per account (?s=<id>).
const http = require('http'), fs = require('fs'), path = require('path');
const { Session } = require('./lib/session');
const names = require('./lib/names');

const PORT = +process.argv[2] || 8140;
const DEFAULT_MUD = { host: process.env.MUD_HOST || 'kks.muds.idv.tw', port: +process.env.MUD_PORT || 4000 };
const PUBLIC = path.join(__dirname, 'public');
const ASSETS = path.resolve(process.env.KK_ASSETS || path.join(__dirname, '..', 'iKing_official', '_extracted'));
const DATA = path.resolve(process.env.KK_DATA || path.join(__dirname, 'data'));
const LOGS = path.resolve(process.env.KK_LOGS || path.join(__dirname, 'logs'));
const THREE_LOCAL = path.join(ASSETS, 'viewer', 'vendor', 'three');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
fs.mkdirSync(LOGS, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
names.load(DATA, LOGS);                                         // name -> id book (lib/names.js)

// ---------------------------------------------------------------- profiles (accounts + their automation), stored locally
const PROFILE_FILE = path.join(DATA, 'profiles.json');
const QUICK = 10;                                              // quick buttons per account
let profiles = {};
try { profiles = JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8')); } catch { /* first run */ }
if (!profiles.default) profiles.default = clean({ id: 'default', name: '預設' });
const saveProfiles = () => fs.writeFileSync(PROFILE_FILE, JSON.stringify(profiles, null, 2));

function str(v, max) { return String(v ?? '').replace(/[\r\n]/g, ' ').slice(0, max); }
function clean(p, old = {}) {
  const list = (a, f) => (Array.isArray(a) ? a : []).slice(0, 200).map(f);
  return {
    id: old.id || p.id,
    name: str(p.name, 30) || old.name || '未命名',
    host: str(p.host, 100) || DEFAULT_MUD.host,
    port: Math.min(65535, Math.max(1, +p.port || DEFAULT_MUD.port)),
    user: str(p.user, 40),
    password: p.password === undefined || p.password === null ? (old.password || '') : str(p.password, 100),   // undefined keeps the stored one
    autoLogin: !!p.autoLogin, autoReconnect: !!p.autoReconnect,
    aliases: list(p.aliases, a => ({ name: str(a.name, 30).trim(), commands: str(a.commands, 500) })).filter(a => a.name && !/\s/.test(a.name)),
    triggers: list(p.triggers, t => ({ enabled: !!t.enabled, pattern: str(t.pattern, 200), regex: !!t.regex, commands: str(t.commands, 500), cooldown: Math.max(0.2, +t.cooldown || 1) })).filter(t => t.pattern),
    timers: list(p.timers, t => ({ enabled: !!t.enabled, every: Math.max(5, +t.every || 60), commands: str(t.commands, 500) })).filter(t => t.commands),
    // ten quick buttons, always ten slots so their positions (and Alt+1..0) stay put
    quick: Array.from({ length: QUICK }, (_, i) => { const q = (Array.isArray(p.quick) ? p.quick : old.quick || [])[i] || {};
      return { label: str(q.label, 12).trim(), commands: str(q.commands, 500).trim() }; }),
  };
}
const publicProfile = p => ({ ...p, password: undefined, hasPassword: !!p.password });

const sessions = new Map();
function session(id) {
  if (!profiles[id]) return null;
  if (!sessions.has(id)) sessions.set(id, new Session(id, k => profiles[k], LOGS));
  return sessions.get(id);
}

// ---------------------------------------------------------------- asset manifest
function manifest() {
  const m = { monsters: {}, players: [], gobs: {}, bgm: [], assets: fs.existsSync(path.join(ASSETS, 'gltf')) };
  const ls = d => { try { return fs.readdirSync(path.join(ASSETS, d)); } catch { return []; } };
  for (const dir of ls('gltf/bin/monster')) {
    const files = ls('gltf/bin/monster/' + dir).filter(f => f.endsWith('.glb')).sort();
    const pick = files.find(f => f === `c${dir}.glb`) || files[0];
    if (pick) m.monsters[dir] = `gltf/bin/monster/${dir}/${pick}`;
  }
  m.players = ls('gltf/bin/player').filter(f => /_[mw]\.glb$/.test(f)).map(f => f.slice(0, -4)).sort();
  m.bgm = ls('audio/sound/bgm').filter(f => f.endsWith('.wav')).sort();
  // casting voices: sound/voice/<n>_<m|f>_<variant>.wav (which spell is which: SPELL_VOICE in public/config.js)
  m.voices = {};
  for (const f of ls('audio/sound/voice')) { const k = /^(\d+)_([mf]_\d+)\.wav$/.exec(f); if (k) (m.voices[k[1]] ||= []).push(k[2]); }
  try {
    const names = JSON.parse(fs.readFileSync(path.join(ASSETS, 'text/gobname.bin'), 'utf8').replace(/^﻿/, '').replace(/,(\s*[}\]])/g, '$1'));
    const rows = fs.readFileSync(path.join(ASSETS, 'sprites/index.csv'), 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1);
    const byRid = new Map();
    for (const r of rows) {
      const c = r.split(',');
      const k = /^RID(\d+)$/.exec(c[2] || '');
      if (k && /^GobBmp/.test(c[0]) && !byRid.has(k[1])) byRid.set(k[1], { f: `sprites/${c[0]}/${c[1]}`, w: +c[4], h: +c[5] });
    }
    for (const [id, name] of Object.entries(names)) {
      const s = byRid.get(id);
      if (!s || !name) continue;
      (m.gobs[name] ||= []).length < 16 && m.gobs[name].push(s);
    }
  } catch (e) { m.gobError = e.message; }
  return m;
}
let MANIFEST = null;

// ---------------------------------------------------------------- http
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.png': 'image/png', '.wav': 'audio/wav', '.csv': 'text/csv; charset=utf-8' };

function serveFile(res, root, rel, req, cache) {
  const file = path.join(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': cache ? 'max-age=86400' : 'no-cache' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}
function body(req, max = 262144) { return new Promise(ok => { let s = ''; req.on('data', d => { s += d; if (s.length > max) req.destroy(); }); req.on('end', () => ok(s)); }); }
const MAPS = path.join(DATA, 'maps');
fs.mkdirSync(MAPS, { recursive: true });
const mapFile = id => path.join(MAPS, `${id}.json`);          // ids are generated by this server, so they are safe file names
function json(res, obj, code = 200) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj)); }

http.createServer(async (req, res) => {
  let u;
  try { u = new URL(req.url, 'http://localhost'); u.path = decodeURIComponent(u.pathname); } catch { res.writeHead(400).end(); return; }
  const url = u.path;
  // local-only tool: refuse cross-site requests so no other web page can drive a MUD session or read the profiles
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) { res.writeHead(403).end(); return; }
  if (url.startsWith('/api/') && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) { res.writeHead(403).end(); return; }

  if (url.startsWith('/api/')) {
    const post = req.method === 'POST';
    let d = {};
    if (post) { try { d = JSON.parse(await body(req, url === '/api/map' ? 8 << 20 : 262144) || '{}'); } catch { res.writeHead(400).end(); return; } }
    const sid = str(u.searchParams.get('s') || d.s || 'default', 40);

    if (url === '/api/manifest') return json(res, MANIFEST ||= manifest());
    if (url === '/api/profiles') return json(res, Object.values(profiles).map(p => ({ ...publicProfile(p), status: sessions.get(p.id)?.status() || { connected: false } })));
    if (post && url === '/api/profile') {                      // create or update
      const old = profiles[d.id];
      const id = old ? d.id : 'a' + Date.now().toString(36);
      profiles[id] = clean({ ...d, id }, old || { id });
      saveProfiles(); sessions.get(id)?.reloadProfile();
      return json(res, publicProfile(profiles[id]));
    }
    if (post && url === '/api/profile/delete') {
      if (d.id === 'default' || !profiles[d.id]) return json(res, { ok: false }, 400);
      sessions.get(d.id)?.disconnect(); sessions.delete(d.id);
      delete profiles[d.id]; saveProfiles();
      fs.rm(mapFile(d.id), { force: true }, () => {});
      return json(res, { ok: true });
    }

    if (url === '/api/map') {                                  // the minimap, one file per account
      if (!profiles[sid]) return json(res, { error: 'unknown profile' }, 404);
      if (!post) { fs.readFile(mapFile(sid), 'utf8', (err, t) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(err ? '{}' : t); }); return; }
      if (d.map?.format !== 'kkmud-map') return json(res, { ok: false }, 400);
      const tmp = mapFile(sid) + '.tmp';                       // write-then-rename so a crash never leaves half a map
      fs.writeFile(tmp, JSON.stringify(d.map), err => err ? json(res, { ok: false }, 500) : fs.rename(tmp, mapFile(sid), e2 => json(res, { ok: !e2 })));
      return;
    }

    const s = session(sid);
    if (!s) return json(res, { error: 'unknown profile' }, 404);
    if (url === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
      res.write(':' + ' '.repeat(2048) + '\n\n');           // defeat proxy buffering
      for (const m of s.backlog) res.write('data: ' + JSON.stringify(m) + '\n\n');
      res.write('data: ' + JSON.stringify({ t: 'replayEnd' }) + '\n\n');      // everything after this is live
      res.write('data: ' + JSON.stringify(s.status()) + '\n\n');
      res.write('data: ' + JSON.stringify({ t: 'vars', vars: s.vars }) + '\n\n');
      s.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); s.clients.delete(res); });
      return;
    }
    if (url === '/api/status') return json(res, s.status());
    if (post && url === '/api/connect') { s.connect(true); return json(res, { ok: true }); }
    if (post && url === '/api/disconnect') { s.disconnect(); return json(res, { ok: true }); }
    if (post && url === '/api/send') return json(res, { ok: s.userSend(String(d.text ?? '').replace(/[\r\n]/g, '').slice(0, 2000)) });
    if (post && url === '/api/ids') {                          // the page's #0..#14 list, so triggers and quick buttons can use #n too
      const clean = o => Object.fromEntries(Object.entries(o || {}).filter(([k, v]) => /^\d{1,2}$/.test(k) && typeof v === 'string').map(([k, v]) => [k, str(v, 60)]));
      s.setIds(clean(d.ids), clean(d.names)); return json(res, { ok: true });
    }
    if (url === '/api/names') return json(res, Object.fromEntries(names.book));
    if (post && url === '/api/quick') {                        // run quick button n of this account, as stored (the page only says which)
      const q = profiles[sid]?.quick?.[d.n | 0];
      return json(res, { ok: !!q?.commands && s.userRun(q.commands) });
    }
    return json(res, { error: 'not found' }, 404);
  }
  const THREE_URL = '/assets/viewer/vendor/three/';
  if (url.startsWith(THREE_URL) && !fs.existsSync(path.join(THREE_LOCAL, 'build'))) {     // no local three.js: the same release from the CDN
    const rel = url.slice(THREE_URL.length);
    if (!/^[\w./-]+$/.test(rel) || rel.includes('..')) { res.writeHead(400).end(); return; }
    res.writeHead(302, { Location: THREE_CDN + rel }).end(); return;
  }
  if (url.startsWith('/assets/')) return serveFile(res, ASSETS, url.slice(8), req, true);
  return serveFile(res, PUBLIC, url === '/' ? 'index.html' : url.slice(1), req, false);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`KK MUD client: http://localhost:${PORT}/   (default MUD ${DEFAULT_MUD.host}:${DEFAULT_MUD.port})`);
  console.log(`assets: ${ASSETS}${fs.existsSync(path.join(ASSETS, 'gltf')) ? '' : '  (not found - using the built-in chess style; everything else works the same)'}`);
});
