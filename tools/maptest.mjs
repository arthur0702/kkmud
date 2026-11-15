// WorldMap save/load/locate:  node tools/maptest.mjs [logs/<file>.log]   (without a log: the synthetic walk in tools/fixtures)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MudParser, WorldMap } from '../public/parser.js';
import { PARSER } from '../public/config.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const text = fs.readFileSync(process.argv[2] || fileURLToPath(new URL('./fixtures/walk.log', import.meta.url)), 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
const run = (p, upto = Infinity) => {
  let n = 0;
  for (const part of text.split(/(\n« .*? »\n)/)) {
    const c = /^\n« (.*?) »\n$/.exec(part);
    if (c) { if (++n > upto) break; p.sent(c[1]); } else p.feed(part);
  }
};
const mk = () => new MudParser({ thing(l) { const m = PARSER.thing.exec(l); return m ? { name: m[1], id: m[2] } : null; } });

const a = mk(); run(a);
const json = JSON.parse(JSON.stringify(a.map.toJSON()));
check('save has every room', json.sheets.reduce((n, s) => n + s.rooms.length, 0) === a.map.size, `${a.map.size} rooms in ${a.map.sheets.length} areas`);

const b = new WorldMap(); b.load(json);
check('load gives the same rooms and cursor', JSON.stringify(b.toJSON().sheets) === JSON.stringify(json.sheets) && b.key() === a.map.key() && b.s === a.map.s);

// page reload: a replay of the same output on top of the restored map must not move or duplicate anything
const c = mk(); run(c);
c.map.load(json); c.map.locate(c.room);
check('replay + restore keeps the cursor on the current room', c.map.rooms.get(c.map.key())?.sig === c.room.sig && c.map.key() === a.map.key());
check('replay + restore adds no rooms', c.map.size === a.map.size);

// a map saved half way, then the rest of the walk continues from it
const half = mk(); run(half, 40);
const resumed = mk(); resumed.map.load(JSON.parse(JSON.stringify(half.map.toJSON())));
const roomsBefore = resumed.map.size;
run(resumed);
check('continuing a restored map keeps the old rooms', resumed.map.size >= roomsBefore);

// locate a room that is somewhere else on the map
const d = new WorldMap(); d.load(json);
const far = [...d.sheets[0].entries()][0];
d.locate({ sig: far[1].sig, name: far[1].name, exits: far[1].exits, terrain: { key: far[1].terrain } });
check('locate jumps to a known room', d.s === 0 && d.key() === far[0]);
const before = d.sheets.length;
d.locate({ sig: 123456789, name: '從沒來過', exits: [], terrain: { key: 'plain' } });
check('locate an unknown room starts a new area', d.sheets.length === before + 1 && d.rooms.size === 1);

// loops that do not fit the grid
const R = (name, exits = ['north', 'south', 'east', 'west'], sig = name) => ({ name, sig: [...sig].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7), exits, terrain: { key: 'plain' } });
const walk = (m, steps) => { for (const [dir, room] of steps) m.enter(room, dir); };
const cells = m => new Set(m.rooms.keys()).size === m.rooms.size;
{
  // a 4-step loop that does not come back to the start: the 5th room must not overwrite the 1st
  const m = new WorldMap(); m.enter(R('起點'), null);
  walk(m, [['east', R('乙')], ['north', R('丙')], ['west', R('丁')], ['south', R('戊')]]);
  const names = [...m.rooms.values()].map(r => r.name).sort().join();
  check('uneven loop keeps every room', m.size === 5 && names === [...'乙丁丙戊'].concat('起點').sort().join());
  walk(m, [['north', R('丁')], ['east', R('丙')], ['south', R('乙')], ['west', R('起點')]]);
  check('walking the loop back follows the learnt roads', m.size === 5 && m.rooms.get(m.key()).name === '起點');
  const back = new WorldMap(); back.load(JSON.parse(JSON.stringify(m.toJSON())));
  walk(back, [['east', R('乙')]]);
  check('learnt roads survive save and load', back.size === 5 && back.rooms.get(back.key()).name === '乙');
}
{
  // a loop that comes back one cell off the grid lands on the start room instead of a copy
  const m = new WorldMap(); m.enter(R('井邊'), null);
  walk(m, [['east', R('a')], ['east', R('b')], ['north', R('c')], ['west', R('d')], ['south', R('井邊')]]);
  check('loop closes onto the known room', m.size === 5 && m.rooms.get(m.key()).name === '井邊' && cells(m));
}
{
  // wilderness: every room looks the same; a square walk ends where it began without piling up
  const m = new WorldMap(); const g = () => R('草原', ['north', 'south', 'east', 'west', 'northeast', 'southwest']);
  m.enter(g(), null);
  walk(m, [['east', g()], ['east', g()], ['north', g()], ['west', g()], ['west', g()], ['south', g()], ['northeast', g()]]);
  check('identical wilderness rooms stay on a clean grid', m.size === 6 && m.key() === '1,-1,0');
}
{
  // a corridor that bends: the room east of here is somebody else, and that other room must survive
  const m = new WorldMap(); m.enter(R('中'), null);
  walk(m, [['east', R('東')], ['west', R('中')], ['north', R('北')], ['southeast', R('角落')]]);
  const k = [...m.rooms].find(([, r]) => r.name === '東')?.[0];
  check('a room in the way is pushed aside, not replaced', m.size === 4 && k && m.rooms.get(m.key()).name === '角落' && cells(m));
}

// bad input
let threw = false; try { new WorldMap().load({ hello: 1 }); } catch { threw = true; }
check('refuses a file that is not a map', threw);
const e = new WorldMap(); e.load({ format: 'kkmud-map', sheets: [{ rooms: [{ x: 1.5, y: 0, z: 0, name: 'bad' }, { x: 1, y: 2, z: 0, name: 'ok', exits: ['north', 5] }] }] });
check('skips malformed rooms and fields', e.size === 1 && e.sheets[0].get('1,2,0').exits.join() === 'north');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
