import fs from 'node:fs';
import { MudParser, shopLine } from '../public/parser.js';
const text = fs.readFileSync(process.argv[2], 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, '');
const p = new MudParser({ listing: (cmd, lines, more) => { const g = lines.map(shopLine).filter(Boolean); console.log(`LISTING "${cmd}" lines=${lines.length} goods=${g.length} more=${more}`); } });
for (const part of text.split(/(\n« .*? »\n)/)) {
  const c = /^\n« (.*?) »\n$/.exec(part);
  if (c) { p.sent(c[1]); console.log(`> "${c[1]}"  queue=${JSON.stringify(p.queue.map(q => q.cmd))}`); } else p.feed(part);
}
console.log('queue left', JSON.stringify(p.queue.map(q => q.cmd)));
