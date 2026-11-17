// Terminal, network, text parsing and minimap. The 3D room lives in scene.js; recognition rules in config.js.
import { RoomScene } from './scene.js';
import { sid, q, post } from './api.js';
import { initSettings } from './settings.js';
import { initMap } from './mapview.js';
import { initMacro } from './macro.js';
import { MudParser, hash, shopLine, dirOf, isItem } from './parser.js';
import { DECOR_WORDS } from './chess.js';
import { PARSER, DIRS, DEFAULT_TERRAIN, MONSTERS, PEOPLE, PEOPLE_DEFAULT, FEMALE, ITEMS, ACTIONS, CORPSE, CORPSE_MODEL, ROOM_WORD, ROOM_VERBS, SHOP, INVENTORY, BOARD, SPELL_VOICE, DEMO, DEMO_CMD } from './config.js';

const $ = id => document.getElementById(id);
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('kk.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('kk.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };

let manifest = { monsters: {}, players: [], gobs: {}, bgm: [] };
let connected = false, echoOff = false;
const scene = new RoomScene($('gl'), $('overlay'), { exit: dir => command(dir), thing: (t, el) => menu(t, el) });
scene.setStyle(store.get('style', 'chess'));      // before the replayed output draws the room; checked again once the manifest is in

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
// Esc closes the click menu, then the open panels (inventory, shop, board); dialogs close themselves
addEventListener('keydown', e => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]')) return;
  if (!pop.hidden) { pop.hidden = true; return; }
  if (!$('board').hidden) $('boardClose').click();
  $('inv').hidden = true; $('shop').hidden = true;
});

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
    r.decorChess = decorWords(r.name + r.desc, r.terrain);
    scene.setRoom(r, moved);
    if (moved || r.name !== $('roomName').textContent) { $('shop').hidden = true; $('board').hidden = true; }     // left the shop / the board
    boardButton();
    $('roomName').textContent = r.name; $('roomDesc').textContent = r.desc;
    roomWords(r.desc);
    music(r.terrain.key); drawMap();
  },
  things() { clearTimeout(thingTimer); thingTimer = setTimeout(() => room && scene.setThings(room.things), 120); boardButton(); },
  status(key, cur, max) {
    if (key === 'hp') hpMax = max;
    const bar = $(key); bar.hidden = false; bar.title = ''; bar.classList.remove('est');
    bar.firstElementChild.style.width = Math.max(0, Math.min(100, cur / Math.max(1, max) * 100)) + '%';
    bar.lastElementChild.textContent = `${key === 'hp' ? '體力' : '法力'} ${cur}/${max}`;
  },
  combat(ev) {
    // "( 你受了幾處傷 ... )": the server describes you too; between "hp" commands the bar follows that description
    if (ev.type === 'cond' && /^[你妳]$/.test(ev.who)) { selfCondition(ev.pct); return; }
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
  cast(spell, sex) { if (!replaying) spellVoice(spell, sex); },
  thing: l => { const t = parseThing(l); if (t) t.uid = ++uid; return t; },
  newcomer: name => { const t = classify(name, nameIds.get(name) || ''); if (t) t.uid = ++uid; return t; },      // walked in: the id is known only if the name was seen before
});
let uid = 0, replaying = false, hpMax = 0;
// your HP from a combat description: only a band, so it is shown as an estimate until the next exact "hp"/"score"
function selfCondition(pct) {
  const bar = $('hp'); bar.hidden = false; bar.classList.add('est');
  bar.firstElementChild.style.width = pct + '%';
  bar.lastElementChild.textContent = hpMax ? `體力 ≈${Math.round(hpMax * pct / 100)}/${hpMax}` : `體力 約 ${pct}%`;
  bar.title = '依戰鬥訊息估計（送出 hp 可取得精確數值）';
}
// the server says 妳 to a female character: then you are the queen rather than the king
let female = store.get('female.' + sid, false);
const feed = plain => {
  if (!female && /(?:^|\n)(?:> )?妳/.test(plain)) { female = true; store.set('female.' + sid, true); if (scene.style === 'chess') scene.setPlayer('', true); }
  learnNames(plain);
  parser.feed(plain);
};

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
  // a monster even without its model: the chess style only needs to know what kind of creature it is (the folder name gives its size)
  for (const [re, folder] of MONSTERS) if (re.test(name) && (manifest.monsters[folder] || !manifest.assets)) return { name, id, kind: 'monster', url: manifest.monsters[folder] || `gltf/bin/monster/${folder}/${folder}.glb` };
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

