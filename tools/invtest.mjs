// Backpack parsing against a real session log:  node tools/invtest.mjs logs/<file>.log
import fs from 'node:fs';
import { MudParser } from '../public/parser.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const replay = text => {
  const got = [];
  const p = new MudParser({ inventory: (items, load) => got.push({ items, load }) });
  for (const part of text.split(/(\n« .*? »\n)/)) { const c = /^\n« (.*?) »\n$/.exec(part); if (c) p.sent(c[1]); else p.feed(part); }
  return got;
};

if (process.argv[2]) {
  const got = replay(fs.readFileSync(process.argv[2], 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, ''));
  check('the log has backpack listings', got.length > 0, `${got.length} found`);
  for (const g of got) console.log(`      ${g.items.length} items, load ${g.load?.join('/')}: ` + g.items.map(i => `${i.used ? 'ˇ' : ''}${i.name}(${i.ref})`).join(' '));
}

const sample = '> \n你身上帶著下列這些東西(負重 725/1050 )﹕\n    ￠小木彈弓￠(Small wooden bow)\n    琉璃小戒指(Small ring)\n    琉璃小戒指(Small ring)\n  ˇ黑色長袍(Black robe)\n  ˇ短劍(Shortsword)\n> 路人甲往北飄去。\n';
const [g] = replay(sample);
check('items and load', g?.items.length === 5 && g.load.join() === '725,1050');
check('symbols stripped from names', g?.items[0].name === '小木彈弓' && g.items[0].id === 'small wooden bow');
check('in-use marks', g?.items.filter(i => i.used).map(i => i.name).join() === '黑色長袍,短劍');
check('second of the same id is numbered', g?.items[2].ref === 'small ring 2' && g.items[1].ref === 'small ring');
check('a glued prompt ends the list', replay(sample).length === 1);
const [e] = replay('> \n你身上沒有攜帶任何東西。\n> ');
check('empty backpack', e && e.items.length === 0);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
