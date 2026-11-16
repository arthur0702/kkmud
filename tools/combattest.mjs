// Combat descriptions -> health bands, for monsters and for you:  node tools/combattest.mjs [logs/<file>.log ...]
import fs from 'node:fs';
import { MudParser } from '../public/parser.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const conds = text => {
  const out = [];
  const p = new MudParser({ combat: ev => ev.type === 'cond' && out.push(`${ev.who}:${ev.pct}`) });
  for (const part of text.split(/(\n« .*? »\n)/)) { const c = /^\n« (.*?) »\n$/.exec(part); if (c) p.sent(c[1]); else p.feed(part); }
  return out;
};

// lines captured from the server
const got = conds('> \n( 你似乎受了點傷, 但是看起來並不要緊。 )\n( 你受了幾處傷, 但是沒有傷到要害。 )\n( 你傷到不少地方, 流了許多鮮血。 )\n' +
  '( 巨蛙渾身是血, 受傷極重, 有生命危險。 )\n( 巨蛙已經奄奄一息了。 )\n( 妳受了幾處傷, 但是沒有傷到要害。 )\n> ');
check('your own condition is reported (你 and 妳)', got.slice(0, 3).join() === '你:90,你:75,你:50' && got[5] === '妳:75', got.join());
check('渾身是血 is a level of its own, between 到處都是傷口 and 奄奄一息', got[3] === '巨蛙:15' && got[4] === '巨蛙:5', got.join());

for (const f of process.argv.slice(2)) {
  const all = conds(fs.readFileSync(f, 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, ''));
  console.log(`      ${f}: ${all.length} descriptions, ${all.filter(x => /^[你妳]:/.test(x)).length} about you`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
