// Replays a session log through the parser:  node tools/replay.mjs logs/session-....log
import fs from 'node:fs';
import { MudParser } from '../public/parser.js';
import { PARSER } from '../public/config.js';

const text = fs.readFileSync(process.argv[2], 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
const p = new MudParser({
  room(r, moved) {
    const m = p.map;
    console.log(`${(moved || '-').padEnd(9)} [${m.s}:${m.x},${m.y},${m.z}] ${r.name.padEnd(8, '　')} ${r.terrain.key.padEnd(7)} exits=${r.exits.join(',')}  desc=${r.desc.length}c ambient=${r.ambient.length}`);
  },
  things(list) { const t = list[list.length - 1]; console.log(`            + ${t.name} (${t.id})`); },
  combat(ev) { console.log("            * " + JSON.stringify(ev)); },
  picked(text, cmd) { console.log(`            - picked "${text}" via "${cmd}"`); },
  status(k, a, b) { console.log(`            ${k} ${a}/${b}`); },
  thing(l) { const m = PARSER.thing.exec(l); return m ? { name: m[1].trim(), id: m[2].toLowerCase() } : null; },
});
for (const part of text.split(/(\n« .*? »\n)/)) {
  const c = /^\n« (.*?) »\n$/.exec(part);
  if (c) { p.sent(c[1]); console.log(`  > ${c[1]}`); } else p.feed(part);
}
console.log('sheets:', p.map.sheets.map(s => s.size).join(', '), ' queue left:', p.queue.length);
