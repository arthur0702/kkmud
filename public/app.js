// Terminal, network, text parsing and minimap. The 3D room lives in scene.js; recognition rules in config.js.
import { RoomScene } from './scene.js';
import { sid, q, post } from './api.js';
import { initSettings } from './settings.js';
import { initMap } from './mapview.js';
import { MudParser, hash, shopLine, dirOf, isItem } from './parser.js';
import { PARSER, DIRS, DEFAULT_TERRAIN, MONSTERS, PEOPLE, PEOPLE_DEFAULT, FEMALE, ITEMS, ACTIONS, CORPSE, CORPSE_MODEL, ROOM_WORD, ROOM_VERBS, SHOP, INVENTORY, BOARD, DEMO, DEMO_CMD } from './config.js';

const $ = id => document.getElementById(id);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('kk.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('kk.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

let manifest = { monsters: {}, players: [], gobs: {}, bgm: [] };
let connected = false, echoOff = false;
const scene = new RoomScene($('gl'), $('overlay'), { exit: dir => command(dir), thing: (t, el) => menu(t, el) });

// ------------------------------------------------------------------ click menu on a name tag
const pop = $('menu');
function menu(t, el) {
  pop.textContent = '';
  if (isBoard(t)) {                                      // a message board opens its panel
    const b = document.createElement('button'); b.textContent = '看留言'; b.title = `送出 ${BOARD.list.replace('{id}', t.id || 'board')}`;
    b.onclick = e => { e.stopPropagation(); pop.hidden = true; openBoard(t); };
    pop.append(b);
  }
  for (const [label, tpl] of ACTIONS[t.kind] || ACTIONS.item) {
    if (!t.id && tpl.includes('{id}')) continue;
    const b = document.createElement('button'); b.textContent = label; b.title = tpl.replace('{id}', t.id);
    b.onclick = e => { e.stopPropagation(); pop.hidden = true; command(tpl.replace('{id}', t.id)); input.focus(); };
    pop.append(b);
  }
  if (!pop.children.length) {                            // arrived after the last look, so its id is not known yet
    const b = document.createElement('button'); b.textContent = '查看四周（取得名稱後才能操作）'; b.title = '送出 look';
    b.onclick = e => { e.stopPropagation(); pop.hidden = true; command('look'); input.focus(); };
    pop.append(b);
  }
  const r = el.getBoundingClientRect(), v = $('view').getBoundingClientRect();
  pop.hidden = false;
  pop.style.left = Math.max(4, Math.min(v.width - pop.offsetWidth - 4, r.left - v.left)) + 'px';
  pop.style.top = Math.min(v.height - pop.offsetHeight - 4, r.bottom - v.top + 3) + 'px';
}
addEventListener('click', () => { pop.hidden = true; });
addEventListener('keydown', e => { if (e.key === 'Escape') pop.hidden = true; });

// ------------------------------------------------------------------ terminal (ANSI -> HTML)
const term = $('term');
const PALETTE = ['#1c1f25', '#d0554f', '#5fb866', '#c9a23f', '#5c8fd6', '#b56bc9', '#4fb3bf', '#c8ccd4'];
const BRIGHT = ['#6b7280', '#ff7a72', '#8be28f', '#ffd75e', '#8ab8ff', '#e39bf5', '#7fe3ee', '#ffffff'];
let sgr = { fg: -1, bg: -1, bold: false }, carry = '', line = null, lines = 0;

function newLine() { line = document.createElement('div'); line.className = 'ln'; term.append(line); if (++lines > 3000) { term.firstChild.remove(); lines--; } }
function span(text) {
  if (!text) return;
  if (!line) newLine();
  const s = document.createElement('span');
  if (sgr.fg >= 0) s.style.color = (sgr.bold ? BRIGHT : PALETTE)[sgr.fg]; else if (sgr.bold) s.style.color = '#fff';
  if (sgr.bg >= 0) s.style.background = PALETTE[sgr.bg];
  s.textContent = text; line.append(s);
}
function applySgr(params) {
  for (const p of (params || '0').split(';').map(Number)) {
    if (p === 0) sgr = { fg: -1, bg: -1, bold: false };
    else if (p === 1) sgr.bold = true; else if (p === 2 || p === 22) sgr.bold = false;
    else if (p >= 30 && p <= 37) sgr.fg = p - 30; else if (p === 39) sgr.fg = -1;
    else if (p >= 40 && p <= 47) sgr.bg = p - 40; else if (p === 49) sgr.bg = -1;
    else if (p >= 90 && p <= 97) { sgr.fg = p - 90; sgr.bold = true; }
  }
}
function write(text) {
  const stick = term.scrollTop + term.clientHeight >= term.scrollHeight - 30;
  text = carry + text; carry = '';
  const cut = text.match(/\x1b(?:\[[\d;?]*)?$/);                    // escape sequence split across chunks
  if (cut) { carry = cut[0]; text = text.slice(0, cut.index); }
  let plain = '';
  for (const part of text.split(/(\x1b\[[\d;?]*[A-Za-z])/)) {
    if (part.startsWith('\x1b[')) { if (part.endsWith('m')) applySgr(part.slice(2, -1)); continue; }
    const segs = part.replace(/\x1b/g, '').split('\n');
    segs.forEach((seg, i) => { if (i) newLine(); span(seg); });
    plain += part.replace(/\x1b/g, '');
  }
  if (stick) term.scrollTop = term.scrollHeight;
  return plain;
}
function sys(msg) { if (line && line.textContent) newLine(); const keep = sgr; sgr = { fg: 3, bg: -1, bold: false }; span('※ ' + msg); sgr = keep; newLine(); term.scrollTop = term.scrollHeight; }

// ------------------------------------------------------------------ parsing (parser.js) -> scene / HUD / minimap
let room = null, thingTimer = 0;
const parser = new MudParser({
  room(r, moved) {
    room = r;
    r.decor = decorFor(r.name + r.desc, r.terrain, r.name + r.exits.join());
    scene.setRoom(r, moved);
    if (moved || r.name !== $('roomName').textContent) { $('shop').hidden = true; $('board').hidden = true; }     // left the shop / the board
    boardButton();
    $('roomName').textContent = r.name; $('roomDesc').textContent = r.desc;
    roomWords(r.desc);
    music(r.terrain.key); drawMap();
  },
  things() { clearTimeout(thingTimer); thingTimer = setTimeout(() => room && scene.setThings(room.things), 120); boardButton(); },
  status(key, cur, max) {
    const bar = $(key); bar.hidden = false; bar.firstElementChild.style.width = Math.max(0, Math.min(100, cur / Math.max(1, max) * 100)) + '%';
    bar.lastElementChild.textContent = `${key === 'hp' ? '體力' : '法力'} ${cur}/${max}`;
  },
  combat(ev) {
    const hit = scene.act(ev);
    if (ev.type !== 'die' || !room) return;
    // let the death animation play, then leave a corpse where the creature stood
    const i = hit ? room.things.indexOf(hit.t) : room.things.findIndex(t => t.name === ev.who && t.kind !== 'corpse' && t.kind !== 'item');
    if (i < 0) return;
    const here = room;
    setTimeout(() => {
      if (room !== here || !here.things[i]) return;
      here.things[i] = { name: ev.who + '的屍體', id: 'corpse', kind: 'corpse', url: CORPSE_MODEL, uid: ++uid, inherit: here.things[i].uid };
      scene.setThings(here.things);
    }, hit?.actor ? 1500 : 0);
  },
  picked(text, cmd) {
    if (!room) return;
    const items = room.things.filter(t => t.kind === 'item');
    const arg = (/^(?:get|take)\s+(.+)$/i.exec(cmd) || [])[1]?.toLowerCase();
    let gone = [];
    if (arg && /from/.test(arg)) return;                               // taken out of a container: the floor is unchanged
    if (arg === 'all') gone = items.filter(t => text.includes(t.name) || t.name.includes(text)).slice(0, 1);
    else if (arg) gone = items.filter(t => t.id === arg).slice(0, 1);
    if (!gone.length) gone = items.filter(t => text.includes(t.name) || t.name.includes(text)).slice(0, 1);   // "一柄短劍" contains "短劍"
    if (!gone.length) return;
    room.things = room.things.filter(t => !gone.includes(t));
    scene.setThings(room.things);
  },
  listing(cmd, lines, more) { showShop(lines.map(shopLine).filter(Boolean), more); },
  inventory(items, load) { showInv(items, load); },
  board(posts, desc, more) { showBoard(posts, desc, more); },
  post(p, more, waiting) { showPost(p, more, waiting); },
  thing: l => { const t = parseThing(l); if (t) t.uid = ++uid; return t; },
  newcomer: name => { const t = classify(name, ''); if (t) t.uid = ++uid; return t; },      // walked in: the id is unknown until the next look
});
let uid = 0, replaying = false;
const feed = plain => parser.feed(plain);

function parseThing(l) {
  const m = PARSER.thing.exec(l);
  if (!m) return null;                                   // KK always prints "名字(Id)"; anything else ends the list
  const t = classify(m[1].trim(), m[2].trim().toLowerCase());
  const c = /\[\s*(\d+)\s*張留言\s*[﹐,，]\s*(\d+)\s*張未讀/.exec(l);      // "留言板(Board) [ 35 張留言﹐8 張未讀 ]"
  if (t && c) { t.total = +c[1]; t.unread = +c[2]; }
  return t;
}

// ids of things seen in the backpack or a shop list are objects for sure (kept in this browser)
const knownItems = new Set(store.get('knownItems', []));
function learnItems(ids) {
  const before = knownItems.size;
  for (const i of ids) if (i) knownItems.add(i.toLowerCase());
  if (knownItems.size === before) return;
  store.set('knownItems', [...knownItems].slice(-2000));
  if (room?.things.some(t => t.kind !== 'item' && t.kind !== 'corpse' && knownItems.has(t.id))) {      // fix what is on screen now
    room.things = room.things.map(t => t.kind !== 'item' && t.kind !== 'corpse' && knownItems.has(t.id) ? { ...classify(t.name, t.id), uid: ++uid } : t);
    scene.setThings(room.things);
  }
}

// name (+ id when known) -> what it is and which model stands in for it
function classify(name, id) {
  if (!name) return null;
  if (CORPSE.test(name)) return { name, id, kind: 'corpse', url: CORPSE_MODEL };
  if (isItem(name, id, knownItems)) return { name, id, kind: 'item', url: ITEMS[ITEMS.length - 1][1] };
  for (const [re, folder] of MONSTERS) if (re.test(name) && manifest.monsters[folder]) return { name, id, kind: 'monster', url: manifest.monsters[folder] };
  const sex = FEMALE.test(name) ? 'w' : 'm';
  let cls = (PEOPLE.find(([re]) => re.test(name)) || [])[1] || PEOPLE_DEFAULT[hash(name) % PEOPLE_DEFAULT.length];
  if (!manifest.players.includes(`${cls}_${sex}`)) cls = 'warrior';
  return { name, id, kind: 'person', url: `gltf/bin/player/${cls}_${sex}.glb` };
}

// goods panel built from the reply to "list"
function showShop(all, more) {
  learnItems(all.map(g => g.id));
  const box = $('shop'), rows = $('shopRows');
  rows.textContent = '';
  if (!all.length) { box.hidden = true; return; }
  // the shop prints one line per piece in stock: fold identical lines into "×N"
  const goods = [];
  for (const g of all) {
    const same = goods.find(x => x.name === g.name && x.id === g.id && x.price === g.price);
    if (same) same.count++; else goods.push({ ...g, count: 1 });
  }
  $('shopMore').hidden = more == null;
  $('shopMore').textContent = more == null ? '' : `下一頁（已顯示 ${more}%）`;
  for (const g of goods) {
    const cmd = g.id ? SHOP.buy.replace('{id}', g.id) : SHOP.buyByIndex.replace('{n}', g.index);
    const row = document.createElement('div'); row.className = 'row';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = g.name + (g.count > 1 ? ` ×${g.count}` : ''); nm.title = g.id || `#${g.index}`;
    const pr = document.createElement('span'); pr.className = 'pr'; pr.textContent = g.price != null ? g.price.toLocaleString() : '';
    const buy = document.createElement('button'); buy.textContent = '購買'; buy.title = `送出 ${cmd}`;
    buy.onclick = () => { command(cmd); input.focus(); };
    row.append(nm, pr, buy);
    if (g.id) { const lk = document.createElement('button'); lk.className = 'ghost'; lk.textContent = '查看'; lk.title = `送出 ${SHOP.look.replace('{id}', g.id)}`;
      lk.onclick = () => { command(SHOP.look.replace('{id}', g.id)); input.focus(); }; row.append(lk); }
    rows.append(row);
  }
  $('shopTitle').textContent = `商品清單（${goods.length} 種${more == null ? '' : '，未完'}）`;
  if (!replaying) box.hidden = false;
}
$('shopClose').onclick = () => { $('shop').hidden = true; };

// backpack built from the reply to "i": in-use items first, each with the actions that fit it
function showInv(items, load) {
  learnItems(items.map(i => i.id));
  const rows = $('invRows'); rows.textContent = '';
  $('invLoad').textContent = load ? `負重 ${load[0]}/${load[1]}` : '';
  $('invTitle').textContent = `背包（${items.length} 件）`;
  const act = (label, tpl, it, ghost) => {
    const cmd = tpl.replace('{id}', it.ref), b = document.createElement('button');
    b.textContent = label; b.title = `送出 ${cmd}`; if (ghost) b.className = 'ghost';
    // change something, then read the backpack again so the marks are up to date
    b.onclick = async () => { await command(cmd); if (tpl !== INVENTORY.look) command(INVENTORY.list); input.focus(); };
    return b;
  };
  const used = items.filter(i => i.used), carried = items.filter(i => !i.used);
  for (const [title, list] of [['使用中', used], ['攜帶', carried]]) {
    if (!list.length) continue;
    const h = document.createElement('div'); h.className = 'sect'; h.textContent = `${title}（${list.length}）`; rows.append(h);
    for (const it of list) {
      const weapon = INVENTORY.weapon.test(it.name) || INVENTORY.weaponId.test(it.id);
      const row = document.createElement('div'); row.className = 'row' + (it.used ? ' used' : '');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = it.name; nm.title = `${it.name}(${it.ref})`;
      row.append(nm);
      if (it.used) row.append(weapon ? act('卸下', INVENTORY.unwield, it) : act('脫下', INVENTORY.remove, it), weapon ? act('脫下', INVENTORY.remove, it, true) : act('卸下', INVENTORY.unwield, it, true));
      else row.append(weapon ? act('拿武器', INVENTORY.wield, it) : act('穿上', INVENTORY.wear, it), weapon ? act('穿上', INVENTORY.wear, it, true) : act('拿武器', INVENTORY.wield, it, true));
      row.append(act('查看', INVENTORY.look, it, true));
      rows.append(row);
    }
  }
  if (!items.length) { const h = document.createElement('div'); h.className = 'sect'; h.textContent = '身上沒有東西。'; rows.append(h); }
  if (!replaying) $('inv').hidden = false;
}
const openInv = () => { command(INVENTORY.list); input.focus(); };
$('invBtn').onclick = openInv;
$('invRefresh').onclick = openInv;
$('invClose').onclick = () => { $('inv').hidden = true; };
$('shopMore').onclick = () => { command(''); input.focus(); };          // Enter answers the pager

// ------------------------------------------------------------------ message board: list from "look board", posts from "read n"
const isBoard = t => t.id === 'board' || BOARD.thing.test(t.name);
let boardThing = null, boardPosts = [], boardAuto = 0;    // boardAuto: pager pages the panel may still turn by itself
const boardRead = new Map();                              // board name -> post numbers read in this page
const readSet = () => { const k = boardThing?.name || ''; if (!boardRead.has(k)) boardRead.set(k, new Set()); return boardRead.get(k); };
function boardButton() {
  const t = room?.things.find(isBoard), b = $('boardBtn');
  b.hidden = !t; if (!t) return;
  b.textContent = t.unread ? `留言板（${t.unread} 未讀）` : '留言板';
  b.title = `${t.name}${t.total != null ? `：${t.total} 張留言，${t.unread} 張未讀` : ''}（送出 ${BOARD.list.replace('{id}', t.id || 'board')}）`;
}
function openBoard(t = room?.things.find(isBoard)) {
  if (t) boardThing = t;
  boardAuto = BOARD.autoPages; $('shop').hidden = true;
  command(BOARD.list.replace('{id}', boardThing?.id || 'board')); input.focus();
}
// answer a waiting pager first, so the next command is not swallowed by it
async function boardCmd(cmd) { boardAuto = BOARD.autoPages; if (parser.paging) await command('q'); await command(cmd); }
const readPost = n => boardCmd(BOARD.read.replace('{n}', n));

function showBoard(posts, desc, more) {
  boardPosts = posts;
  if (!boardThing || !room?.things.includes(boardThing)) boardThing = room?.things.find(isBoard) || boardThing;      // typed "look board" by hand
  const rows = $('boardRows'); rows.textContent = '';
  $('boardTitle').textContent = boardThing?.name || desc || '留言板';
  $('boardInfo').textContent = `${posts.length} 篇${more != null ? `（載入中 ${more}%）` : ''}`;
  const seen = readSet();
  for (const p of [...posts].reverse()) {                // newest first
    const row = document.createElement('div'); row.className = 'row' + (seen.has(p.n) ? ' read' : '') + (/^Re\s*:/i.test(p.title) ? ' re' : '');
    row.title = `送出 ${BOARD.read.replace('{n}', p.n)}`;
    const no = document.createElement('span'); no.className = 'no'; no.textContent = p.n;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.title;
    const by = document.createElement('span'); by.className = 'by'; by.textContent = `${p.author} ${p.date.replace(/\s+\d{4}$/, '').replace(/^(\d+\/\d+)\s+\d+:\d+$/, '$1')}`; by.title = `${p.author}(${p.id}) ${p.date}`;
    row.append(no, nm, by); row.onclick = () => readPost(p.n);
    rows.append(row);
  }
  if (!posts.length) { const h = document.createElement('div'); h.className = 'row'; h.textContent = '這個留言板沒有留言。'; rows.append(h); }
  if (more != null && boardAuto > 0 && !replaying) { boardAuto--; command(''); }
  if (replaying) return;
  $('boardPost').hidden = true; rows.hidden = false; $('board').hidden = false;
}

function showPost(p, more, waiting) {
  readSet().add(p.n);
  $('postTitle').textContent = `[${p.n}] ${p.title}`;
  $('postBy').textContent = `${p.author}(${p.id})　${p.date}`;
  const body = $('postBody'); body.textContent = '';
  for (const l of p.lines) { const d = document.createElement('div'); d.textContent = l || ' '; if (/^\s*>/.test(l)) d.className = 'q'; body.append(d); }
  const at = boardPosts.findIndex(x => x.n === p.n);
  $('postPrev').disabled = at === 0 || p.n <= 1; $('postNext').disabled = at >= 0 && at === boardPosts.length - 1;
  $('postPrev').onclick = () => readPost(at > 0 ? boardPosts[at - 1].n : p.n - 1);
  $('postNext').onclick = () => readPost(at >= 0 ? boardPosts[at + 1].n : p.n + 1);
  const mb = $('postMore');
  if (more != null || waiting) {                          // the server's pager waits: turn it by itself if the panel asked for this post
    if (boardAuto > 0 && !replaying) { boardAuto--; mb.hidden = true; command(''); }
    else { mb.hidden = false; mb.textContent = more != null ? `下一頁（${more}%）` : '繼續'; }
  } else mb.hidden = true;
  if (replaying) return;
  if (more == null) boardAuto = 0;
  $('boardRows').hidden = true; $('boardPost').hidden = false; $('board').hidden = false;
}
$('postMore').onclick = () => { $('postMore').hidden = true; command(''); };
$('postBack').onclick = () => { showBoard(boardPosts, '', null); };
$('boardBtn').onclick = () => openBoard();
$('boardRefresh').onclick = () => boardCmd(BOARD.list.replace('{id}', boardThing?.id || 'board'));
$('boardNew').onclick = () => boardCmd(BOARD.next);
$('boardClose').onclick = async () => { $('board').hidden = true; if (parser.paging) await command('q'); input.focus(); };

// buttons for the 中文(english) words a room description offers
function roomWords(desc) {
  const box = $('roomCmds'); box.textContent = '';
  const seen = new Set();
  // "存(deposit)" style words, plus a known verb written bare in the text ("可以用 list 看看有什麼貨色")
  const bare = [...desc.matchAll(/(?<=[^\x00-\x7f]\s*)([a-z]{3,12})(?=\s*[^\x00-\x7f])/g)].filter(m => ROOM_VERBS[m[1]]);
  const found = [...desc.matchAll(ROOM_WORD), ...bare].sort((a, b) => a.index - b.index);
  for (const m of found) {
    const word = m[1].trim();
    if (seen.has(word)) continue; seen.add(word);
    const verb = ROOM_VERBS[word];
    const b = document.createElement('button');
    b.className = verb ? 'verb' : 'noun';
    if (verb) {
      b.textContent = `${verb[0]} ${word}`;
      b.title = verb[1] ? `把 ${word} 填入指令列，補上內容後按 Enter` : `送出 ${word}`;
      b.onclick = () => { if (verb[1]) { input.value = word + ' '; input.focus(); } else { command(word); input.focus(); } };
    } else {
      b.textContent = `查看 ${word}`; b.title = `送出 look ${word}`;
      b.onclick = () => { command('look ' + word); input.focus(); };
    }
    box.append(b);
    if (seen.size >= 10) break;
  }
}

function decorFor(text, terrain, seed) {
  const out = [], names = Object.keys(manifest.gobs);
  const add = (name, n) => { const list = manifest.gobs[name] || manifest.gobs[names.find(k => k.includes(name))]; if (!list) return;
    for (let i = 0; i < n; i++) out.push(list[hash(seed + name + i) % list.length]); };
  for (const d of terrain.decor) add(d, 1);
  for (const name of names) if (name.length >= 2 && text.includes(name)) add(name, 1);      // scenery the description actually mentions
  for (const ch of ['樹', '花', '井', '桌', '椅', '床', '碑']) if (text.includes(ch) && !terrain.decor.includes(ch)) add(ch, 2);
  return out.slice(0, 14);
}

// ------------------------------------------------------------------ minimap (mapview.js): saved per account, large view, export
const mapUI = initMap(parser.map, () => room);
const drawMap = () => mapUI.redraw();

// ------------------------------------------------------------------ commands / network
const input = $('cmd'), history = []; let hi = 0;
function command(text) {
  if (!connected) { sys('尚未連線'); return Promise.resolve(); }
  return post('/api/send', { text }).catch(() => sys('送出失敗'));
}
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = input.value; input.value = '';
    if (v && !echoOff && history[history.length - 1] !== v) history.push(v);
    hi = history.length; command(v);
    return;
  }
  // history: ↑/↓ while the box has text (so a recalled command can be browsed on), or Ctrl+↑/↓ from an empty box
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (input.value || e.ctrlKey)) {
    if (e.key === 'ArrowUp') { if (!history.length) return; hi = Math.max(0, hi - 1); input.value = history[hi]; }
    else { hi = Math.min(history.length, hi + 1); input.value = history[hi] || ''; }
    e.preventDefault(); e.stopPropagation();
  }
});
addEventListener('keydown', e => {          // arrows and numpad walk when the command box is empty
  const NUM = { Numpad8: 'north', Numpad2: 'south', Numpad4: 'west', Numpad6: 'east', Numpad7: 'northwest', Numpad9: 'northeast', Numpad1: 'southwest', Numpad3: 'southeast', NumpadSubtract: 'up', NumpadAdd: 'down', Numpad5: 'look', Numpad0: INVENTORY.list,
    ArrowUp: 'north', ArrowDown: 'south', ArrowLeft: 'west', ArrowRight: 'east' };
  const t = e.target, typing = t !== input && t.matches?.('input, textarea, select, [contenteditable]');
  if (!NUM[e.code] || input.value || echoOff || typing || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]')) return;
  command(NUM[e.code]); e.preventDefault();
});

