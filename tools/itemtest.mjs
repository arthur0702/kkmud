// Objects vs creatures among the things in a room:  node tools/itemtest.mjs
import { isItem } from '../public/parser.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// seen on the floor in real sessions (name, id)
const items = [['獸皮小手套', 'Small gloves'], ['藤木小盾牌', 'Small shield'], ['輕柔小藍衫', 'Small cloth'], ['綠葉小斗蓬', 'Small cape'],
  ['銅製小臂環', 'Small arms'], ['麻布小短褲', 'Small pants'], ['淡藍小頭巾', 'Small turban'], ['￠小木彈弓￠', 'Small wooden bow'],
  ['戰鎚', 'Hammer'], ['奇怪的骨頭', 'Odd bone'], ['米娜娃魔力玉手', 'The magic hand of minerva'], ['米娜娃魔力閃戒', 'The magic ring of minerva'],
  ['米娜娃魔力彩鏡', 'The magic mirror of minerva'], ['米娜娃魔力頭環', 'The magic zonate of minerva'], ['世界新聞公布欄', 'Board'],
  ['廣告專用板', 'Board'], ['活動討論板', 'Board'], ['尋夢小艇', "Dreamer's ship"], ['十枚金幣', 'Gold'], ['皮甲', 'Leather armor']];
const bad = items.filter(([n, i]) => !isItem(n, i));
check(`${items.length} pieces of equipment and boards are objects`, !bad.length, bad.map(x => x.join('/')).join(' '));

const people = [['酒保烏里', 'Barkeeper'], ['月神祭司', 'Priest of moon'], ['西區巡邏士官', 'Soldier of west gate'], ['女服務生 悠妮', 'Waitress'],
  ['城門守衛', 'Gate guard'], ['羅德斯魔法騎士', 'Knight mage of lodoss'], ['新手冒險者', 'Adventurer'], ['小僧侶', 'Young monk']];
const wrong = people.filter(([n, i]) => isItem(n, i));
check(`${people.length} people stay people`, !wrong.length, wrong.map(x => x.join('/')).join(' '));

check('the id wins over a monster-looking name', isItem('龍鱗盾', 'Dragon shield') && !isItem('紅龍', 'Dragon'));
check('without an id the Chinese name decides', isItem('鐵頭盔', '') && !isItem('兇猛的野狼', ''));
check('an id seen in the backpack or a shop counts', isItem('奇特的東西', 'Strange thing', new Set(['strange thing'])) && !isItem('奇特的東西', 'Strange thing'));

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
