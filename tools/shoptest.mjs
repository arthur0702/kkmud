// Checks the loose shop-line reader against a few plausible layouts:  node tools/shoptest.mjs
import { MudParser, shopLine } from '../public/parser.js';

const samples = [
  '本店目前販賣下列物品﹕',
  '  短劍(Shortsword)                 120 枚金幣',
  '  皮甲(Leather armor)              350 枚金幣',
  '[ 1] 長劍                    1,200',
  ' 2. 治療藥水(potion) ........ 80 gold',
  '(3) 火把 10 枚金幣',
  '--------------------------------',
  '  名稱                     價格',
  '你身上沒有足夠的錢。',
];
for (const s of samples) console.log(JSON.stringify(shopLine(s)), '  <=', s);

// end-to-end: a "list" reply is captured between the command and the next prompt
const p = new MudParser({ listing: (cmd, lines) => console.log('listing for', cmd, '->', lines.map(shopLine).filter(Boolean).length, 'goods') });
p.inGame = true;
p.sent('list');
p.feed('本店目前販賣下列物品﹕\n  短劍(Shortsword)   120 枚金幣\n  火把(Torch)   10 枚金幣\n> ');
p.sent('look');
p.feed('你要看什麼 ?\n> ');
