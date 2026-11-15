// Pure text -> game-state logic (no DOM), so it can be replayed against session logs with Node (see tools/replay.mjs).
import { PARSER, DIRS, DIR_ALIAS, TERRAIN, DEFAULT_TERRAIN, SHOP, ITEMS, ITEM_IDS, MONSTERS } from './config.js';

// One line of a shop listing -> {name, id, index, price} or null. Deliberately loose: the exact layout differs between shops.
export function shopLine(l) {
  if (!/[一-鿿A-Za-z]/.test(l) || SHOP.skip.test(l)) return null;
  const idx = /^\s*[\[(（【]?\s*(\d{1,3})\s*[\])）】.、:：]/.exec(l);
  const rest = idx ? l.slice(idx[0].length) : l;
  const idm = /\(([A-Za-z][\w' -]{0,30})\)/.exec(rest);
  let price = null, pm = SHOP.price.exec(rest);
  if (pm) price = +pm[1].replace(/,/g, '');
  else { const nums = [...rest.replace(/\([^)]*\)/g, ' ').matchAll(/(?<![\w.])(\d[\d,]*)(?![\w.])/g)]; if (nums.length) price = +nums[nums.length - 1][1].replace(/,/g, ''); }
  let name = (idm ? rest.slice(0, idm.index) : rest.replace(SHOP.price, ' ').replace(/[\d,]+\s*$/, '')).replace(/[\s　.:：|│\-=]+$/, '').replace(/^[\s　|│]+/, '').trim();
  if (!name || name.length > 30 || (!idm && !idx)) return null;
  return { name, id: idm ? idm[1].trim().toLowerCase() : '', index: idx ? +idx[1] : null, price };
}

// Is this thing an object (equipment, board, ...) rather than a creature? known = ids seen in the backpack or a shop list.
export function isItem(name, id = '', known = null) {
  const i = id.trim().toLowerCase();
  if (i && known?.has(i)) return true;
  const head = (i.split(' of ')[0].split(/\s+/).pop() || '').replace(/'s$/, '');
  if (ITEM_IDS.has(head)) return true;
  return ITEMS.some(([re]) => re.test(name)) && !MONSTERS.some(([re]) => re.test(name));
}

export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function dirOf(cmd) {
  const c = cmd.trim().toLowerCase();
  return DIR_ALIAS[c] || (DIRS[c] ? c : null);
}

export class MudParser {
  // cb: { room(room, moved), things(list), status(key, cur, max), combat(ev), picked(text, cmd), thing(line) -> object|null }
  constructor(cb) { this.cb = cb; this.reset(); }

  reset() {
    this.buf = ''; this.recent = []; this.room = null; this.collecting = false; this.paging = false; this.inv = null; this.board = null; this.post = null; this.lastCmd = ''; this.lastAt = 0;
    this.queue = [];            // one entry per command sent, oldest first; each server reply ends with a "> " prompt
    this.inGame = false;        // becomes true at the first prompt, so login input never enters the queue
    this.map = new WorldMap();
  }

  // call when the user sends a command
  sent(cmd) {
    this.recent = []; this.collecting = false;
    if (!this.inGame) return;
    if (cmd.trim()) { this.lastCmd = cmd.trim(); this.lastAt = Date.now(); }       // its prompt may already have been taken by the answer to a pager
    if (this.paging) { this.paging = false; return; }         // Enter / q / b answer the pager (so it no longer waits); they are not new commands
    this.endPost(); this.endBoard();                           // a new command: whatever was still open has ended (missed prompt)
    this.queue.push({ cmd: cmd.trim(), dir: dirOf(cmd), at: Date.now() });
    if (this.queue.length > 8) this.queue.splice(0, this.queue.length - 2);      // lost sync somewhere: keep only the newest
  }

  feed(plain) {
    this.buf += plain;
    const parts = this.buf.split('\n'); this.buf = parts.pop();
    for (const l of parts) this.line(l);
    const m = /^(?:> )+$/.exec(this.buf);                    // a bare prompt has no newline after it
    if (m) { for (let i = 0; i < m[0].length / 2; i++) this.prompt(); this.buf = ''; }
    else if (PARSER.pager.test(this.buf) || PARSER.postEnd.test(this.buf)) { this.line(this.buf); this.buf = ''; }      // pager lines have no newline either
  }

  // "look board": the list ends at the prompt or at the first line that is not a post
  endBoard(more = null) {
    if (!this.board) return;
    const b = this.board; if (more == null) this.board = null;
    this.cb.board?.(b.posts, b.desc, more);
  }
  // "read n": a post ends at "本文完畢" or at the prompt; while the pager waits, what has arrived so far is shown
  // waiting: the post ended with "請按任意鍵繼續", so the server wants one more key before its prompt
  endPost(more = null, waiting = false) {
    if (!this.post) return;
    const p = this.post; if (more == null) this.post = null;
    const lines = p.lines.slice(); while (lines.length && !lines[0].trim()) lines.shift(); while (lines.length && !lines.at(-1).trim()) lines.pop();
    this.cb.post?.({ ...p, lines }, more, waiting);
  }

  // the reply to "i" ends at the prompt or at the first line that is not an item
  endInv() {
    if (!this.inv) return;
    const { items, load } = this.inv; this.inv = null;
    const seen = {};
    for (const it of items) { seen[it.id] = (seen[it.id] || 0) + 1; it.ref = seen[it.id] > 1 ? `${it.id} ${seen[it.id]}` : it.id; }      // "ring 2" = the second ring
    this.cb.inventory?.(items, load);
  }

  prompt() {
    this.endInv(); this.endBoard(); this.endPost();
    this.inGame = true; this.recent = []; this.collecting = false;
    this.paging = false;
    const head = this.queue.shift();
    if (head?.lines?.length) this.cb.listing?.(head.cmd, head.lines, null);      // the whole reply to a "list"
  }

  line(raw) {
    let l = raw.replace(/\s+$/, '');
    if (this.post) {                                           // inside a post "> " is quoting, not the prompt
      const more = PARSER.pager.exec(l);
      if (more) { this.paging = true; this.endPost(+more[1]); return; }
      if (PARSER.postEnd.test(l)) { this.paging = true; this.endPost(null, true); return; }      // waits for a key, then the prompt
      if (this.post.lines.length || !/^-{10,}$/.test(l)) this.post.lines.push(l);
      return;
    }
    while (l.startsWith('> ')) { this.prompt(); l = l.slice(2); }       // prompt glued to the next reply
    if (l === '>') { this.prompt(); return; }
    const head = this.queue[0];
    const more = PARSER.pager.exec(l);
    if (more) {                                                // long output stops here until Enter; show what has arrived so far
      this.paging = true;
      if (head?.lines?.length) this.cb.listing?.(head.cmd, head.lines, +more[1]);
      this.endBoard(+more[1]);
      return;
    }
    if (PARSER.boardHead.test(l)) { this.board = { desc: (this.recent.at(-1) || '').trim(), posts: [] }; return; }
    const bi = PARSER.boardItem.exec(l);
    if (this.board) {
      if (bi) { this.board.posts.push({ n: +bi[1], title: bi[2].trim(), author: bi[3], id: bi[4].toLowerCase(), date: bi[5].replace(/\s+/g, ' ') }); return; }
      this.endBoard();
    } else if (bi && (/^read\b/i.test(head?.cmd || '') || /^read\b/i.test(this.lastCmd))) {      // the header of a post
      this.post = { n: +bi[1], title: bi[2].trim(), author: bi[3], id: bi[4].toLowerCase(), date: bi[5].trim(), lines: [] };
      return;
    }
    const inc = PARSER.incant.exec(l);                          // your spell went off: "妳喃喃唸道 : ..." right after "cast float"
    const cast = /^cast\s+['"]?([a-z_]+)/i.exec(this.lastCmd);
    if (inc && cast && Date.now() - this.lastAt < 15000) { this.cb.cast?.(cast[1].toLowerCase(), inc[1] === '妳' ? 'f' : 'm'); this.lastCmd = ''; }
    const ih = PARSER.invHead.exec(l);
    if (ih) { this.endInv(); this.inv = { items: [], load: ih[1] ? [+ih[1], +ih[2]] : null }; return; }
    if (this.inv) {
      const it = PARSER.invItem.exec(l);
      if (it) { this.inv.items.push({ name: it[2].replace(/[￠★☆◎※•·]/g, '').trim(), id: it[3].trim().toLowerCase(), used: it[1] === 'ˇ' }); return; }
      this.endInv();
    }
    if (PARSER.invEmpty.test(l)) this.cb.inventory?.([], null);
    if (head && SHOP.trigger.test(head.cmd) && l.trim()) (head.lines ||= []).push(l);
    for (const key of ['hp', 'mp']) for (const re of PARSER[key]) { const m = re.exec(l); if (m) this.cb.status?.(key, +m[1], +m[2]); }
    this.combat(l);
    this.presence(l);
    const got = PARSER.picked.exec(l);
    if (got) this.cb.picked?.(got[1].trim(), this.queue[0]?.cmd || '');
    if (PARSER.blocked.test(l) && this.queue[0]) this.queue[0].dir = null;

    let m = null;
    if (PARSER.noExits.test(l)) m = ['', ''];
    else for (const re of PARSER.exits) if ((m = re.exec(l))) break;
    if (m) { this.onRoom(m[1]); return; }

    if (this.collecting) {
      const t = l.trim() ? this.cb.thing?.(l) : null;
      if (t) { this.room.things.push(t); this.cb.things?.(this.room.things); } else this.collecting = false;
      if (t) return;
    }
    this.recent.push(l); if (this.recent.length > 60) this.recent.shift();
  }

  // someone walked in or out: keep the room's list (and so the picture) in step without a new look
  presence(l) {
    if (!this.room || l.startsWith('你')) return;
    let m = PARSER.arrive.exec(l);
    if (m) {
      const t = this.cb.newcomer?.(m[1]);
      if (t) { this.room.things.push(t); this.cb.things?.(this.room.things); }
      return;
    }
    for (const re of PARSER.leave) {
      if (!(m = re.exec(l))) continue;
      const who = m[1], list = this.room.things;
      const alive = t => t.kind !== 'item' && t.kind !== 'corpse';
      let i = list.findIndex(t => alive(t) && t.name === who);
      if (i < 0) i = list.findIndex(t => alive(t) && (t.name.endsWith(who) || who.endsWith(t.name)));      // "女服務生 悠妮" vs "悠妮"
      if (i >= 0) { list.splice(i, 1); this.cb.things?.(list); }
      return;
    }
  }

  // combat lines ->{type:'attack', target, hit} | {type:'mobAttack', who, hit} | {type:'cond', who, pct} | {type:'die', who}
  combat(l) {
    const C = PARSER.combat, names = (this.room?.things || []).map(t => t.name);
    let m;
    if ((m = C.died.exec(l))) { this.cb.combat?.({ type: 'die', who: m[1].trim() }); return; }
    if ((m = C.condition.exec(l))) { this.cb.combat?.({ type: 'cond', who: m[1].trim(), pct: C.conditionPct[m[2]] }); return; }
    const hit = C.hit.test(l);
    if (C.theirs.test(l) && !l.startsWith('你')) {
      const who = names.filter(n => l.startsWith(n)).sort((a, b) => b.length - a.length)[0];
      this.cb.combat?.({ type: 'mobAttack', who: who || '', hit });
    } else if (C.mine.test(l) && /[砍刺斬劈擊射打咬抓踢]/.test(l)) {
      const target = names.filter(n => l.includes(n)).sort((a, b) => b.length - a.length)[0];
      if (target) this.cb.combat?.({ type: 'attack', target, hit });
    }
  }

  onRoom(exitText) {
    const exits = [];
    for (let tok of exitText.split(PARSER.exitSplit)) {
      tok = tok.trim(); if (!tok) continue;
      const d = DIR_ALIAS[tok] || DIR_ALIAS[tok.toLowerCase()] || tok.toLowerCase();
      if (/^[a-z][a-z0-9_ ]{0,15}$/.test(d) && !exits.includes(d)) exits.push(d);
    }
    // the title is the last "name - " line before the exits; everything after it is the description
    const body = this.recent; this.recent = [];
    let ti = -1;
    for (let i = body.length - 1; i >= 0; i--) if (PARSER.title.test(body[i])) { ti = i; break; }
    let name, descLines;
    if (ti >= 0) { name = PARSER.title.exec(body[ti])[1].trim(); descLines = body.slice(ti + 1); }
    else { const b = body.filter(x => x.trim()); name = (b[0] || '').trim().slice(0, 24); descLines = b.slice(1); }
    const ambient = descLines.filter(x => PARSER.ambient.test(x)).map(x => x.trim());
    const desc = descLines.filter(x => !PARSER.ambient.test(x)).map(x => x.trim()).join('');
    if (!name) name = this.room?.name || '不明地點';

    const terrain = TERRAIN.find(t => t.name?.test(name)) || TERRAIN.find(t => t.re.test(name)) || TERRAIN.find(t => t.re.test(desc)) || DEFAULT_TERRAIN;
    const head = this.queue[0];
    const moved = head && Date.now() - head.at < 15000 ? head.dir : null;
    if (head) head.dir = null;                                 // one reply moves at most once
    const room = this.room = { name, desc, ambient, exits, terrain, sig: hash(name + '|' + desc + '|' + [...exits].sort().join()), things: [] };
    this.collecting = true;
    this.map.enter(room, moved);
    this.cb.room?.(room, moved);
  }
}

// Rooms on a grid built from the directions walked. The MUD has no coordinates, so this is a best-effort sketch:
// several sheets are kept, and a jump (recall, teleport) lands on the sheet that already has that room when it is unambiguous.
export class WorldMap {
  constructor() { this.clear(); this.onChange = null; }
  clear() { this.sheets = [new Map()]; this.names = ['']; this.s = 0; this.x = 0; this.y = 0; this.z = 0; }
  get rooms() { return this.sheets[this.s]; }
  get size() { return this.sheets.reduce((n, sh) => n + sh.size, 0); }
  key(x = this.x, y = this.y, z = this.z) { return `${x},${y},${z}`; }

  // saved form: plain JSON, readable and editable by hand
  toJSON() {
    return { format: 'kkmud-map', version: 1, saved: new Date().toISOString(), at: { sheet: this.s, x: this.x, y: this.y, z: this.z },
      sheets: this.sheets.map((sh, i) => ({ name: this.names[i] || '', rooms: [...sh].map(([k, r]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z, ...r }; }) })) };
  }
  load(j) {
    if (!j || j.format !== 'kkmud-map' || !Array.isArray(j.sheets)) throw new Error('不是小地圖的存檔');
    const sheets = [], names = [];
    for (const sh of j.sheets) {
      const m = new Map();
      for (const r of sh.rooms || []) {
        if (![r.x, r.y, r.z].every(Number.isInteger) || typeof r.name !== 'string') continue;
        const room = { name: r.name.slice(0, 40), sig: r.sig >>> 0, exits: Array.isArray(r.exits) ? r.exits.filter(e => typeof e === 'string').slice(0, 12) : [], terrain: String(r.terrain || 'plain') };
        if (r.links && typeof r.links === 'object') for (const [e, k] of Object.entries(r.links))
          if (DIRS[e] && typeof k === 'string' && /^-?\d+,-?\d+,-?\d+$/.test(k)) (room.links ||= {})[e] = k;
        m.set(`${r.x},${r.y},${r.z}`, room);
      }
      sheets.push(m); names.push(String(sh.name || '').slice(0, 30));
    }
    if (!sheets.length) { sheets.push(new Map()); names.push(''); }
    this.sheets = sheets; this.names = names;
    const at = j.at || {};
    this.s = Math.min(Math.max(0, at.sheet | 0), sheets.length - 1); this.x = at.x | 0; this.y = at.y | 0; this.z = at.z | 0;
  }
  // put the cursor on the room with this signature; when the map has never seen it, start a new area for it
  locate(room) {
    if (this.rooms.get(this.key())?.sig === room.sig) return;
    for (let si = 0; si < this.sheets.length; si++) for (const [k, r] of this.sheets[si]) if (r.sig === room.sig) {
      this.s = si; [this.x, this.y, this.z] = k.split(',').map(Number); return;
    }
    this.newSheet(); this.rooms.set(this.key(), { name: room.name, sig: room.sig, exits: room.exits, terrain: room.terrain.key });
  }
  newSheet() {
    const empty = this.sheets.findIndex(sh => !sh.size);              // reuse an empty area instead of piling them up
    if (empty >= 0) this.s = empty; else { this.sheets.push(new Map()); this.names.push(''); this.s = this.sheets.length - 1; }
    this.x = this.y = this.z = 0;
  }

  // A walk that the grid cannot hold (loops of uneven length, a road that bends without saying so) used to land on a cell
  // that already had another room and overwrite it. Now: follow a link learnt earlier; close the loop onto the room when it
  // is unmistakable; otherwise push that side of the map one cell away so both rooms keep their own cell.
  enter(room, moved) {
    const d = moved && DIRS[moved];
    if (d) {
      const from = this.key(), here = this.rooms.get(from);
      const linked = here?.links?.[moved], lr = linked && this.rooms.get(linked);
      const back = REVERSE[moved];
      let to;
      if (lr && (lr.sig === room.sig || lr.name === room.name)) to = linked;      // been this way before (a door may have changed the exits)
      else {
        const tx = this.x + d.dx, ty = this.y + d.dy, tz = this.z + d.dz;
        to = this.key(tx, ty, tz);
        const there = this.rooms.get(to);
        if (there && there.sig !== room.sig) {
          // the same room a cell or two away, with nothing yet linked from our side: a loop that came back a little off the grid
          const near = [...this.rooms].filter(([k, r]) => { if (r.sig !== room.sig) return false;
            const [x, y, z] = k.split(',').map(Number); return z === tz && Math.abs(x - tx) <= 2 && Math.abs(y - ty) <= 2 && !(back && r.links?.[back]); });
          const anywhere = [...this.rooms.values()].filter(r => r.sig === room.sig).length;
          if (near.length === 1 && anywhere === 1) to = near[0][0];
          else { this.makeRoom(this.x, this.y, this.z, d); to = this.key(tx, ty, tz); }
        }
      }
      if (here) (here.links ||= {})[moved] = to;
      [this.x, this.y, this.z] = to.split(',').map(Number);
      this.put(room);
      if (back && room.exits.includes(back)) { const r = this.rooms.get(to); (r.links ||= {})[back] ??= from; }      // the way back is almost always the same road
      this.onChange?.();
      return;
    }
    {
      const here = this.rooms.get(this.key());
      if (here && here.sig !== room.sig && here.name !== room.name) {      // not where we thought: find it, or open a new sheet
        const hits = [];
        this.sheets.forEach((sh, si) => { for (const [k, r] of sh) if (r.sig === room.sig) hits.push([si, k]); });
        if (hits.length === 1) { this.s = hits[0][0]; [this.x, this.y, this.z] = hits[0][1].split(',').map(Number); }
        else this.newSheet();
      }
    }
    this.put(room);
    this.onChange?.();
  }

  // write the room under the cursor, keeping what was learnt about its links when it is still the same room
  put(room) {
    const k = this.key(), prev = this.rooms.get(k);
    const r = { name: room.name, sig: room.sig, exits: room.exits, terrain: room.terrain.key };
    if (prev?.links && (prev.sig === room.sig || prev.name === room.name)) r.links = prev.links;
    this.rooms.set(k, r);
  }

  // free the cell next to (x,y,z) in direction d: every room on the far side of it moves one more step that way
  makeRoom(x, y, z, d) {
    const ax = d.dx ? 0 : d.dy ? 1 : 2, step = [d.dx, d.dy, d.dz][ax], edge = [x, y, z][ax] + step;
    const moveKey = k => { const p = k.split(',').map(Number); if ((p[ax] - edge) * step >= 0) p[ax] += step; return p.join(','); };
    const next = new Map();
    for (const [k, r] of this.rooms) {
      if (r.links) for (const e in r.links) r.links[e] = moveKey(r.links[e]);
      next.set(moveKey(k), r);
    }
    this.sheets[this.s] = next;
  }
}

const REVERSE = { north: 'south', south: 'north', east: 'west', west: 'east', northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest', up: 'down', down: 'up' };