function setStatus(s) {
  if (s.connected && !connected) { parser.inGame = false; parser.queue = []; }
  connected = s.connected; echoOff = s.echoOff;
  $('conn').textContent = connected ? '中斷連線' : '連線';
  $('state').textContent = connected ? `已連線 ${s.host}:${s.port}${s.paused ? '（自動指令已暫停）' : ''}` : s.reconnecting ? '等待自動重連…' : '未連線';
  $('state').className = connected ? 'on' : '';
  input.type = echoOff ? 'password' : 'text'; input.placeholder = echoOff ? '輸入密碼（不會顯示，也不會被記錄）' : '輸入指令，Enter 送出';
}
$('conn').onclick = () => { post(connected ? '/api/disconnect' : '/api/connect'); input.focus(); };
$('lookBtn').onclick = () => { command('look'); input.focus(); };
$('demo').onclick = () => { const i = (+$('demo').dataset.i || 0); $('demo').dataset.i = (i + 1) % DEMO.length;
  if (mapUI.demoMode()) sys('示範模式：這個分頁的小地圖暫停存檔，重新整理頁面即恢復。');
  parser.inGame = true;
  if (i in DEMO_CMD) { parser.paging = false; parser.post = null; parser.queue = [{ cmd: DEMO_CMD[i], dir: dirOf(DEMO_CMD[i]), at: Date.now() }]; }
  sys('示範文字（非伺服器輸出）'); feed(write(DEMO[i])); };