// scenery for the chess style: simple shapes for the trees, rocks, ... the terrain has or the text mentions
function decorWords(text, terrain) {
  const out = [];
  for (const d of terrain.decor) if (DECOR_WORDS[d]) out.push({ kind: DECOR_WORDS[d] });
  for (const [ch, kind] of Object.entries(DECOR_WORDS)) if (text.includes(ch) && !out.some(o => o.kind === kind)) out.push({ kind }, { kind });
  return out.slice(0, 10);
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
// typed commands, kept per account in this browser so a reload keeps them (never what is typed while the server hides echo)
const HISTORY_KEY = 'history.' + sid, HISTORY_MAX = 300;
const input = $('cmd'), history = store.get(HISTORY_KEY, []).filter(x => typeof x === 'string').slice(-HISTORY_MAX); let hi = history.length;
function command(text, fromMacro = false) {
  if (!connected) { sys('尚未連線'); return Promise.resolve(); }
  if (!fromMacro && !echoOff) macro.note(text);        // recorded as typed: "#1" stays "#1" and is looked up again on playback
  return post('/api/send', { text: expandIds(text) }).catch(() => sys('送出失敗'));
}
// ------------------------------------------------------------------ recorder: commands and their timing, played back with the same gaps
const macro = initMacro({ store, sid, sys, send: t => command(t, true), canSend: () => connected && !echoOff });
addEventListener('kk:quick', e => { if (!echoOff) macro.note(e.detail); });   // quick buttons are sent by the proxy

// ------------------------------------------------------------------ id list: #0 = you, #1.. = what is in the room (people first, then things)
const ID_MAX = 15, GREET = 99;
let myId = '', idRefs = {}, idSig = '';
// variables set by events (#99 = whoever last greeted you), kept per account
const idVars = store.get('idvars.' + sid, {});
function idEntries() {
  const out = [{ ref: myId || 'me', name: '你自己', kind: 'me' }];
  const things = room?.things || [], seen = {};
  // the MUD counts same-id things in the order it lists them: the second guard is "guard 2"
  for (const t of things) if (!t.id && t.kind !== 'item' && t.kind !== 'corpse') t.id = idOfName(t.name);      // walked in earlier: the id may be known by now
  const refs = things.map(t => { if (!t.id) return null; seen[t.id] = (seen[t.id] || 0) + 1; return seen[t.id] > 1 ? `${t.id} ${seen[t.id]}` : t.id; });
  const rank = t => (t.kind === 'person' || t.kind === 'monster' ? 0 : t.kind === 'item' ? 1 : 2);
  things.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .forEach(({ t, i }) => out.push({ ref: refs[i], name: t.name, kind: t.kind }));
  const list = out.slice(0, ID_MAX).map((e, n) => ({ ...e, n }));
  const g = idVars[GREET];
  if (g && !g.id && (g.id = idOfName(g.name))) store.set('idvars.' + sid, idVars);      // learnt after the greeting
  if (g) list.push({ n: GREET, ref: g.id, name: `${g.name}（向你打招呼）`, kind: 'greet' });
  return list;
}
function drawIds() {
  const list = idEntries(), sig = JSON.stringify(list), box = $('idList');
  idRefs = Object.fromEntries(list.map(e => [e.n, e.ref]));
  box.hidden = !$('idToggle').checked;
  $('view').classList.toggle('ids', !box.hidden);         // the list gets its own column, the scene moves right
  // the minimap joins that column; without it, it floats in the scene's top-right corner
  const mb = document.querySelector('.mapbox'), home = box.hidden ? document.querySelector('.main') : $('side');
  if (mb.parentElement !== home) home.prepend(mb);
  if (sig === idSig) return; idSig = sig;
  // the proxy runs triggers, aliases and quick buttons: give it the same #0..#14
  const nums = list.filter(e => e.n < ID_MAX && e.ref);
  post('/api/ids', { ids: Object.fromEntries(nums.map(e => [e.n, e.ref])), names: Object.fromEntries(nums.map(e => [e.n, e.name])) }).catch(() => {});
  box.textContent = '';
  list.forEach(e => {
    const n = e.n, row = document.createElement('div'); row.className = e.kind;
    row.title = `${e.name}（${e.ref || '名稱未知，先查看四周'}）：點一下把 #${n} 填入指令列`;
    const b = document.createElement('b'); b.textContent = '#' + n;
    const s = document.createElement('span'); s.textContent = e.ref || '?';
    const i = document.createElement('i'); i.textContent = e.name;
    row.append(b, s, i);
    row.onclick = () => { const p = input.selectionStart ?? input.value.length; input.value = input.value.slice(0, p) + `#${n}` + input.value.slice(p); input.focus(); };
    box.append(row);
  });
}
// "look #1" -> "look guard"; numbers not in the list (and #wait) are left alone
function expandIds(text) { if (echoOff) return text; return text.replace(/#(\d{1,2})(?!\d)/g, (m, n) => idRefs[+n] || m); }

// ------------------------------------------------------------------ names -> ids, learnt from every "名字(Id)" the server prints
// (room lists, score, who, ...). Shared by all account tabs in this browser, so one character's "score" teaches the others.
const nameIds = new Map(Object.entries(store.get('nameIds', {})));
let namesTimer = 0;
function learnNames(plain) {
  let added = false;
  for (const m of plain.matchAll(/([^\s「」『』()（）:：,，。!！?？>]{1,12})\(([A-Za-z][A-Za-z']{1,19}(?: [A-Za-z][A-Za-z']*){0,3})\)/g)) {
    const name = m[1], id = m[2].toLowerCase();
    if (nameIds.get(name) !== id) { nameIds.delete(name); nameIds.set(name, id); added = true; }
  }
  if (!added) return;
  while (nameIds.size > 3000) nameIds.delete(nameIds.keys().next().value);
  clearTimeout(namesTimer); namesTimer = setTimeout(() => store.set('nameIds', Object.fromEntries(nameIds)), 1000);
}
function idOfName(name) {
  const here = room?.things.find(t => t.id && t.name === name);
  return here?.id || nameIds.get(name) || '';
}
// another account's tab learnt some names: take them over at once
addEventListener('storage', e => {
  if (e.key !== 'kk.nameIds' || !e.newValue) return;
  try { for (const [k, v] of Object.entries(JSON.parse(e.newValue))) if (!nameIds.has(k)) nameIds.set(k, v); } catch { /* ignore */ }
});
// the room description folds to one line (click it), remembered in this browser
$('roomText').classList.toggle('fold', store.get('descFold', false));
$('roomText').onclick = e => { if (getSelection()?.toString()) return; store.set('descFold', $('roomText').classList.toggle('fold')); };
$('idToggle').checked = store.get('idlist', true);
$('idToggle').onchange = () => { store.set('idlist', $('idToggle').checked); drawIds(); };
setInterval(drawIds, 400);
input.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = input.value; input.value = '';
    if (v && !echoOff && history[history.length - 1] !== v) {
      history.push(v); if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
      store.set(HISTORY_KEY, history);
    }
    hi = history.length; command(v);
    return;
  }
  // history: ↑/↓ (walking is on the numpad)
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (e.key === 'ArrowUp') { if (!history.length) return; hi = Math.max(0, hi - 1); input.value = history[hi]; }
    else { hi = Math.min(history.length, hi + 1); input.value = history[hi] || ''; }
    e.preventDefault(); e.stopPropagation();
  }
});
addEventListener('keydown', e => {          // the numpad walks (and a few more) when the command box is empty
  const NUM = { Numpad8: 'north', Numpad2: 'south', Numpad4: 'west', Numpad6: 'east', Numpad7: 'northwest', Numpad9: 'northeast', Numpad1: 'southwest', Numpad3: 'southeast', NumpadSubtract: 'up', NumpadAdd: 'down', Numpad5: 'look', Numpad0: INVENTORY.list,
    NumpadDivide: 'inventory', NumpadMultiply: 'score' };
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
  else if (m.t === 'vars') { for (const k of Object.keys(idVars)) delete idVars[k]; Object.assign(idVars, m.vars || {}); store.set('idvars.' + sid, idVars); idSig = ''; drawIds(); }
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

// your spell went off (the server printed the incantation): play its casting voice, 男/女 as the server says 你/妳
function spellVoice(word, sex) {
  if (!$('voice').checked || !manifest.voices) return;
  const ids = Object.keys(SPELL_VOICE), starts = ids.filter(k => k.startsWith(word));
  const id = SPELL_VOICE[word] ? word : starts.length === 1 ? starts[0] : null;      // "cast firebal" -> fireball
  const n = id && SPELL_VOICE[id], all = n && manifest.voices[n];
  if (!all?.length) return;
  const mine = all.filter(v => v[0] === sex), list = mine.length ? mine : all;
  const a = new Audio(`/assets/audio/sound/voice/${n}_${list[Math.floor(Math.random() * list.length)]}.wav`);
  a.volume = 0.85; a.play().catch(() => { /* needs a user gesture first */ });
}
$('voice').checked = store.get('voice', true);
$('voice').onchange = () => store.set('voice', $('voice').checked);

(async () => {
  manifest = await (await fetch('/api/manifest')).json();
  try { myId = ((await (await fetch('/api/profiles')).json()).find(p => p.id === sid)?.user || '').toLowerCase(); } catch { /* keep 'me' */ }
  drawIds();
  // picture style: chess pieces (built in) or the official assets when they are installed
  const st = $('style');
  if (!manifest.assets) {
    st.value = 'chess'; st.querySelector('[value=official]').disabled = true; st.title = '沒有安裝遊戲素材，只能使用西洋棋畫面（見 README）';
    sys('找不到遊戲素材，使用內建的西洋棋畫面（見 README）。');
  }
  else st.value = store.get('style', 'chess');
  // the character model only matters for the official picture: hide its picker otherwise (saves toolbar room)
  const modelUI = () => { $('model').parentElement.hidden = st.value === 'chess'; };
  scene.setStyle(st.value); modelUI();
  st.onchange = async () => {
    store.set('style', st.value); scene.setStyle(st.value); modelUI();
    await scene.setPlayer(`gltf/bin/player/${sel.value}.glb`, female);
    if (room) { scene.setRoom(room, null); scene.setThings(room.things); }
  };
  const sel = $('model');
  for (const p of manifest.players) sel.add(new Option(p.replace(/_m$/, '（男）').replace(/_w$/, '（女）'), p));
  sel.value = manifest.players.includes(store.get('model', '')) ? store.get('model') : 'warrior_m';
  sel.onchange = () => { store.set('model', sel.value); scene.setPlayer(`gltf/bin/player/${sel.value}.glb`, female); };
  if (sel.value || scene.style === 'chess') await scene.setPlayer(`gltf/bin/player/${sel.value}.glb`, female);
  if (!room) scene.setRoom({ name: '', exits: [], terrain: DEFAULT_TERRAIN, decor: [] }, null);
  else { scene.setRoom(room, null); scene.setThings(room.things); }      // drawn while loading, maybe in the wrong style
  drawMap();
  // another tab changed the picture style: follow it
  addEventListener('storage', e => {
    if (e.key !== 'kk.style' || !e.newValue) return;
    const v = JSON.parse(e.newValue);
    if (v !== st.value && !st.querySelector(`[value="${v}"]`)?.disabled) { st.value = v; st.onchange(); }
  });
})();
initSettings();
input.focus();
