// People walking in and out:  node tools/presencetest.mjs [log ...]
import fs from 'node:fs';
import { MudParser } from '../public/parser.js';
import { PARSER } from '../public/config.js';

const p = new MudParser({
  thing(l) { const m = PARSER.thing.exec(l); return m ? { name: m[1].trim(), id: m[2].toLowerCase(), kind: 'person' } : null; },
  newcomer: name => ({ name, id: '', kind: 'person' }),
});
p.inGame = true;
const show = label => console.log(label.padEnd(34), '->', p.room.things.map(t => t.name).join('、') || '(空)');
p.sent('look');
p.feed('查克銀行 - \n    你走進了一家銀行。\n    這裡唯一的出口是 west。\n  女服務生 悠妮(Waitress)\n> ');
show('進入房間');
for (const l of ['阿德走了過來。', '阿德在阿德帳戶存入 3036 枚金幣。', '青嵐飄了過來。', '青嵐從青嵐的帳戶提出 2000 枚金幣。', '青嵐往西飄去。',
  '阿德祈求神把阿德帶回冒險者之家 ...', '小風走了過來。', '小風往西離開。', '悠妮往北離開。',
  '烏里說道 : 有個客人剛剛走了過來。', '你祈求神把你帶回冒險者之家 ...', '    一條小路往西離開。']) { p.feed(l + '\n'); show(l); }

// how often these lines occur in real logs
for (const f of process.argv.slice(2)) {
  const lines = fs.readFileSync(f, 'utf8').replace(/\x1b\[[\d;]*[A-Za-z]/g, '').split('\n').map(l => l.replace(/^(> )+/, ''));
  const hits = lines.filter(l => PARSER.arrive.test(l) || PARSER.leave.some(re => re.test(l)));
  console.log(f, 'matches:', hits.length, hits.slice(0, 8));
}