const es = new EventSource('/api/stream' + q);
es.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.t === 'text') feed(write(m.d));
  else if (m.t === 'cmd') { parser.sent(m.d); const keep = sgr; sgr = { fg: m.auto ? 5 : 6, bg: -1, bold: !m.auto }; span(m.auto ? '⚙ ' + m.d : m.d); sgr = keep; newLine(); term.scrollTop = term.scrollHeight; }
  else if (m.t === 'sys') sys(m.d);
  else if (m.t === 'status') setStatus(m);
  else if (m.t === 'replayEnd') { replaying = false; mapUI.replayEnd(); }
};
// output replayed after a reload refreshes the panels' contents but does not pop them open
es.onopen = () => { replaying = true; mapUI.replayStart(); };
es.onerror = () => { $('state').textContent = '與本機代理伺服器失去連線'; $('state').className = ''; };

// ------------------------------------------------------------------ settings: player model, music
const audio = new Audio(); audio.loop = true; let track = '';
function music(terrainKey) {
  if (!$('bgm').checked || !manifest.bgm.length) { audio.pause(); return; }
  const f = manifest.bgm[hash(terrainKey) % manifest.bgm.length];
  if (f !== track) { track = f; audio.src = '/assets/audio/sound/bgm/' + f; }
  audio.volume = 0.35; audio.play().catch(() => { /* needs a user gesture first */ });
}
$('bgm').checked = store.get('bgm', false);
$('bgm').onchange = () => { store.set('bgm', $('bgm').checked); music(room?.terrain.key || 'plain'); };

(async () => {
  manifest = await (await fetch('/api/manifest')).json();
  if (!manifest.assets) sys('找不到素材資料夾，圖形畫面無法顯示（見 README）。');
  const sel = $('model');
  for (const p of manifest.players) sel.add(new Option(p.replace(/_m$/, '（男）').replace(/_w$/, '（女）'), p));
  sel.value = manifest.players.includes(store.get('model', '')) ? store.get('model') : 'warrior_m';
  sel.onchange = () => { store.set('model', sel.value); scene.setPlayer(`gltf/bin/player/${sel.value}.glb`); };
  if (sel.value) await scene.setPlayer(`gltf/bin/player/${sel.value}.glb`);
  if (!room) scene.setRoom({ name: '', exits: [], terrain: DEFAULT_TERRAIN, decor: [] }, null);
  drawMap();
})();
initSettings();
input.focus();
